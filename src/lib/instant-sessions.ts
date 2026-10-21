import { createOnce, lockCreationMembers } from "@/lib/creation-intent";
import type { InstantSession, Prisma } from "@prisma/client";
import { getScopedPrisma, getActiveScopedPrisma, scopedPrisma, scopedTransactionPrisma, withCommunity } from "@/lib/community-scoped-client";
import { communityIdFilter, communityMemberUserWhere, cronCommunityScope, getIsolationScope, isCommunityIsolationEnabled, isMemberOfCommunity, resolveActiveCommunityId } from "@/lib/community-isolation";
import { prisma } from "@/lib/prisma";
import { wallClockNow } from "@/lib/wallclock";
import { gameWarningsSelect, type GameWarningsData } from "@/lib/game-warnings";
import { awardXp, isUniqueConstraintViolation } from "@/lib/xp-actions";
import { XP_AMOUNTS } from "@/lib/xp";
import { checkSessionsParticipatedBadges } from "@/lib/badges";
import {
  enqueueInstantSessionInviteUpdate,
  enqueueInstantSessionInvites,
  enqueueInstantSessionAnnouncement,
} from "@/lib/instant-session-announce";
import { logger } from "@/lib/logger";
import { INSTANT_SESSION_ELIGIBLE_PRESENCE_MS } from "@/lib/instant-session-constants";
export { INSTANT_SESSION_ELIGIBLE_PRESENCE_MS } from "@/lib/instant-session-constants";

/**
 * V2 — "Jouer maintenant" : sessions spontanées. Voir le commentaire de
 * modèle `InstantSession`/`InstantSessionPresenceInterval` (schema.prisma)
 * pour la description du domaine.
 *
 * TOUTES les dates manipulées ici viennent de `wallClockNow()`, JAMAIS de
 * `new Date()`/`Date.now()` brut ni d'un `@default(now())` Prisma —
 * cohérence stricte avec le reste de l'app (voir le commentaire de
 * fichier de `src/lib/wallclock.ts`) : une durée calculée en mélangeant
 * les deux sources introduirait un décalage systémique (classe de bug
 * déjà rencontrée et corrigée dans ce dépôt, cf. README "Fix cycle de vie
 * des soirées"). Comme la durée max (3h) est un simple OFFSET (jamais un
 * horaire calendaire affiché), le choix horloge-murale vs UTC réel
 * n'affecte pas la durée elle-même (le décalage s'annule dans
 * `endedAt - startedAt`) — seule la COHÉRENCE interne compte ici, pas la
 * valeur absolue.
 *
 * Le serveur fait autorité partout : aucune fonction ci-dessous ne fait
 * jamais confiance à une durée transmise par le client, uniquement aux
 * horodatages qu'elle lit/écrit elle-même en base.
 */

export const INSTANT_SESSION_MAX_DURATION_MS = 3 * 60 * 60 * 1000;

/* -------------------------------------------------------------------- */
/* Calcul de présence conjointe — pur, testable indépendamment de la DB  */
/* -------------------------------------------------------------------- */

export interface PresenceIntervalInput {
  userId: string;
  startedAt: Date;
  endedAt: Date | null;
}

/**
 * "Un participant devient éligible après quinze minutes CUMULÉES dans la
 * session en présence d'AU MOINS UN AUTRE participant" — jamais une
 * simple somme du temps de présence individuel. Algorithme de balayage
 * (sweep-line) : construit la chronologie de TOUS les événements
 * arrivée/départ (toutes personnes confondues), et pour chaque
 * sous-intervalle entre deux événements consécutifs où AU MOINS 2
 * personnes sont présentes, crédite la durée entière du sous-intervalle
 * à CHACUNE des personnes présentes — "dix minutes à trois : dix minutes
 * PAR personne, sans multiplication" (jamais une durée partagée/divisée).
 * Ordre des ties : un départ trié AVANT une arrivée au même instant (peu
 * importe pour la durée — un chevauchement d'un seul instant ne dure
 * jamais), déterministe.
 *
 * `endedAt: null` (intervalle encore ouvert) est fermé à `asOf` — jamais
 * au-delà, jamais avant. Un intervalle dégénéré (`endedAt <= startedAt`,
 * ne devrait jamais arriver en pratique) est silencieusement ignoré
 * plutôt que de produire une durée négative.
 *
 * Retourne une Map incluant TOUS les userId présents dans `intervals`,
 * même à 0ms (jamais absent de la Map) — permet à l'appelant de savoir
 * qui a participé sans avoir participé assez longtemps, pour l'affichage
 * de progression.
 */
