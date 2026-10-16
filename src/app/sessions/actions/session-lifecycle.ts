"use server";

import { resumeCreation } from "@/lib/creation-resume";

import { createOnce, creationKey } from "@/lib/creation-intent";
import { createVotingSessionInTransaction } from "@/lib/session-creation";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getScopedPrisma } from "@/lib/community-scoped-client";
import { prisma } from "@/lib/prisma";
import { requireCommunityBotAnnouncement } from "@/lib/community-announcement-required";
import { getCurrentUser } from "@/lib/current-user";
import { requireAdmin } from "@/lib/admin";
import { resolveSessionSchedule } from "@/lib/session-schedule";
import { recurringSessionDates, type SessionRecurrence } from "@/lib/session-recurrence";
import { announceSessionCreated } from "@/lib/discord-session-created";
import { announceSessionModified } from "@/lib/discord-session-modified";
import { isSessionAnnounceViaBotEnabledFor, pickCreationCommunityId } from "@/lib/community-channels";
import { communityMemberUserWhere, isCommunityIsolationEnabled } from "@/lib/community-isolation";
import { isRealDiscordFailure } from "@/lib/discord";
import {
  enqueueSessionThreadDelete,
} from "@/lib/session-announce";
import { awardXp } from "@/lib/xp-actions";
import { XP_AMOUNTS } from "@/lib/xp";
import {
  cancelSession,
  closeSession,
  markSessionDone,
  resendSessionAnnouncement,
  updateSessionSchedule,
} from "@/lib/sessions";
import { checkSessionsCreatedBadges } from "@/lib/badges";
import { parseReminderTimingsFromFormData } from "@/lib/reminder-timings";
import { parseNotifyRecipientsFromFormData } from "@/lib/notify-recipients";
import { logger } from "@/lib/logger";
import { checkRateLimit, RATE_LIMIT_ERROR_KEY } from "@/lib/rate-limit";
import {
  createSessionSchema,
  editSessionSchema,
  sessionPlayedMinutesSchema,
  VALIDATION_ERROR_KEY,
} from "@/lib/validations";

