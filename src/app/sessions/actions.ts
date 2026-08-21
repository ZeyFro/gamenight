"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { parseDateAndTime } from "@/lib/wallclock";
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

  const date = parseDateAndTime(dateStr, timeStr);

  const deadlineDateStr = String(formData.get("deadlineDate") ?? "").trim();
  const deadlineTimeStr = String(formData.get("deadlineTime") ?? "").trim();

  let votingDeadline: Date;
  if (deadlineDateStr && deadlineTimeStr) {
    votingDeadline = parseDateAndTime(deadlineDateStr, deadlineTimeStr);
  } else {
    const offsetHours = Number(formData.get("deadlineOffset") ?? "6") || 6;
    votingDeadline = new Date(date.getTime() - offsetHours * 60 * 60 * 1000);
  }

  if (votingDeadline >= date) {
    redirect("/sessions?error=deadline_apres_session");
  }

  const session = await prisma.session.create({
    data: { date, votingDeadline },
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

  revalidatePath("/sessions");
  redirect(`/sessions/${session.id}`);
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

  await cancelSession(sessionId);
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");
}

export async function markSessionDoneAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;

  await markSessionDone(sessionId);
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");
}