export function computeCoPresenceMs(
  intervals: PresenceIntervalInput[],
  asOf: Date
): Map<string, number> {
  const totals = new Map<string, number>();

  type SweepEvent = { t: number; kind: 0 | 1; userId: string }; // 0 = fin (triée avant), 1 = début
  const events: SweepEvent[] = [];
  for (const interval of intervals) {
    totals.set(interval.userId, totals.get(interval.userId) ?? 0);
    const start = interval.startedAt.getTime();
    const end = (interval.endedAt ?? asOf).getTime();
    if (end <= start) continue;
    events.push({ t: start, kind: 1, userId: interval.userId });
    events.push({ t: end, kind: 0, userId: interval.userId });
  }
  if (events.length === 0) return totals;

  events.sort((a, b) => (a.t !== b.t ? a.t - b.t : a.kind - b.kind));

  const present = new Set<string>();
  let cursor = events[0].t;
  for (const event of events) {
    if (event.t > cursor && present.size >= 2) {
      const duration = event.t - cursor;
      for (const userId of present) {
        totals.set(userId, (totals.get(userId) ?? 0) + duration);
      }
    }
    cursor = event.t;
    if (event.kind === 1) present.add(event.userId);
    else present.delete(event.userId);
  }
  return totals;
}

/* -------------------------------------------------------------------- */
/* Création / adhésion / départ                                         */
/* -------------------------------------------------------------------- */

export type InstantSessionActionFailureReason =
  | "already_in_another_session"
  | "not_found"
  | "ended"
  | "not_creator"
  | "creator_cannot_leave";

export type InstantSessionActionResult =
  | { ok: true }
  | { ok: false; reason: InstantSessionActionFailureReason };

export type CreateInstantSessionResult =
  | { ok: true; instantSession: InstantSession }
  | { ok: false; reason: InstantSessionActionFailureReason };

/**
 * Crée une session instantanée — le créateur devient participant DANS LA
 * MÊME transaction (règle produit : "le créateur est participant dès la
 * création"), jamais un ajout différé. `expiresAt` posée UNE FOIS ici,
 * jamais recalculée ailleurs. L'index unique partiel
 * (`InstantSessionPresenceInterval_userId_open_key`, voir la migration)
 * est la garantie RÉELLE contre "le créateur est déjà membre d'une autre
 * session active" — y compris en cas de double clic/soumission
 * concurrente ; la vérification ci-dessous n'est qu'un raccourci pour un
 * message d'erreur clair dans le cas courant, jamais la seule protection.
 */
export async function createInstantSession(input: {
  creationKey?: string;
  creatorId: string;
  gameId: string;
  notifiedUserIds: string[];
}): Promise<CreateInstantSessionResult> {
  const activeCommunityId = await resolveActiveCommunityId(input.creatorId);
  if (activeCommunityId === null) return { ok: false, reason: "not_found" };
  const legacyDefault = !isCommunityIsolationEnabled() && await isMemberOfCommunity(input.creatorId, null);
  const communityId = legacyDefault ? null : activeCommunityId;
  // Expiration paresseuse d'abord : une session échue mais pas encore
  // réglée par le cron garde l'intervalle de présence du créateur ouvert, ce
  // qui bloquerait la création (index unique partiel) jusqu'au prochain
  // passage du cron alors que la session est finie depuis longtemps.
  const stale = await prisma.instantSessionPresenceInterval.findFirst({
    where: { userId: input.creatorId, endedAt: null },
    select: { instantSessionId: true },
  });
  if (stale) await settleInstantSessionIfDue(stale.instantSessionId);

  const now = wallClockNow();
  const expiresAt = new Date(now.getTime() + INSTANT_SESSION_MAX_DURATION_MS);
  // Le serveur fait autorité sur la liste des invités : le créateur n'est
  // jamais invité à sa propre session (règle de ping « créateur sans
  // mention »), et un id en double (formulaire forgé) ferait échouer toute
  // la transaction (violation d'unicité → 25P02) au lieu d'être ignoré.
  const candidates = await prisma.user.findMany({
    where: { id: { in: [...new Set(input.notifiedUserIds)], not: input.creatorId }, ...(await communityMemberUserWhere(communityId)) },
    select: { id: true },
  });
  const notifiedUserIds = candidates.map((u) => u.id);

  try {
    const { result: instantSession } = await createOnce(input.creatorId, "INSTANT_SESSION", input.creationKey, async (tx) => {
      await lockCreationMembers(tx, communityId, [input.creatorId, ...notifiedUserIds]);
      const scopedDb = scopedTransactionPrisma(tx, await getIsolationScope(input.creatorId));
      const created = await scopedDb.instantSession.create({
        data: {
          ...withCommunity(communityId),
          createdById: input.creatorId,
          gameId: input.gameId,
          createdAt: now,
          expiresAt,
          notifiedUserIds,
        },
      });
      await tx.instantSessionPresenceInterval.create({
        data: { instantSessionId: created.id, userId: input.creatorId, startedAt: now },
      });
      if (notifiedUserIds.length > 0) {
        // Le cast adapte les types Prisma étendus ; le client de transaction garde ses filtres.
        await enqueueInstantSessionInvites(created.id, notifiedUserIds, tx as unknown as Prisma.TransactionClient);
      }
      await enqueueInstantSessionAnnouncement(created.id, tx as unknown as Prisma.TransactionClient);
      return created;
    }, (created) => created.id, (tx, id) => tx.instantSession.findUniqueOrThrow({ where: { id } }));
    return { ok: true, instantSession };
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      return { ok: false, reason: "already_in_another_session" };
    }
    throw error;
  }
}

