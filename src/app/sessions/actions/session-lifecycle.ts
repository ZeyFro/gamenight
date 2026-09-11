"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { requireAdmin } from "@/lib/admin";
import { resolveSessionSchedule } from "@/lib/session-schedule";
import { announceSessionCreated } from "@/lib/discord-session-created";
import { announceSessionModified } from "@/lib/discord-session-modified";
import { awardXp } from "@/lib/xp-actions";
import { XP_AMOUNTS } from "@/lib/xp";
import {
  cancelSession,
  closeSession,
  markSessionDone,
  resendSessionAnnouncement,
} from "@/lib/sessions";
import { checkSessionsCreatedBadges } from "@/lib/badges";
import { parseReminderTimingsFromFormData } from "@/lib/reminder-timings";
import { parseNotifyRecipientsFromFormData } from "@/lib/notify-recipients";
import { checkRateLimit, RATE_LIMIT_ERROR_KEY } from "@/lib/rate-limit";
import {
  createSessionSchema,
  editSessionSchema,
  VALIDATION_ERROR_KEY,
} from "@/lib/validations";

export async function createSession(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
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

  const customReminderMessage =
    String(formData.get("customReminderMessage") ?? "").trim() || null;
  const reminderTimings = parseReminderTimingsFromFormData(formData);
  // Ne garde que des ids qui correspondent réellement à un user existant —
  // la liste vient de checkboxes générées depuis une vraie liste de potes,
  // mais une requête manipulée pourrait envoyer un id périmé/inventé ; on
  // filtre silencieusement plutôt que de faire échouer toute la création
  // pour un seul destinataire invalide.
  const notifiedUserIds = notifyUserIds.length
    ? (
        await prisma.user.findMany({
          where: { id: { in: notifyUserIds } },
          select: { id: true },
        })
      ).map((u) => u.id)
    : [];

  const session = await prisma.session.create({
    data: {
      date,
      votingDeadline,
      customReminderMessage,
      reminderTimings,
      notifiedUserIds,
      createdById: user.id,
    },
  });

  const xpResult = await awardXp(
    user.id,
    "CREATE_SESSION",
    session.id,
    XP_AMOUNTS.CREATE_SESSION
  );
  const badgeUnlocked = await checkSessionsCreatedBadges(user.id);

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

  const announceResult = await announceSessionCreated(session, user);

  revalidatePath("/sessions");

  const params = new URLSearchParams();
  if (deadlineAdjusted) params.set("deadline", "ajustee");
  if (!announceResult.ok) params.set("discord", "echec");
  // Confettis (Sprint 2 PR-B, U9) — badge prioritaire sur level up si les
  // deux se produisent au même moment (plus rare, mérite plus l'attention).
  if (badgeUnlocked) params.set("celebrate", "badge");
  else if (xpResult.leveledUp) params.set("celebrate", "levelup");
  const query = params.toString();
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

  const existing = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!existing || existing.createdById !== user.id) return;
  if (existing.status === "DONE" || existing.status === "CANCELLED") return;

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

  await prisma.session.update({
    where: { id: sessionId },
    data: {
      date,
      votingDeadline,
      ...(existing.decidedTime ? { decidedTime: date } : {}),
    },
  });

  const announceResult = await announceSessionModified(
    { id: sessionId, date, votingDeadline },
    previous,
    user
  );

  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");

  const params = new URLSearchParams();
  if (deadlineAdjusted) params.set("deadline", "ajustee");
  if (!announceResult.ok) params.set("discord", "echec");
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
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { createdById: true },
  });
  if (!session || session.createdById !== user.id) return;

  const result = await closeSession(sessionId);
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");

  // `result.discord === null` : clôture silencieuse (0 votant, cf.
  // `closeSession`) — pas un échec d'envoi, rien à signaler.
  if (result?.discord && !result.discord.ok) {
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

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { createdById: true },
  });
  if (!session) return;
  if (session.createdById !== user.id && !(await requireAdmin())) return;

  const result = await resendSessionAnnouncement(sessionId);
  redirect(`/sessions/${sessionId}?discord=${result.ok ? "envoye" : "echec"}`);
}

export async function cancelSessionAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "cancelSession")) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;

  // Annulation manuelle réservée au créateur (même logique que la clôture
  // manuelle ci-dessus).
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { createdById: true },
  });
  if (!session || session.createdById !== user.id) return;

  await cancelSession(sessionId);
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");
}

/**
 * Suppression définitive d'une session — réservée au créateur, jamais de
 * notification Discord (contrairement à l'annulation, qui reste annoncée
 * via F6 : supprimer, c'est du ménage silencieux, pas un événement à
 * communiquer au groupe). Cascade automatique via le schéma
 * (`onDelete: Cascade` sur Proposal → Session et Vote → Proposal) : les
 * propositions et votes liés disparaissent avec la session, et comme les
 * rappels F7 sont un simple champ JSON sur la ligne Session elle-même
 * (`remindersSent`), rien à nettoyer séparément pour eux.
 */
export async function deleteSessionAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "deleteSession")) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { createdById: true },
  });
  if (!session || session.createdById !== user.id) return;

  await prisma.session.delete({ where: { id: sessionId } });
  revalidatePath("/sessions");
  redirect("/sessions");
}

export async function markSessionDoneAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "markSessionDone")) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;

  // Pas explicitement listée dans l'alignement des permissions demandé
  // (qui nomme "modifier/supprimer/clôturer/annuler"), mais c'est la même
  // famille d'action de gestion du cycle de vie de la soirée que
  // clôturer/annuler — cohérent avec "le créateur gère sa soirée, les
  // autres votent" de restreindre celle-ci aussi.
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { createdById: true },
  });
  if (!session || session.createdById !== user.id) return;

  const { unlockedAchievements } = await markSessionDone(sessionId);
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
