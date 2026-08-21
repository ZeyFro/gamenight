"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { resolveSessionSchedule } from "@/lib/session-schedule";
import { announceSessionCreated } from "@/lib/discord-session-created";
import { announceSessionModified } from "@/lib/discord-session-modified";
import {
  cancelSession,
  closeSession,
  isVotingOpen,
  markSessionDone,
  resendSessionAnnouncement,
} from "@/lib/sessions";

export async function createSession(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const dateStr = String(formData.get("date") ?? "");
  const timeStr = String(formData.get("time") ?? "");
  if (!dateStr || !timeStr) return;

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

  const session = await prisma.session.create({
    data: { date, votingDeadline, customReminderMessage, createdById: user.id },
  });

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

  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;

  const existing = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!existing || existing.createdById !== user.id) return;
  if (existing.status === "DONE" || existing.status === "CANCELLED") return;

  const dateStr = String(formData.get("date") ?? "");
  const timeStr = String(formData.get("time") ?? "");
  const deadlineDateStr = String(formData.get("deadlineDate") ?? "").trim();
  const deadlineTimeStr = String(formData.get("deadlineTime") ?? "").trim();
  if (!dateStr || !timeStr || !deadlineDateStr || !deadlineTimeStr) return;

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

export async function proposeGame(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const sessionId = String(formData.get("sessionId") ?? "");
  const gameId = String(formData.get("gameId") ?? "");
  if (!sessionId || !gameId) return;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true, date: true, votingDeadline: true },
  });
  if (!session || !isVotingOpen(session)) return;

  try {
    await prisma.proposal.create({
      data: { sessionId, gameId, proposedById: user.id },
    });
  } catch {
    // Contrainte unique (sessionId, gameId) : déjà proposé, on ignore.
  }

  revalidatePath(`/sessions/${sessionId}`);
}

export async function toggleVote(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const proposalId = String(formData.get("proposalId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!proposalId || !sessionId) return;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true, date: true, votingDeadline: true },
  });
  if (!session || !isVotingOpen(session)) return;

  const existing = await prisma.vote.findUnique({
    where: { proposalId_userId: { proposalId, userId: user.id } },
  });

  if (existing) {
    await prisma.vote.delete({ where: { id: existing.id } });
  } else {
    await prisma.vote.create({ data: { proposalId, userId: user.id } });
  }

  revalidatePath(`/sessions/${sessionId}`);
}

/**
 * Retrait d'une proposition par son propre auteur — réservé à
 * `proposedById`, PAS au créateur de la session (qui gère la session dans
 * son ensemble via la suppression, mais n'a pas à retirer les propositions
 * des autres). Cascade automatique sur les votes via le schéma
 * (`onDelete: Cascade` sur `Vote.proposal`). Restreint au vote encore
 * ouvert, comme `proposeGame`/`toggleVote` : retirer une proposition après
 * clôture n'a pas d'effet utile (le gagnant est déjà figé dans
 * `Session.decidedGameId`, indépendant de la ligne `Proposal`).
 */
export async function withdrawProposalAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const proposalId = String(formData.get("proposalId") ?? "");
  const sessionId = String(formData.get("sessionId") ?? "");
  if (!proposalId || !sessionId) return;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true, date: true, votingDeadline: true },
  });
  if (!session || !isVotingOpen(session)) return;

  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { sessionId: true, proposedById: true },
  });
  if (
    !proposal ||
    proposal.sessionId !== sessionId ||
    proposal.proposedById !== user.id
  )
    return;

  await prisma.proposal.delete({ where: { id: proposalId } });
  revalidatePath(`/sessions/${sessionId}`);
}

export async function closeSessionAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

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

  if (result && !result.discord.ok) {
    redirect(`/sessions/${sessionId}?discord=echec`);
  }
}

export async function resendDiscordAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;

  const result = await resendSessionAnnouncement(sessionId);
  redirect(`/sessions/${sessionId}?discord=${result.ok ? "envoye" : "echec"}`);
}

export async function cancelSessionAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

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

  await markSessionDone(sessionId);
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");
}
