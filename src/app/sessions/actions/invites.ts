"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { inviteToSession, revokeSessionInvite } from "@/lib/session-access";
import { enqueueSessionInviteSync, enqueueSessionCreatorThreadMembership } from "@/lib/session-announce";

/**
 * Gestion des invités d'une soirée — réservée au CRÉATEUR (jamais un
 * invité, même actif, ne peut inviter/retirer quelqu'un d'autre : "seul
 * le créateur gère les invitations", règle produit explicite). Les deux
 * actions ci-dessous vérifient `session.createdById === user.id`
 * elles-mêmes, jamais déléguée à `canAccessSession` (qui autoriserait
 * aussi un simple invité).
 */

async function assertOwnsSession(sessionId: string, userId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { createdById: true, announceViaBot: true },
  });
  if (!session || session.createdById !== userId) return null;
  return session;
}

/**
 * Invite (ou réinvite) un pote — idempotent, voir `inviteToSession`
 * (src/lib/session-access.ts). Déclenche, si la soirée est sur le chemin
 * bot, une synchronisation Discord ASYNCHRONE (enqueue seulement, traitée
 * par le cron exécuteur — voir `enqueueSessionInviteSync`,
 * session-announce.ts) : jamais un appel Discord réel depuis cette action,
 * jamais présentée comme instantanée côté UI (voir la page
 * `/sessions/[id]/invites`, qui affiche l'état "en attente"/"échec" par
 * invité).
 */
export async function addSessionInviteAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "addSessionInvite")) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  const guestUserId = String(formData.get("guestUserId") ?? "");
  if (!sessionId || !guestUserId) return;

  const session = await assertOwnsSession(sessionId, user.id);
  if (!session) return;

  const invite = await inviteToSession(sessionId, user.id, guestUserId);
  if (invite && session.announceViaBot) {
    await enqueueSessionInviteSync(invite.id);
  }

  revalidatePath(`/sessions/${sessionId}/invites`);
}

/**
 * Retire un invité — coupe l'accès applicatif IMMÉDIATEMENT
 * (`revokeSessionInvite`, dès ce `updateMany` commité) et enqueue la
 * révocation Discord correspondante (retrait du fil privé, best-effort,
 * traité par le même exécuteur). Ne touche JAMAIS les contributions déjà
 * écrites par cette personne (votes, propositions, messages de chat) —
 * seul son accès futur est coupé.
 */
export async function revokeSessionInviteAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "revokeSessionInvite")) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  const guestUserId = String(formData.get("guestUserId") ?? "");
  if (!sessionId || !guestUserId) return;

  const session = await assertOwnsSession(sessionId, user.id);
  if (!session) return;

  const revoked = await revokeSessionInvite(sessionId, guestUserId, user.id);
  if (revoked && session.announceViaBot) {
    const invite = await prisma.sessionInvite.findUnique({
      where: { sessionId_userId: { sessionId, userId: guestUserId } },
      select: { id: true },
    });
    if (invite) await enqueueSessionInviteSync(invite.id);
  }

  revalidatePath(`/sessions/${sessionId}/invites`);
}

/**
 * Réessaie manuellement la synchronisation Discord d'une invitation dont
 * le dernier statut connu est "failed" — seul recours du créateur quand
 * un ajout/retrait Discord a échoué définitivement (permission refusée,
 * fil supprimé, etc.) : sans ce bouton, un retrait resté en échec ne
 * serait plus jamais repris automatiquement (aucun cron ne retente une
 * livraison FAILED terminale), alors que l'accès applicatif, lui, est
 * déjà coupé — l'écart entre "coupé côté site" et "toujours membre du fil
 * Discord" resterait invisible et permanent.
 *
 * Ré-enqueue simplement une nouvelle synchronisation (même mécanique
 * qu'`addSessionInviteAction`/`revokeSessionInviteAction`) : le résolveur
 * relit le statut ACTUEL de l'invitation au traitement, donc retente
 * toujours la bonne opération (ajout ou retrait), jamais celle figée au
 * moment de l'échec initial.
 */
export async function retrySessionInviteSyncAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "retrySessionInviteSync")) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  const inviteId = String(formData.get("inviteId") ?? "");
  if (!sessionId || !inviteId) return;

  const session = await assertOwnsSession(sessionId, user.id);
  if (!session || !session.announceViaBot) return;

  const invite = await prisma.sessionInvite.findUnique({
    where: { id: inviteId },
    select: { sessionId: true },
  });
  if (!invite || invite.sessionId !== sessionId) return;

  await enqueueSessionInviteSync(inviteId);

  revalidatePath(`/sessions/${sessionId}/invites`);
}

/**
 * Réessaie manuellement l'ajout du CRÉATEUR au fil privé — bug remonté en
 * test réel : le créateur n'a jamais de `SessionInvite` (il a accès via
 * `createdById`, jamais via une invitation), donc jamais couvert par
 * `retrySessionInviteSyncAction` ci-dessus. Couvre deux cas : une soirée
 * créée AVANT le correctif (jamais enqueue-ée la première fois) et un
 * échec terminal (jamais retenté automatiquement par le cron). Toujours
 * réservée au créateur lui-même — `assertOwnsSession` vérifie déjà
 * `session.createdById === user.id`, donc cette action ne peut jamais
 * être déclenchée pour ajouter QUELQU'UN D'AUTRE que l'appelant.
 */
export async function retrySessionCreatorThreadSyncAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "retrySessionCreatorThreadSync")) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;

  const session = await assertOwnsSession(sessionId, user.id);
  if (!session || !session.announceViaBot) return;

  await enqueueSessionCreatorThreadMembership(sessionId);

  revalidatePath(`/sessions/${sessionId}/invites`);
}
