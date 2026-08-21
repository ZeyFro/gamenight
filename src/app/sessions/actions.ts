"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { parseDateAndTime } from "@/lib/wallclock";
import { cancelSession, closeSession, markSessionDone } from "@/lib/sessions";

export async function createSession(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const dateStr = String(formData.get("date") ?? "");
  const timeStr = String(formData.get("time") ?? "");
  if (!dateStr || !timeStr) return;

  const session = await prisma.session.create({
    data: { date: parseDateAndTime(dateStr, timeStr) },
  });

  revalidatePath("/sessions");
  redirect(`/sessions/${session.id}`);
}

export async function proposeGame(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const sessionId = String(formData.get("sessionId") ?? "");
  const gameId = String(formData.get("gameId") ?? "");
  if (!sessionId || !gameId) return;

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
  if (!proposalId) return;

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

  await closeSession(sessionId);
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");
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