/**
 * Rejoint une session instantanée — librement, aucune notion d'invitation
 * requise (voir le commentaire de modèle). Idempotent si déjà membre de
 * CETTE session (double clic) ; refuse si déjà membre d'une AUTRE session
 * active (voir l'index unique partiel). Toujours précédée d'un règlement
 * paresseux (`settleInstantSessionIfDue`) : "aucune jonction après fin ou
 * expiration", jamais sur un statut périmé.
 */
export async function joinInstantSession(
  instantSessionId: string,
  userId: string
): Promise<InstantSessionActionResult> {
  const scopedDb = await getScopedPrisma(userId);
  if (!(await scopedDb.instantSession.findUnique({ where: { id: instantSessionId }, select: { id: true } }))) return { ok: false, reason: "not_found" };
  await settleInstantSessionIfDue(instantSessionId);

  try {
    return await scopedDb.$transaction(async (tx) => {
      const session = await tx.instantSession.findUnique({
        where: { id: instantSessionId },
        select: { status: true },
      });
      if (!session) return { ok: false, reason: "not_found" as const };
      if (session.status !== "ACTIVE") return { ok: false, reason: "ended" as const };

      const openElsewhere = await tx.instantSessionPresenceInterval.findFirst({
        where: { userId, endedAt: null },
        select: { instantSessionId: true },
      });
      if (openElsewhere) {
        if (openElsewhere.instantSessionId === instantSessionId) return { ok: true };
        return { ok: false, reason: "already_in_another_session" as const };
      }

      await tx.instantSessionPresenceInterval.create({
        data: { instantSessionId, userId, startedAt: wallClockNow() },
      });
      return { ok: true };
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      return { ok: false, reason: "already_in_another_session" };
    }
    throw error;
  }
}

/**
 * Quitte une session instantanée — réservé aux participants NON créateurs
 * ("un autre participant peut quitter et revenir tant que la session
 * reste active" — le créateur, lui, n'a que `endInstantSession`, voir son
 * commentaire). Idempotent (déjà parti → `updateMany` count 0, traité
 * comme un succès silencieux, jamais une erreur pour un double clic).
 * Referme l'intervalle ouvert puis règle IMMÉDIATEMENT les récompenses
 * (le départ peut être le moment exact où le seuil de 15 min est franchi).
 */
export async function leaveInstantSession(
  instantSessionId: string,
  userId: string
): Promise<InstantSessionActionResult> {
  // Expiration paresseuse d'abord (comme join/change) : sans elle, un
  // départ APRÈS l'échéance fermait l'intervalle à l'heure du départ,
  // au-delà des 3 h maximum.
  const scopedDb = await getScopedPrisma(userId);
  if (!(await scopedDb.instantSession.findUnique({ where: { id: instantSessionId }, select: { id: true } }))) return { ok: false, reason: "not_found" };
  await settleInstantSessionIfDue(instantSessionId);

  const session = await scopedDb.instantSession.findUnique({
    where: { id: instantSessionId },
    select: { createdById: true, status: true },
  });
  if (!session) return { ok: false, reason: "not_found" };
  if (session.createdById === userId) return { ok: false, reason: "creator_cannot_leave" };

  await prisma.instantSessionPresenceInterval.updateMany({
    where: { instantSessionId, userId, endedAt: null },
    data: { endedAt: wallClockNow() },
  });

  if (session.status === "ACTIVE") {
    await settleInstantSessionRewards(instantSessionId);
  }
  return { ok: true };
}

/**
 * Change le jeu d'une session instantanée — réservé au créateur.
 * "Changer de jeu conserve les participants, l'échéance et le temps
 * comptabilisé" : ne touche NI `expiresAt` NI les intervalles de présence
 * (le jeu n'est jamais suivi par intervalle, seulement au niveau de la
 * session) — un simple `update` du champ, puis une EDIT de chaque
 * invitation déjà envoyée (jamais un nouvel envoi, voir
 * `instant-session-announce.ts`).
 */
export async function changeInstantSessionGame(
  instantSessionId: string,
  requestedById: string,
  gameId: string
): Promise<InstantSessionActionResult> {
  const scopedDb = await getScopedPrisma(requestedById);
  if (!(await scopedDb.instantSession.findUnique({ where: { id: instantSessionId }, select: { id: true } }))) return { ok: false, reason: "not_found" };
  await settleInstantSessionIfDue(instantSessionId);

  const session = await scopedDb.instantSession.findUnique({
    where: { id: instantSessionId },
    select: { createdById: true, status: true },
  });
  if (!session) return { ok: false, reason: "not_found" };
  if (session.createdById !== requestedById) return { ok: false, reason: "not_creator" };
  if (session.status !== "ACTIVE") return { ok: false, reason: "ended" };

  await prisma.$transaction(async tx => {
    const scopedDb = scopedTransactionPrisma(tx, await getIsolationScope(requestedById));
    await scopedDb.instantSession.update({ where: { id: instantSessionId }, data: { gameId } });
    await enqueueInstantSessionInviteUpdate(instantSessionId, tx);
  });
  return { ok: true };
}

/**
 * Termine une session instantanée — pour de vrai, deux appelants :
 *   - le CRÉATEUR ("si le créateur quitte, la session se termine pour
 *     tous, après confirmation explicite" — la confirmation est un geste
 *     d'interface, cette fonction reste la garde côté serveur : refuse
 *     tout appelant qui n'est pas le créateur, voir `reason: "not_creator"`) ;
 *   - le SYSTÈME (règlement d'expiration, `requestedById: null`, jamais
 *     de vérification de créateur).
 *
 * `updateMany` conditionné sur `status: "ACTIVE"` — même mécanique
 * atomique que `markSessionDone`/`claimSessionClose` : un appel
 * concurrent (double clic, ou expiration ET créateur qui quitte en même
 * temps) ne peut jamais clôturer deux fois, `count: 0` = déjà terminée,
 * traité comme un succès idempotent silencieux. Referme TOUS les
 * intervalles encore ouverts au même instant (`endedAt`), puis règle les
 * récompenses immédiatement APRÈS le commit (jamais dans la transaction —
 * `awardXp` ouvre systématiquement la sienne, voir son commentaire de
 * fichier) : par construction, une session `ENDED` a donc TOUJOURS déjà
 * ses récompenses réglées avant que la purge de rétention ne puisse
 * jamais s'appliquer (7 jours plus tard au plus tôt) — jamais un état
 * "terminée mais pas encore réglée" observable depuis l'extérieur de
 * cette fonction.
 */
export async function endInstantSession(
  instantSessionId: string,
  requestedById: string | null,
  reason: "creator_left" | "expired"
): Promise<InstantSessionActionResult> {
  const scopedDb = requestedById === null ? scopedPrisma(await cronCommunityScope()) : await getScopedPrisma(requestedById);
  const result = await scopedDb.$transaction(async (tx) => {
    const session = await tx.instantSession.findUnique({
      where: { id: instantSessionId },
      select: { createdById: true, status: true, expiresAt: true },
    });
    if (!session) return { ok: false as const, reason: "not_found" as const };
    if (requestedById !== null && session.createdById !== requestedById) {
      return { ok: false as const, reason: "not_creator" as const };
    }

    // Durée max 3 h : une expiration réglée tardivement (cron en retard,
    // page rouverte plus tard) est datée À L'ÉCHÉANCE, jamais à l'heure du
    // règlement — sinon la session et les intervalles de présence
    // dépasseraient les 3 h autorisées.
    const wallNow = wallClockNow();
    const now = reason === "expired" && session.expiresAt < wallNow ? session.expiresAt : wallNow;

    const claimed = await tx.instantSession.updateMany({
      where: { id: instantSessionId, status: "ACTIVE" },
      data: { status: "ENDED", endedAt: now, endedReason: reason },
    });
    if (claimed.count === 0) return { ok: true as const, alreadyEnded: true as const };

    await tx.instantSessionPresenceInterval.updateMany({
      where: { instantSessionId, endedAt: null },
      data: { endedAt: now },
    });
    await enqueueInstantSessionInviteUpdate(instantSessionId, tx as unknown as Prisma.TransactionClient);
    return { ok: true as const, alreadyEnded: false as const };
  });

  if (!result.ok) return result;
  if (!result.alreadyEnded) {
    await settleInstantSessionRewards(instantSessionId);
  }
  return { ok: true };
}

/* -------------------------------------------------------------------- */
/* Règlement — expiration paresseuse/batch, récompenses XP              */
/* -------------------------------------------------------------------- */

/** Déclenchement paresseux (page/action) — même contrat que
 * `closeSessionIfDue`/`spinRouletteIfDue` : le serveur fait autorité,
 * l'expiration est respectée même si le cron n'est pas encore passé. */
export async function settleInstantSessionIfDue(instantSessionId: string): Promise<void> {
  const scopedDb = scopedPrisma(await cronCommunityScope());
  const session = await scopedDb.instantSession.findUnique({
    where: { id: instantSessionId },
    select: { status: true, expiresAt: true },
  });
  if (!session || session.status !== "ACTIVE") return;
  if (session.expiresAt > wallClockNow()) return;
  await endInstantSession(instantSessionId, null, "expired");
}

/** Passage batch (cron `/api/cron/close-sessions`, inconditionnel — voir
 * son commentaire de fichier) : couvre le cas "aucun navigateur ouvert à
 * l'expiration", que la purge de rétention (opt-in, `retention.ts`) soit
 * activée ou non. */
export async function settleAllDueInstantSessions(): Promise<string[]> {
  const scopedDb = scopedPrisma(await cronCommunityScope());
  const now = wallClockNow();
  const due = await scopedDb.instantSession.findMany({
    where: { status: "ACTIVE", expiresAt: { lte: now } },
    select: { id: true },
  });
  const settled: string[] = [];
  for (const { id } of due) {
    const result = await endInstantSession(id, null, "expired");
    if (result.ok) settled.push(id);
  }
  return settled;
}

/**
 * Calcule la présence conjointe de TOUS les participants (recrutés depuis
 * l'historique complet des intervalles, jamais seulement les présents
 * actuels) et attribue l'XP de participation à quiconque atteint 15 min
 * cumulées — RÉUTILISE la règle XP existante des soirées planifiées
 * (`XP_AMOUNTS.PARTICIPATE`, `awardXp(..., session.communityId, "PARTICIPATE", ...)`) à
 * dessein, MAIS n'appelle JAMAIS `checkGroupAchievements()` ni aucune
 * fonction qui recalculerait un trophée de GROUPE défini en termes de
 * `Session` planifiées (`GroupSessionStats`/`GroupGameStat`/
 * `GroupActiveWeek` ne sont jamais touchés ici) : une session instantanée
 * n'est PAS une `Session`, et étendre silencieusement la définition de
 * "soirée jouée" à ce nouveau type n'a jamais été demandé — effet de
 * bord délibérément évité, documenté explicitement plutôt que découvert
 * après coup.
 *
 * `checkSessionsParticipatedBadges(userId)` EST en revanche appelée : ce
 * badge compte déjà `XpEvent` de `reason: "PARTICIPATE"` (peu importe la
 * source, voir badges.ts) — la définition de ce badge précis n'a jamais
 * été "soirées planifiées uniquement", contrairement aux trophées de
 * groupe ci-dessus. Effet de bord voulu, cohérent avec la demande
 * ("réutiliser la règle d'XP de participation à une soirée").
 *
 * Idempotent via la contrainte unique `[userId, reason, sourceId]` sur
 * `XpEvent` (même garantie que partout ailleurs dans l'app, voir
 * `awardXp`) — `sourceId = instantSessionId` : un appel répété (poll 30s,
 * fin de session, expiration, plusieurs passages de purge...) ne peut
 * jamais attribuer l'XP une seconde fois pour le même couple
 * (utilisateur, session). Aucun état "déjà récompensé" à maintenir
 * séparément — l'événement XP EST la garde.
 */
export async function settleInstantSessionRewards(instantSessionId: string): Promise<void> {
  const scopedDb = scopedPrisma(await cronCommunityScope());
  const session = await scopedDb.instantSession.findUnique({
    where: { id: instantSessionId },
    select: { communityId: true, status: true, endedAt: true },
  });
  if (!session) return;

  const intervals = await prisma.instantSessionPresenceInterval.findMany({
    where: { instantSessionId },
    select: { userId: true, startedAt: true, endedAt: true },
  });
  if (intervals.length === 0) return;

  const asOf = session.status === "ENDED" ? (session.endedAt ?? wallClockNow()) : wallClockNow();
  const totals = computeCoPresenceMs(intervals, asOf);

  for (const [userId, ms] of totals) {
    if (ms < INSTANT_SESSION_ELIGIBLE_PRESENCE_MS) continue;
    try {
      await awardXp(userId, session.communityId, "PARTICIPATE", instantSessionId, XP_AMOUNTS.PARTICIPATE);
      await checkSessionsParticipatedBadges(userId, session.communityId);
    } catch (error) {
      // Best-effort par utilisateur — un échec pour l'un ne doit jamais
      // empêcher le règlement des autres (même philosophie que les effets
      // post-commit de `awardXp` lui-même).
      logger.error("instant-sessions", error, { instantSessionId, userId, effect: "settleRewards" });
    }
  }
}

/* -------------------------------------------------------------------- */
/* Lecture — liste, vue détaillée                                       */
/* -------------------------------------------------------------------- */

export interface InstantSessionParticipantView {
  userId: string;
  discordName: string;
  discordAvatar: string | null;
  color: string;
  isPresent: boolean;
  coPresenceMs: number;
  eligible: boolean;
}

export interface InstantSessionView {
  id: string;
  status: "ACTIVE" | "ENDED";
  game: { id: string; name: string; coverUrl: string | null } & GameWarningsData;
  creator: { id: string; discordName: string; discordAvatar: string | null; color: string };
  createdAt: Date;
  expiresAt: Date;
  endedAt: Date | null;
  endedReason: string | null;
  timeRemainingMs: number;
  participants: InstantSessionParticipantView[];
  viewerIsParticipant: boolean;
  viewerIsCreator: boolean;
}

/**
 * Liste des sessions instantanées ACTIVES — accessible à tout utilisateur
 * authentifié (voir le commentaire de modèle : pas de confidentialité par
 * invitation ici, contrairement aux soirées planifiées). Règle
 * paresseusement TOUTES les sessions dues AVANT de lire — jamais une
 * session expirée mais pas encore marquée affichée comme "active".
 */
export async function listActiveInstantSessions(viewerId: string) {
  const scopedDb = await getActiveScopedPrisma(viewerId);
  const due = await scopedDb.instantSession.findMany({
    where: { status: "ACTIVE", expiresAt: { lte: wallClockNow() } }, select: { id: true },
  });
  for (const { id } of due) await settleInstantSessionIfDue(id);
  return scopedDb.instantSession.findMany({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      game: { select: { id: true, name: true, coverUrl: true } },
      createdBy: { select: { id: true, discordName: true, discordAvatar: true, color: true } },
      presence: { where: { endedAt: null }, select: { userId: true } },
    },
  });
}

