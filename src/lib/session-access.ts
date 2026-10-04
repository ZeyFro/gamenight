import { prisma } from "@/lib/prisma";
import type { Prisma, SessionInvite } from "@prisma/client";
import {
  communityIdFilter,
  communityMemberUserWhere,
  getIsolationScope,
  isCommunityIsolationEnabled,
  type IsolationScope,
} from "@/lib/community-isolation";

/**
 * Chantier confidentialité des soirées — remplace l'ancien choix
 * d'annonces collectives : seuls le créateur et les invités `ACTIVE`
 * peuvent désormais consulter/agir sur une soirée (site ET Discord, voir
 * `src/lib/session-announce.ts`). Ce module est la SEULE source de vérité
 * du contrôle d'accès serveur — tout chemin de lecture/écriture d'une
 * soirée (pages, actions serveur, résolveurs Discord) doit passer par une
 * de ces fonctions AVANT de lire/modifier la moindre donnée sensible,
 * jamais après (masquer un bouton ne suffit pas).
 *
 * Volontairement AUCUN contournement pour les administrateurs de l'app
 * (`UserRole.ADMIN`, voir `src/lib/admin.ts`) — un accès global implicite
 * aux soirées privées pour les admins n'a jamais été demandé par la
 * nouvelle règle produit. `resendDiscordAction`
 * (src/app/sessions/actions/session-lifecycle.ts) autorise déjà un admin à
 * RENVOYER l'annonce webhook d'une soirée dont il n'est ni créateur ni
 * invité — ce bypass préexistant à ce chantier n'est PAS étendu à la
 * lecture des données de soirée ici, mais reste un besoin d'accès global
 * existant à trancher séparément (documenté dans le README, jamais résolu
 * silencieusement par ce module).
 */

export type SessionAccessRole = "creator" | "guest";

/**
 * Fragment `where` Prisma réutilisable — restreint n'importe quelle
 * requête `Session` (liste ou détail) aux soirées visibles par `userId` :
 * créateur OU invité `ACTIVE`. Toujours injecté AVANT la requête (jamais
 * un filtrage en mémoire après coup) pour qu'aucune ligne inaccessible ne
 * quitte jamais la base — combinable avec `AND` par l'appelant pour
 * n'importe quel autre filtre (statut, plage de dates...).
 */
export function accessibleSessionWhere(
  userId: string,
  scope: IsolationScope | null = null
): Prisma.SessionWhereInput {
  const access: Prisma.SessionWhereInput = {
    OR: [{ createdById: userId }, { invites: { some: { userId, status: "ACTIVE" } } }],
  };
  // Multi-communautés (PR4) : sans portée (isolation éteinte), forme
  // historique inchangée. Avec portée, l'accès créateur/invité ne suffit
  // jamais seul : la soirée doit aussi appartenir à une communauté de
  // l'utilisateur (`AND` jamais vide).
  if (!scope) return access;
  return { AND: [access, communityIdFilter(scope)] };
}

/** `accessibleSessionWhere` avec la portée de communautés de `userId` (relue en base ; aucune lecture si l'isolation est éteinte). */
export async function accessibleSessionWhereFor(userId: string): Promise<Prisma.SessionWhereInput> {
  return accessibleSessionWhere(userId, await getIsolationScope(userId));
}

/**
 * Rôle d'accès de `userId` sur `sessionId`, ou `null` s'il n'a aucun accès
 * (soirée inexistante, ou existante mais ni créateur ni invité actif — les
 * deux cas sont volontairement indistinguables pour l'appelant : révéler
 * "la soirée existe mais tu n'es pas invité" serait déjà une fuite
 * d'information). Toujours une correspondance EXACTE via `accessibleSessionWhere`
 * ci-dessus, jamais une lecture large suivie d'une vérification en mémoire.
 */
export async function getSessionAccessRole(
  userId: string,
  sessionId: string
): Promise<SessionAccessRole | null> {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, ...(await accessibleSessionWhereFor(userId)) },
    select: { createdById: true },
  });
  if (!session) return null;
  return session.createdById === userId ? "creator" : "guest";
}

export async function canAccessSession(userId: string, sessionId: string): Promise<boolean> {
  return (await getSessionAccessRole(userId, sessionId)) !== null;
}

/**
 * Liste des invitations actives d'une soirée (créateur exclu — il n'a
 * jamais besoin d'une ligne `SessionInvite`, voir son commentaire dans
 * schema.prisma), pour l'interface de gestion du créateur.
 */
