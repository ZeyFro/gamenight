"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { isVotingOpen } from "@/lib/sessions";
import { awardXp } from "@/lib/xp-actions";
import { XP_AMOUNTS } from "@/lib/xp";
import { checkVotesCastBadges } from "@/lib/badges";
import { checkRateLimit, RATE_LIMIT_ERROR_KEY } from "@/lib/rate-limit";
import {
  sessionGameRefSchema,
  sessionProposalRefSchema,
  toggleVoteSchema,
} from "@/lib/validations";

export async function proposeGame(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "proposeGame")) return;

  const input = sessionGameRefSchema.safeParse({
    sessionId: String(formData.get("sessionId") ?? ""),
    gameId: String(formData.get("gameId") ?? ""),
  });
  if (!input.success) return;
  const { sessionId, gameId } = input.data;

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

export interface ToggleVoteResult {
  ok: boolean;
  error?: string;
}

/**
 * Renvoie un résultat (au lieu d'un simple `void`) depuis PR "Rate
 * limiting" : `VoteButton.tsx` fait une mise à jour optimiste avant
 * d'appeler cette action, elle doit pouvoir la défaire si la requête est
 * refusée (rate limit) plutôt que de laisser le bouton mentir sur l'état
 * réel du vote.
 */
export async function toggleVote(formData: FormData): Promise<ToggleVoteResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "toggleVote")) {
    return { ok: false, error: RATE_LIMIT_ERROR_KEY };
  }

  const input = toggleVoteSchema.safeParse({
    proposalId: String(formData.get("proposalId") ?? ""),
  });
  if (!input.success) return { ok: true };
  const { proposalId } = input.data;

  // Fix bug remonté (vote inter-session) — la session vient UNIQUEMENT de
  // `Proposal.sessionId`, jamais d'un champ transmis par le client (qui
  // n'existe plus, cf. `toggleVoteSchema`) : voter avec un `proposalId`
  // valide vote toujours sur SA propre session, impossible d'associer une
  // proposition d'une autre session (potentiellement fermée) en la
  // faisant passer pour ouverte.
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: {
      sessionId: true,
      session: { select: { status: true, date: true, votingDeadline: true } },
    },
  });
  if (!proposal || !isVotingOpen(proposal.session)) return { ok: true };
  const sessionId = proposal.sessionId;

  const existing = await prisma.vote.findUnique({
    where: { proposalId_userId: { proposalId, userId: user.id } },
  });

  if (existing) {
    await prisma.vote.delete({ where: { id: existing.id } });
  } else {
    await prisma.vote.create({ data: { proposalId, userId: user.id } });
    // sourceId = proposalId (pas l'id du Vote) : un aller-retour
    // vote/dévote/revote sur la MÊME proposition ne doit pas re-créditer
    // l'XP à chaque fois (la contrainte unique sur XpEvent l'empêche déjà
    // via awardXp) ; voter sur une AUTRE proposition, en revanche, reste
    // une nouvelle action légitime.
    await awardXp(user.id, "VOTE", proposalId, XP_AMOUNTS.VOTE);
    await checkVotesCastBadges(user.id);
  }

  revalidatePath(`/sessions/${sessionId}`);
  return { ok: true };
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
  if (!checkRateLimit(user.id, "withdrawProposal")) return;

  const input = sessionProposalRefSchema.safeParse({
    proposalId: String(formData.get("proposalId") ?? ""),
    sessionId: String(formData.get("sessionId") ?? ""),
  });
  if (!input.success) return;
  const { proposalId, sessionId } = input.data;

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