/**
 * Vue complète d'une session — règle l'expiration ET les récompenses AVANT
 * de lire (voir `settleInstantSessionIfDue`/`settleInstantSessionRewards`) :
 * c'est ce chemin de lecture, rappelé au minimum à chaque actualisation
 * de 30s côté client, qui détecte "en direct" le franchissement des 15
 * minutes — délai cohérent avec cette actualisation, jamais un cron dédié
 * nécessaire pour le cas courant (navigateur ouvert).
 */
export async function getInstantSessionView(
  instantSessionId: string,
  viewerId: string
): Promise<InstantSessionView | null> {
  const scopedDb = await getScopedPrisma(viewerId);
  // Refuser avant les règlements : un identifiant deviné ne déclenche aucun effet.
  if (!(await scopedDb.instantSession.findUnique({ where: { id: instantSessionId }, select: { id: true } }))) return null;
  await settleInstantSessionIfDue(instantSessionId);
  await settleInstantSessionRewards(instantSessionId);

  const session = await scopedDb.instantSession.findUnique({
    where: { id: instantSessionId },
    select: {
      id: true,
      status: true,
      createdAt: true,
      expiresAt: true,
      endedAt: true,
      endedReason: true,
      game: { select: { id: true, name: true, coverUrl: true, ...gameWarningsSelect } },
      createdBy: { select: { id: true, discordName: true, discordAvatar: true, color: true } },
      presence: {
        select: {
          userId: true,
          startedAt: true,
          endedAt: true,
          user: { select: { discordName: true, discordAvatar: true, color: true } },
        },
      },
    },
  });
  if (!session) return null;

  const now = wallClockNow();
  const asOf = session.status === "ENDED" ? (session.endedAt ?? now) : now;
  const totals = computeCoPresenceMs(session.presence, asOf);

  const byUser = new Map<string, (typeof session.presence)[number]>();
  const openByUser = new Set<string>();
  for (const interval of session.presence) {
    byUser.set(interval.userId, interval); // dernière ligne rencontrée = suffisant pour discordName/avatar/couleur
    if (interval.endedAt === null) openByUser.add(interval.userId);
  }

  const participants: InstantSessionParticipantView[] = [...byUser.entries()]
    .map(([userId, interval]) => ({
      userId,
      discordName: interval.user.discordName,
      discordAvatar: interval.user.discordAvatar,
      color: interval.user.color,
      isPresent: openByUser.has(userId),
      coPresenceMs: totals.get(userId) ?? 0,
      eligible: (totals.get(userId) ?? 0) >= INSTANT_SESSION_ELIGIBLE_PRESENCE_MS,
    }))
    .sort((a, b) => b.coPresenceMs - a.coPresenceMs);

  return {
    id: session.id,
    status: session.status,
    game: session.game,
    creator: session.createdBy,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    endedAt: session.endedAt,
    endedReason: session.endedReason,
    timeRemainingMs: Math.max(0, session.expiresAt.getTime() - now.getTime()),
    participants,
    viewerIsParticipant: openByUser.has(viewerId),
    viewerIsCreator: session.createdBy.id === viewerId,
  };
}

