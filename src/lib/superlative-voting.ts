import { prisma } from "@/lib/prisma";
import { wallClockNow } from "@/lib/wallclock";
import { awardXp } from "@/lib/xp-actions";
import { announceSessionAwards } from "@/lib/discord-session-awards";
import type { User } from "@prisma/client";

const VOTING_WINDOW_MS = 24 * 60 * 60 * 1000;
// En dessous de 2 participants, il n'y a personne à désigner pour l'autre
// (voter pour soi-même est exclu) — pas de fenêtre de vote ouverte du tout.
const MIN_PARTICIPANTS_FOR_VOTING = 2;

/**
 * Participants éligibles au vote de superlatifs pour une session décidée
 * — même définition que l'XP `PARTICIPATE` (PR 2/9) et les participants
 * de `/sessions/[id]/resultats` (PR 3/9) : les users ayant voté pour la
 * proposition **gagnante**. Volontairement unifiée dans tout le chantier,
 * une seule notion de "présence" plutôt que plusieurs qui pourraient
 * diverger.
 */
export async function getWinningProposalParticipants(
  sessionId: string,
  decidedGameId: string
): Promise<User[]> {
  const winningProposal = await prisma.proposal.findFirst({
    where: { sessionId, gameId: decidedGameId },
    include: { votes: { include: { user: true } } },
  });
  return winningProposal?.votes.map((v) => v.user) ?? [];
}

/**
 * Ouvre (ou ferme d'emblée) la fenêtre de vote de superlatifs — appelée
 * par `markSessionDone` (src/lib/sessions.ts) juste après le passage en
 * `DONE`. Moins de 2 participants : rien à voter, `superlativeVotingClosed`
 * passe direct à `true` pour qu'aucune UI de vote ne s'affiche jamais.
 */
export async function openSuperlativeVotingWindow(
  sessionId: string,
  decidedGameId: string | null
): Promise<void> {
  if (!decidedGameId) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { superlativeVotingClosed: true },
    });
    return;
  }

  const participants = await getWinningProposalParticipants(sessionId, decidedGameId);

  if (participants.length < MIN_PARTICIPANTS_FOR_VOTING) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { superlativeVotingClosed: true },
    });
    return;
  }

  await prisma.session.update({
    where: { id: sessionId },
    data: { superlativeVotingDeadline: new Date(Date.now() + VOTING_WINDOW_MS) },
  });
}

async function haveAllParticipantsVoted(
  sessionId: string,
  participants: User[]
): Promise<boolean> {
  if (participants.length === 0) return true;

  const voters = await prisma.superlativeVote.findMany({
    where: { sessionId },
    select: { voterUserId: true },
    distinct: ["voterUserId"],
  });
  const votedIds = new Set(voters.map((v) => v.voterUserId));
  return participants.every((p) => votedIds.has(p.id));
}

/**
 * Calcule les gagnants, attribue l'XP, annonce dans Discord (si au moins
 * un award), et clôture. Jamais appelée directement de l'extérieur de ce
 * fichier — toujours via `finalizeSuperlativeVotingIfDue` (chemin
 * paresseux "tout le monde a voté OU deadline dépassée") ou
 * `forceFinalizeSuperlativeVoting` (bouton créateur).
 */
