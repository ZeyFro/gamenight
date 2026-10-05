"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getScopedPrisma } from "@/lib/community-scoped-client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import {
  finalizeSuperlativeVotingIfDue,
  forceFinalizeSuperlativeVoting,
  getWinningProposalParticipants,
} from "@/lib/superlative-voting";
import { checkRateLimit } from "@/lib/rate-limit";
import { canAccessSession } from "@/lib/session-access";
import { superlativeVoteEntrySchema } from "@/lib/validations";

/**
 * Vote de superlatifs entre potes (PR 5/9, version light — remplace la
 * saisie de stats chiffrées initialement prévue). Un seul vote par user
 * par session, verrouillé dès soumission — même rationale que
 * `submitSessionResultsAction` : `XpEvent` est un ledger append-only, pas
 * de correction possible après coup.
 *
 * Formulaire tout-ou-rien : chaque catégorie active doit avoir un vote
 * valide (pour un participant autre que soi-même) sinon rien n'est
 * enregistré — pas de vote partiel silencieux.
 */
export async function submitSuperlativeVotesAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "submitSuperlativeVotes")) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;

  if (!(await canAccessSession(user.id, sessionId))) return;
  const scopedDb = await getScopedPrisma(user.id);
  const session = await scopedDb.session.findUnique({
    where: { id: sessionId },
    select: {
      status: true,
      decidedGameId: true,
      superlativeVotingClosed: true,
    },
  });
  if (!session || session.status !== "DONE" || !session.decidedGameId) return;
  if (session.superlativeVotingClosed) return;
  if (!(await canAccessSession(user.id, sessionId))) return;

  const participants = await getWinningProposalParticipants(
    sessionId,
    session.decidedGameId
  );
  const isParticipant = participants.some((p) => p.id === user.id);
  if (!isParticipant) return;

  const alreadyVoted =
    (await prisma.superlativeVote.count({
      where: { sessionId, voterUserId: user.id },
    })) > 0;
  if (alreadyVoted) return;

  const categories = await prisma.superlativeCategory.findMany({
    where: { active: true },
  });
  if (categories.length === 0) return;

  const participantIds = new Set(participants.map((p) => p.id));

  const votes: {
    sessionId: string;
    categoryId: string;
    voterUserId: string;
    votedForUserId: string;
  }[] = [];
  for (const category of categories) {
    const entry = superlativeVoteEntrySchema.safeParse({
      categoryId: category.id,
      votedForUserId: String(formData.get(`vote-${category.id}`) ?? ""),
    });
    if (
      !entry.success ||
      entry.data.votedForUserId === user.id ||
      !participantIds.has(entry.data.votedForUserId)
    ) {
      // Formulaire incomplet/invalide (ou tentative de voter pour
      // soi-même) : on rejette tout, pas de vote partiel.
      return;
    }
    votes.push({
      sessionId,
      categoryId: category.id,
      voterUserId: user.id,
      votedForUserId: entry.data.votedForUserId,
    });
  }

  await prisma.superlativeVote.createMany({ data: votes });

  await finalizeSuperlativeVotingIfDue(sessionId);

  revalidatePath(`/sessions/${sessionId}/vote-superlatifs`);
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");
  redirect(`/sessions/${sessionId}/vote-superlatifs`);
}

/**
 * Bouton créateur "Forcer la clôture des votes maintenant" — ignore la
 * deadline de 24h et le "tout le monde a voté", pour ne pas attendre si
 * tout le groupe est déjà là.
 */
export async function forceCloseSuperlativeVotingAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "forceCloseSuperlativeVoting")) return;

  const sessionId = String(formData.get("sessionId") ?? "");
  if (!sessionId) return;

  const scopedDb = await getScopedPrisma(user.id);
  const session = await scopedDb.session.findUnique({
    where: { id: sessionId },
    select: { createdById: true },
  });
  if (!session || session.createdById !== user.id) return;

  await forceFinalizeSuperlativeVoting(sessionId);

  revalidatePath(`/sessions/${sessionId}/vote-superlatifs`);
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath("/sessions");
}