export async function createSession(formData: FormData) {
  const startedAt = performance.now();
  let previousAt = startedAt;
  const durations: Record<string, number> = {};
  const measure = (phase: string) => {
    const now = performance.now();
    durations[phase] = Math.round(now - previousAt);
    previousAt = now;
  };
  // L'activité est enregistrée par la page ; l'action garde les contrôles
  // de session/appartenance sans reprendre les verrous de streak.
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  measure("authentication");
  const resumed = await resumeCreation(user.id, "SESSION", formData);
  if (resumed) redirect(resumed);
  if (!checkRateLimit(user.id, "createSession")) {
    redirect(`/sessions?error=${RATE_LIMIT_ERROR_KEY}`);
  }

  const input = createSessionSchema.safeParse({
    date: String(formData.get("date") ?? ""),
    time: String(formData.get("time") ?? ""),
    notifyUserIds: parseNotifyRecipientsFromFormData(formData),
  });
  if (!input.success) {
    redirect(`/sessions?error=${VALIDATION_ERROR_KEY}`);
  }
  const { date: dateStr, time: timeStr, notifyUserIds } = input.data;

  const schedule = resolveSessionSchedule({
    dateStr,
    timeStr,
    deadlineDateStr: String(formData.get("deadlineDate") ?? "").trim(),
    deadlineTimeStr: String(formData.get("deadlineTime") ?? "").trim(),
    deadlineOffset: String(formData.get("deadlineOffset") ?? "6"),
  });
  if (!schedule.ok) {
    redirect(`/sessions?error=${schedule.error}`);
  }
  const { date, votingDeadline, deadlineAdjusted } = schedule;
  const recurrenceValue = String(formData.get("recurrence") ?? "");
  const recurrenceCount = Number(formData.get("recurrenceCount") ?? "4");
  if (recurrenceValue && !["weekly", "monthly"].includes(recurrenceValue)) redirect(`/sessions?error=${VALIDATION_ERROR_KEY}`);
  if (recurrenceValue && (!Number.isInteger(recurrenceCount) || recurrenceCount < 2 || recurrenceCount > 12)) {
    redirect(`/sessions?error=${VALIDATION_ERROR_KEY}`);
  }
  const occurrenceDates = recurrenceValue
    ? recurringSessionDates(date, recurrenceValue as SessionRecurrence, recurrenceCount)
    : [date];

  const customReminderMessage =
    String(formData.get("customReminderMessage") ?? "").trim() || null;
  const reminderTimings = parseReminderTimingsFromFormData(formData);
  // Ne garde que des ids qui correspondent réellement à un user existant —
  // la liste vient de checkboxes générées depuis une vraie liste de potes,
  // mais une requête manipulée pourrait envoyer un id périmé/inventé ; on
  // filtre silencieusement plutôt que de faire échouer toute la création
  // pour un seul destinataire invalide.
  // Multi-communautés (PR3/PR4) : sans `COMMUNITY_CHANNELS_ENABLED` ni
  // `COMMUNITY_ISOLATION_ENABLED`, `communityId` reste `null` et rien ne
  // change. Sous isolation, sans aucune communauté on refuse (la soirée serait
  // sinon rattachée à `default` sans que le créateur en soit membre) ; seuls
  // des membres de CETTE communauté sont invités/mentionnables.
  const communityId = await pickCreationCommunityId(user.id);
  if (isCommunityIsolationEnabled() && communityId === null) {
    redirect(`/sessions?error=${VALIDATION_ERROR_KEY}`);
  }
  const notifiedUserIds = notifyUserIds.length
    ? (
        await prisma.user.findMany({
          where: { AND: [{ id: { in: notifyUserIds } }, await communityMemberUserWhere(communityId)] },
          select: { id: true },
        })
      ).map((u) => u.id)
    : [];

  // Figé une seule fois ici, jamais relu depuis l'env ensuite — voir le
  // commentaire du champ dans schema.prisma (chantier annonces bot).
  const announceViaBot = await isSessionAnnounceViaBotEnabledFor(communityId);
  await requireCommunityBotAnnouncement(communityId, announceViaBot);
  measure("validation");

  // Création de la session ET enqueue de l'intention de notification bot
  // dans LA MÊME transaction SQL — trouvé lors de la revue ciblée de cette
  // PR : les deux étaient jusqu'ici deux appels séquentiels distincts,
  // donc un crash entre les deux (process tué, panne DB momentanée après
  // le premier `await`) aurait laissé une session `announceViaBot=true`
  // sans jamais aucune `NotificationEvent`/`NotificationDelivery` créée
  // pour elle — orpheline, jamais annoncée, sans échec observable nulle
  // part. Aucun appel Discord n'est fait ici (seulement des écritures,
  // voir `enqueueSessionCreationDeliveries`) : la transaction reste
  // courte, cohérente avec l'interdiction d'appel réseau dans une
  // transaction SQL (notification-delivery.ts). Si l'enqueue échoue,
  // toute la transaction (y compris la création de la session) est
  // annulée — préféré à une session silencieusement jamais annoncée :
  // l'échec redevient visible (l'action lève, la création peut être
  // retentée), au lieu de réussir à moitié sans trace.
  // shortcut: a series contains 2–12 independent sessions with no later series editing; add a persisted series model if users need bulk changes.
  const { result: session, replayed } = await createOnce(user.id, "SESSION", creationKey(formData.get("creationKey"), true), async (tx) => {
    const sessions = [];
    for (const occurrenceDate of occurrenceDates) {
      sessions.push(await createVotingSessionInTransaction(tx, {
        date: occurrenceDate,
        votingDeadline: new Date(occurrenceDate.getTime() - (date.getTime() - votingDeadline.getTime())),
        customReminderMessage,
        reminderTimings,
        notifiedUserIds,
        createdById: user.id,
        announceViaBot,
        communityId,
      }));
    }
    return sessions[0];
  }, (created) => created.id, (tx, id) => tx.session.findUniqueOrThrow({ where: { id } }));
  measure("creationTransaction");

  const xpResult = await awardXp(user.id, session.communityId,
    "CREATE_SESSION",
    session.id,
    XP_AMOUNTS.CREATE_SESSION
  );
  const badgeUnlocked = await checkSessionsCreatedBadges(user.id, session.communityId);
  measure("rewards");

  // Jeu pré-sélectionné depuis la fiche jeu ("Proposer une soirée avec ce
  // jeu") : on le propose directement, sans passer par le formulaire de
  // /sessions/[id]. Best-effort — un gameId invalide/déjà retiré ne doit
  // pas empêcher la création de la session.
  const preselectedGameId = String(formData.get("gameId") ?? "").trim();
  if (preselectedGameId) {
    try {
      await prisma.proposal.create({
        data: { sessionId: session.id, gameId: preselectedGameId, proposedById: user.id },
      });
    } catch {
      // Jeu inexistant, ou contrainte unique — on ignore, la session reste utilisable.
    }
  }

  // Jamais les deux chemins à la fois : une session bot n'appelle jamais
  // le webhook, une session webhook n'enqueue jamais de livraison bot.
  // Côté bot, l'enqueue a déjà réussi de façon atomique avec la création
  // de la session ci-dessus (sinon la transaction entière aurait déjà levé
  // et cette ligne ne serait jamais atteinte) — rien de plus à tenter ici.
  const announceResult = announceViaBot
    ? { ok: true as const }
    : replayed ? { ok: true as const } : await announceSessionCreated(session, user);
  measure("proposalAndLegacyNotice");

  revalidatePath("/sessions");

  const params = new URLSearchParams();
  if (deadlineAdjusted) params.set("deadline", "ajustee");
  if (isRealDiscordFailure(announceResult)) params.set("discord", "echec");
  // Confettis (Sprint 2 PR-B, U9) — badge prioritaire sur level up si les
  // deux se produisent au même moment (plus rare, mérite plus l'attention).
  if (badgeUnlocked) params.set("celebrate", "badge");
  else if (xpResult.leveledUp) params.set("celebrate", "levelup");
  const query = params.toString();
  logger.info("perf:create-session", "Création confirmée avant navigation", {
    durationsMs: durations, totalMs: Math.round(performance.now() - startedAt),
    guestCount: notifiedUserIds.length, announceViaBot, replayed,
  });
  redirect(`/sessions/${session.id}${query ? `?${query}` : ""}`);
}