async function finalizeSuperlativeVoting(sessionId: string): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { decidedGame: true },
  });
  if (!session?.decidedGame) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { superlativeVotingClosed: true },
    });
    return;
  }

  const [categories, votes] = await Promise.all([
    prisma.superlativeCategory.findMany({ where: { active: true } }),
    prisma.superlativeVote.findMany({ where: { sessionId } }),
  ]);

  const awards: { categoryId: string; winnerUserId: string; voteCount: number }[] = [];

  for (const category of categories) {
    const categoryVotes = votes.filter((v) => v.categoryId === category.id);
    if (categoryVotes.length === 0) continue;

    const tally = new Map<string, number>();
    for (const vote of categoryVotes) {
      tally.set(vote.votedForUserId, (tally.get(vote.votedForUserId) ?? 0) + 1);
    }
    const maxVotes = Math.max(...tally.values());
    // Égalité de votes → tirage aléatoire parmi les ex-aequo, comme demandé.
    const topUserIds = [...tally.entries()]
      .filter(([, count]) => count === maxVotes)
      .map(([userId]) => userId);
    const winnerUserId = topUserIds[Math.floor(Math.random() * topUserIds.length)];

    awards.push({ categoryId: category.id, winnerUserId, voteCount: maxVotes });
  }

  if (awards.length === 0) {
    // 0 vote au total (ou aucune catégorie active) : session terminée
    // sans awards, silence — pas d'embed, pas d'XP, comme demandé.
    await prisma.session.update({
      where: { id: sessionId },
      data: { superlativeVotingClosed: true },
    });
    return;
  }

  await prisma.superlativeAward.createMany({
    data: awards.map((a) => ({
      sessionId,
      categoryId: a.categoryId,
      winnerUserId: a.winnerUserId,
      voteCount: a.voteCount,
    })),
  });

  for (const award of awards) {
    const category = categories.find((c) => c.id === award.categoryId);
    if (!category) continue;
    await awardXp(
      award.winnerUserId,
      "SUPERLATIVE_AWARD",
      `${sessionId}:${award.categoryId}`,
      category.xpReward
    );
  }

  await prisma.session.update({
    where: { id: sessionId },
    data: { superlativeVotingClosed: true },
  });

  const winners = await prisma.user.findMany({
    where: { id: { in: awards.map((a) => a.winnerUserId) } },
  });
  const winnerMap = new Map(winners.map((w) => [w.id, w]));

  await announceSessionAwards(
    session.decidedGame.name,
    awards
      .map((a) => {
        const category = categories.find((c) => c.id === a.categoryId);
        const winner = winnerMap.get(a.winnerUserId);
        if (!category || !winner) return null;
        return {
          icon: category.icon,
          categoryName: category.name,
          winnerDiscordId: winner.discordId,
          winnerDiscordName: winner.discordName,
          voteCount: a.voteCount,
        };
      })
      .filter((w) => w !== null)
  );
}

/**
 * Clôture paresseuse — vérifiée à la lecture (mêmes pages que
 * `closeSessionIfDue` pour le vote de jeu), pas de cron dédié. Se
 * déclenche dès que tous les participants ont voté OU que la deadline de
 * 24h est dépassée, whichever comes first.
 */
export async function finalizeSuperlativeVotingIfDue(sessionId: string): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      status: true,
      decidedGameId: true,
      superlativeVotingClosed: true,
      superlativeVotingDeadline: true,
    },
  });
  if (!session || session.status !== "DONE") return;
  if (session.superlativeVotingClosed) return;
  if (!session.decidedGameId || !session.superlativeVotingDeadline) return;

  const participants = await getWinningProposalParticipants(
    sessionId,
    session.decidedGameId
  );
  const deadlinePassed = wallClockNow() >= session.superlativeVotingDeadline;
  const allVoted = await haveAllParticipantsVoted(sessionId, participants);

  if (!allVoted && !deadlinePassed) return;

  await finalizeSuperlativeVoting(sessionId);
}

/**
 * Sessions (parmi `sessionIds`, censées être DONE) pour lesquelles
 * `userId` doit encore voter — vote pas fermé, `userId` fait partie des
 * participants (proposition gagnante), et n'a pas encore voté. Utilisée
 * pour le badge "🏆 Vote les superlatifs !" sur /sessions et
 * /sessions/[id]. Pas optimisée pour un grand nombre de sessions (boucle
 * par session pour les participants) — cohérent avec l'échelle de l'app
 * (un groupe de potes, pas des milliers de sessions DONE en parallèle).
 */
export async function getPendingSuperlativeVoteSessionIds(
  userId: string,
  sessionIds: string[]
): Promise<Set<string>> {
  if (sessionIds.length === 0) return new Set();

  const sessions = await prisma.session.findMany({
    where: {
      id: { in: sessionIds },
      status: "DONE",
      superlativeVotingClosed: false,
      decidedGameId: { not: null },
    },
    select: { id: true, decidedGameId: true },
  });
  if (sessions.length === 0) return new Set();

  const alreadyVoted = await prisma.superlativeVote.findMany({
    where: {
      sessionId: { in: sessions.map((s) => s.id) },
      voterUserId: userId,
    },
    select: { sessionId: true },
    distinct: ["sessionId"],
  });
  const votedSessionIds = new Set(alreadyVoted.map((v) => v.sessionId));

  const pending = new Set<string>();
  for (const session of sessions) {
    if (votedSessionIds.has(session.id)) continue;
    const participants = await getWinningProposalParticipants(
      session.id,
      session.decidedGameId!
    );
    if (participants.some((p) => p.id === userId)) pending.add(session.id);
  }
  return pending;
}

/** Bouton créateur "Forcer la clôture maintenant" — ignore la deadline et le "tout le monde a voté". */
export async function forceFinalizeSuperlativeVoting(sessionId: string): Promise<void> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { status: true, superlativeVotingClosed: true },
  });
  if (!session || session.status !== "DONE" || session.superlativeVotingClosed) return;

  await finalizeSuperlativeVoting(sessionId);
}