export async function listActiveInvites(sessionId: string) {
  return prisma.sessionInvite.findMany({
    where: { sessionId, status: "ACTIVE" },
    include: { user: { select: { id: true, discordName: true, discordAvatar: true, color: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/** Historique complet (actifs + révoqués) — utilisé par l'interface de
 * gestion pour distinguer "jamais invité" de "invité puis retiré", et
 * proposer une réinvitation en un clic pour ce second cas. */
export async function listAllInvites(sessionId: string) {
  return prisma.sessionInvite.findMany({
    where: { sessionId },
    include: { user: { select: { id: true, discordName: true, discordAvatar: true, color: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Invite (ou réinvite) `guestUserId` à `sessionId` — réservé à l'appelant
 * (vérification créateur faite PAR L'APPELANT, cette fonction ne la
 * refait pas, voir `src/app/sessions/actions/invites.ts`). Idempotent :
 * réinviter quelqu'un déjà `ACTIVE` est un no-op sans effet observable
 * (pas de nouvelle synchronisation Discord inutile, voir
 * `enqueueSessionInviteSync`) ; réinviter quelqu'un `REVOKED` RÉUTILISE la
 * même ligne (voir le commentaire de `SessionInvite` dans schema.prisma)
 * plutôt que d'en créer une seconde.
 *
 * Ne crée JAMAIS d'invitation pour le créateur lui-même (accès déjà garanti
 * par `createdById`, une ligne serait redondante et fausserait
 * `listActiveInvites`).
 */
export async function inviteToSession(
  sessionId: string,
  invitedById: string,
  guestUserId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<SessionInvite | null> {
  const session = await db.session.findUnique({
    where: { id: sessionId },
    select: { createdById: true, communityId: true },
  });
  if (!session || session.createdById === guestUserId) return null;

  // Multi-communautés (PR4) : un invité doit être membre ACTIVE de la
  // communauté de la soirée (`null` = communauté par défaut), jamais d'une
  // autre communauté de l'invitant.
  if (isCommunityIsolationEnabled()) {
    const member = await db.user.findFirst({
      where: { id: guestUserId, ...(await communityMemberUserWhere(session.communityId)) },
      select: { id: true },
    });
    if (!member) return null;
  }

  return db.sessionInvite.upsert({
    where: { sessionId_userId: { sessionId, userId: guestUserId } },
    create: { sessionId, userId: guestUserId, invitedById, status: "ACTIVE" },
    update: { status: "ACTIVE", invitedById, revokedAt: null, revokedById: null },
  });
}

/**
 * Révoque l'invitation de `guestUserId` sur `sessionId` — coupe
 * IMMÉDIATEMENT l'accès (toute lecture ultérieure via
 * `accessibleSessionWhere`/`getSessionAccessRole` l'exclut dès ce
 * `updateMany` commité) et empêche toute NOUVELLE notification (voir
 * `resolveEligibleMentions`, session-announce.ts, qui relit l'invitation
 * ACTIVE à l'envoi réel, jamais depuis un instantané pris à l'enqueue).
 * Ne touche JAMAIS `Vote`/`Proposal`/`ChatMessage` déjà écrits par cette
 * personne — ses contributions passées restent visibles aux autres
 * invités, seul son accès futur est coupé.
 *
 * `updateMany` conditionné sur `status: "ACTIVE"` (pas un simple `update`)
 * — idempotent si rappelée deux fois (double clic, retry) : la seconde
 * tentative trouve `count: 0`, sans erreur ni double `revokedAt`.
 */
export async function revokeSessionInvite(
  sessionId: string,
  guestUserId: string,
  revokedById: string,
  now: Date = new Date(),
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<boolean> {
  const result = await db.sessionInvite.updateMany({
    where: { sessionId, userId: guestUserId, status: "ACTIVE" },
    data: { status: "REVOKED", revokedAt: now, revokedById },
  });
  return result.count === 1;
}

/**
 * Restreint `candidates` aux personnes dont l'invitation est ACTUELLEMENT
 * `ACTIVE` sur cette soirée, PLUS le créateur (toujours éligible, jamais
 * besoin d'une ligne `SessionInvite`) — filtre RESTRICTIF uniquement
 * (jamais d'ajout), à composer avec le filtre de préférence
 * (`filterUsersByNotificationPreference`) et la sélection `notifiedUserIds`
 * existante dans `resolveEligibleMentions` (session-announce.ts). Relu à
 * CHAQUE appel depuis la base (jamais mis en cache) : une révocation
 * survenue APRÈS l'enqueue d'une livraison mais AVANT son traitement réel
 * retire donc bien la mention, même pour un SEND/EDIT différé — même
 * garantie déjà établie pour les préférences (#98/#99).
 */
export async function filterByActiveSessionInvite<T extends { id: string }>(
  sessionId: string,
  creatorId: string,
  candidates: T[]
): Promise<T[]> {
  const toCheck = candidates.filter((c) => c.id !== creatorId);
  if (toCheck.length === 0) return candidates.filter((c) => c.id === creatorId);

  const active = await prisma.sessionInvite.findMany({
    where: { sessionId, status: "ACTIVE", userId: { in: toCheck.map((c) => c.id) } },
    select: { userId: true },
  });
  const activeIds = new Set(active.map((i) => i.userId));
  return candidates.filter((c) => c.id === creatorId || activeIds.has(c.id));
}
