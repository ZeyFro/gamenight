"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { parseDateAndTime, wallClockNow } from "@/lib/wallclock";
import { announceSessionCreated } from "@/lib/discord-session-created";
import {
  cancelSession,
  closeSession,
  isVotingOpen,
  markSessionDone,
  resendSessionAnnouncement,
} from "@/lib/sessions";

// Fenêtre de vote minimale qu'on essaie toujours de garantir, et distance
// minimale entre "maintenant" et l'heure de la session en dessous de
// laquelle on refuse plutôt que de créer une soirée invotable (cf.
// ajustement de deadline ci-dessous).
const MIN_VOTING_BUFFER_MS = 30 * 60 * 1000;
const MIN_SESSION_LEAD_MS = 30 * 60 * 1000;

export async function createSession(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const dateStr = String(formData.get("date") ?? "");
  const timeStr = String(formData.get("time") ?? "");
  if (!dateStr || !timeStr) return;

  const date = parseDateAndTime(dateStr, timeStr);
  const now = wallClockNow();

  const deadlineDateStr = String(formData.get("deadlineDate") ?? "").trim();
  const deadlineTimeStr = String(formData.get("deadlineTime") ?? "").trim();

  let votingDeadline: Date;
  if (deadlineDateStr && deadlineTimeStr) {
    votingDeadline = parseDateAndTime(deadlineDateStr, deadlineTimeStr);
  } else {
    const offsetHours = Number(formData.get("deadlineOffset") ?? "6") || 6;
    votingDeadline = new Date(date.getTime() - offsetHours * 60 * 60 * 1000);
  }

  // Bug corrigé : un préréglage ("6h avant") ou une deadline explicite qui
  // tombe déjà dans le passé (ex. session ce soir 17h créée à 13h43 ->
  // deadline "6h avant" = 11h, déjà passée) faisait clôturer la session
  // instantanément à la première visite de sa page ("Soirée annulée").
  // Choix assumé : on ajuste la deadline plutôt que de refuser la
  // création — repoussée à "maintenant + 30 min" (fenêtre de vote
  // minimale), avec un bandeau explicite sur la page de la session
  // (`?deadline=ajustee`). Moins de friction qu'un refus pour une app où
  // créer une session à la dernière minute est un usage normal (c'est
  // justement ce qui a déclenché le bug en prod).
  let deadlineAdjusted = false;
  if (votingDeadline.getTime() <= now.getTime()) {
    votingDeadline = new Date(now.getTime() + MIN_VOTING_BUFFER_MS);
    deadlineAdjusted = true;
  }

  // La deadline doit toujours rester strictement avant l'heure de la
  // session — si l'ajustement ci-dessus la fait dépasser (session très
  // proche), on la recale juste avant la session plutôt que de casser cet
  // invariant.
  if (votingDeadline.getTime() >= date.getTime()) {
    votingDeadline = new Date(date.getTime() - 60_000);
    deadlineAdjusted = true;
  }

  // Cas dégénéré : la session elle-même est trop proche (ou déjà passée)
  // pour laisser un minimum de fenêtre de vote, même après ajustement —
  // là on refuse plutôt que de créer une session qu'il est impossible de
  // voter sereinement (cohérent avec la demande : comportement testé pour
  // une session dans 30 min avec deadline "6h avant").
  if (
    date.getTime() - now.getTime() < MIN_SESSION_LEAD_MS ||
    votingDeadline.getTime() <= now.getTime()
  ) {
    redirect("/sessions?error=session_trop_proche");
  }

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