/** DTO sérialisable (dates en ISO string) — franchit la frontière
 * serveur/client (server action → composant client) sans ambiguïté de
 * sérialisation, même convention que `ChatMessageDTO` (src/lib/chat.ts). */
export interface InstantSessionViewDTO
  extends Omit<InstantSessionView, "createdAt" | "expiresAt" | "endedAt"> {
  createdAtIso: string;
  expiresAtIso: string;
  endedAtIso: string | null;
}

export function toInstantSessionViewDTO(view: InstantSessionView): InstantSessionViewDTO {
  const { createdAt, expiresAt, endedAt, ...rest } = view;
  return {
    ...rest,
    game: { ...rest.game, ...(rest.game.warningsUpdatedAt instanceof Date ? { warningsUpdatedAt: rest.game.warningsUpdatedAt.toISOString() } : {}) },
    createdAtIso: createdAt.toISOString(),
    expiresAtIso: expiresAt.toISOString(),
    endedAtIso: endedAt ? endedAt.toISOString() : null,
  };
}

/** Session active courante d'un utilisateur, s'il y en a une — sert à
 * afficher "tu es déjà dans une session" sur `/jouer-maintenant` et à
 * empêcher la création d'une seconde côté UI (le serveur reste la seule
 * garantie réelle, voir l'index unique partiel). */
export async function getActiveInstantSessionForUser(userId: string): Promise<{ id: string } | null> {
  const open = await prisma.instantSessionPresenceInterval.findFirst({
    where: { userId, endedAt: null, instantSession: { status: "ACTIVE", ...communityIdFilter(await getIsolationScope(userId)) } },
    select: { instantSessionId: true },
  });
  return open ? { id: open.instantSessionId } : null;
}