/**
 * Modification du créneau d'une session existante — réservée au créateur,
 * seuls date/heure/deadline de vote sont éditables (le champ créateur, lui,
 * ne change jamais après coup). Mêmes règles de validation qu'à la
 * création (`resolveSessionSchedule`, mutualisé, pas dupliqué) : deadline
 * toujours strictement avant la session, ajustement auto si elle tombe
 * dans le passé, refus si la session elle-même devient trop proche.
 *
 * Restreint aux sessions encore VOTING ou SCHEDULED — modifier le créneau
 * d'une soirée déjà DONE ou CANCELLED n'a pas de sens (rien à reprogrammer).
 * Si la session était déjà décidée (`decidedTime` renseigné à la clôture,
 * simple copie de `date`), on le resynchronise avec la nouvelle date pour
 * ne pas laisser les deux champs diverger.
 */
export async function editSessionAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "editSession")) return;

  const rawSessionId = String(formData.get("sessionId") ?? "");
  const input = editSessionSchema.safeParse({
    sessionId: rawSessionId,
    date: String(formData.get("date") ?? ""),
    time: String(formData.get("time") ?? ""),
    deadlineDate: String(formData.get("deadlineDate") ?? "").trim(),
    deadlineTime: String(formData.get("deadlineTime") ?? "").trim(),
  });
  if (!input.success) {
    // `sessionId` fait partie du schéma (donc potentiellement absent ici),
    // mais on ne peut rediriger vers `/sessions/[id]` sans lui — repli sur
    // la valeur brute du formulaire pour ne pas perdre l'utilisateur en
    // silence sur un cas qui ne devrait de toute façon jamais arriver via
    // le modal d'édition (champs `required`).
    if (rawSessionId) {
      redirect(`/sessions/${rawSessionId}?error=${VALIDATION_ERROR_KEY}`);
    }
    return;
  }
  const {
    sessionId,
    date: dateStr,
    time: timeStr,
    deadlineDate: deadlineDateStr,
    deadlineTime: deadlineTimeStr,
  } = input.data;

  const scopedDb = await getScopedPrisma(user.id);
  const existing = await scopedDb.session.findUnique({ where: { id: sessionId } });
  if (!existing || existing.createdById !== user.id) return;
  if (existing.status === "DONE" || existing.status === "CANCELLED") return;
  // Chemin figé à la création de CETTE session (jamais relu depuis l'env
  // ici) — voir le commentaire du champ dans schema.prisma.
  const announceViaBot = existing.announceViaBot;

  const schedule = resolveSessionSchedule({
    dateStr,
    timeStr,
    deadlineDateStr,
    deadlineTimeStr,
    deadlineOffset: "6",
  });
  if (!schedule.ok) {
    redirect(`/sessions/${sessionId}?error=${schedule.error}`);
  }
  const { date, votingDeadline, deadlineAdjusted } = schedule;

  const previous = { date: existing.date, votingDeadline: existing.votingDeadline };

  // Mutation ET enqueue bot dans LA MÊME transaction — voir
  // `updateSessionSchedule` (sessions.ts, mutualisé, testé directement).
  // Le chemin webhook (`announceSessionModified`) reste HORS transaction,
  // inchangé — un appel réseau ne doit jamais être tenu dans une
  // transaction SQL, et son propre best-effort existant n'a pas à changer
  // ici.
  await updateSessionSchedule(
    sessionId,
    { date, votingDeadline, ...(existing.decidedTime ? { decidedTime: date } : {}) },
    announceViaBot
  );

  const announceResult = announceViaBot
    ? { ok: true as const }
    : await announceSessionModified({ id: sessionId, date, votingDeadline }, previous, user);

  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");

  const params = new URLSearchParams();
  if (deadlineAdjusted) params.set("deadline", "ajustee");
  if (isRealDiscordFailure(announceResult)) params.set("discord", "echec");
  const query = params.toString();
  redirect(`/sessions/${sessionId}${query ? `?${query}` : ""}`);
}

export async function closeSessionAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "closeSession")) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;

  // Clôture manuelle réservée au créateur — la clôture automatique
  // (deadline/heure dépassée, `closeSessionIfDue`) reste accessible à
  // tout le monde puisqu'elle se déclenche à la lecture, sans bouton.
  const scopedDb = await getScopedPrisma(user.id);
  const session = await scopedDb.session.findUnique({
    where: { id: sessionId },
    select: { createdById: true },
  });
  if (!session || session.createdById !== user.id) return;

  const result = await closeSession(sessionId);
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");

  // `result.discord === null` : clôture silencieuse (0 votant, cf.
  // `closeSession`) — pas un échec d'envoi, rien à signaler.
  if (result?.discord && isRealDiscordFailure(result.discord)) {
    redirect(`/sessions/${sessionId}?discord=echec`);
  }
}

/**
 * Réservé au créateur de la session (même contrainte que
 * `cancelSessionAction` juste en dessous) OU à un admin (PR "Accès &
 * secrets" — jusqu'ici n'importe quel pote connecté pouvait renvoyer
 * l'annonce Discord de n'importe quelle session).
 */
export async function resendDiscordAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "resendDiscord")) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;

  const scopedDb = await getScopedPrisma(user.id);
  const session = await scopedDb.session.findUnique({
    where: { id: sessionId },
    select: { createdById: true },
  });
  if (!session) return;
  if (session.createdById !== user.id && !(await requireAdmin())) return;

  const result = await resendSessionAnnouncement(sessionId);
  const status = result.ok ? "envoye" : isRealDiscordFailure(result) ? "echec" : "desactive";
  redirect(`/sessions/${sessionId}?discord=${status}`);
}

export async function cancelSessionAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "cancelSession")) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;

  // Annulation manuelle réservée au créateur (même logique que la clôture
  // manuelle ci-dessus).
  const scopedDb = await getScopedPrisma(user.id);
  const session = await scopedDb.session.findUnique({
    where: { id: sessionId },
    select: { createdById: true },
  });
  if (!session || session.createdById !== user.id) return;

  await cancelSession(sessionId);
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");
}

/**
 * Suppression définitive d'une session — réservée au créateur. Cascade
 * automatique via le schéma (`onDelete: Cascade` sur Proposal → Session et
 * Vote → Proposal) : les propositions et votes liés disparaissent avec la
 * session, et comme les rappels F7 sont un simple champ JSON sur la ligne
 * Session elle-même (`remindersSent`), rien à nettoyer séparément pour eux.
 *
 * Chantier nettoyage réel du stockage (V2) — jusqu'ici AUCUNE notification
 * Discord n'accompagnait cette suppression (contrairement à l'annulation,
 * annoncée via F6), volontairement décrit comme "ménage silencieux" : ça
 * reste vrai pour l'ANNONCE (rien n'est envoyé dans le salon), mais si la
 * soirée avait un fil privé (`announceViaBot`), il est désormais
 * DÉFINITIVEMENT supprimé, AVEC ses messages — sans quoi il resterait
 * indéfiniment accessible à ses membres alors que la soirée elle-même a
 * disparu du site. Enqueue-é (intention seulement, jamais un appel Discord
 * réel ici) DANS LA MÊME TRANSACTION que la suppression de la ligne
 * `Session` elle-même — un crash entre les deux ne doit jamais laisser une
 * soirée supprimée en base sans que son fil ne soit jamais nettoyé. Aucune
 * transaction atomique DB+Discord n'est promise : l'appel Discord réel a
 * nécessairement lieu après, via l'exécuteur (voir
 * `enqueueSessionThreadDelete`, session-announce.ts, pour le traitement
 * complet des races possibles).
 */
export async function deleteSessionAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "deleteSession")) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;

  const scopedDb = await getScopedPrisma(user.id);
  const session = await scopedDb.session.findUnique({
    where: { id: sessionId },
    select: { createdById: true, announceViaBot: true },
  });
  if (!session || session.createdById !== user.id) return;

  await prisma.$transaction(async (tx) => {
    if (session.announceViaBot) {
      await enqueueSessionThreadDelete(sessionId, tx);
    }
    await tx.session.delete({ where: { id: sessionId } });
  });
  revalidatePath("/sessions");
  redirect("/sessions");
}

export async function markSessionDoneAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "markSessionDone")) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;
  const duration = sessionPlayedMinutesSchema.safeParse(formData.get("playedMinutes"));
  if (!duration.success) {
    redirect(`/sessions/${sessionId}?error=duration_invalide`);
  }
  const playedMinutes = duration.data;

  // Pas explicitement listée dans l'alignement des permissions demandé
  // (qui nomme "modifier/supprimer/clôturer/annuler"), mais c'est la même
  // famille d'action de gestion du cycle de vie de la soirée que
  // clôturer/annuler — cohérent avec "le créateur gère sa soirée, les
  // autres votent" de restreindre celle-ci aussi.
  const scopedDb = await getScopedPrisma(user.id);
  const session = await scopedDb.session.findUnique({
    where: { id: sessionId },
    select: { createdById: true },
  });
  if (!session || session.createdById !== user.id) return;

  const { unlockedAchievements } = await markSessionDone(sessionId, playedMinutes);
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");
  revalidatePath("/");

  // Sprint 3 suite — confettis pour le créateur qui vient de clôturer,
  // si ça a débloqué un trophée de groupe (même mécanique `?celebrate=`
  // que badge/level up ailleurs dans le chantier).
  if (unlockedAchievements.length > 0) {
    redirect(`/sessions/${sessionId}?celebrate=achievement`);
  }
}
