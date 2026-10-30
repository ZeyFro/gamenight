export interface ChallengeVote {
  voterId: string;
  approve: boolean;
  votedAt: Date;
}

type VoteResult =
  | { status: "OPEN"; approvals: number; rejections: number }
  | { status: "APPROVED" | "REJECTED"; approvals: number; rejections: number };

// Cette règle ne remplace ni le contrôle d'appartenance ni le verrou de clôture en base.
export function evaluateChallengeVote(input: {
  authorId: string;
  openedAt: Date;
  now: Date;
  votes: readonly ChallengeVote[];
}): VoteResult {
  const opened = input.openedAt.getTime();
  const current = input.now.getTime();
  if (!input.authorId.trim() || !Number.isFinite(opened) || !Number.isFinite(current) || current < opened) {
    throw new RangeError("Ouverture de vote invalide");
  }
  const closes = opened + 24 * 60 * 60 * 1000;
  const voters = new Set<string>();
  let approvals = 0;
  let rejections = 0;
  for (const vote of input.votes) {
    const cast = vote.votedAt.getTime();
    if (!vote.voterId.trim() || vote.voterId === input.authorId || voters.has(vote.voterId)
      || typeof vote.approve !== "boolean" || !Number.isFinite(cast)
      || cast < opened || cast >= closes || cast > current) {
      throw new RangeError("Vote invalide ou dupliqué");
    }
    voters.add(vote.voterId);
    if (vote.approve) approvals += 1;
    else rejections += 1;
  }
  const tally = { approvals, rejections };
  if (current < closes) return { status: "OPEN", ...tally };
  if (voters.size < 3 || approvals === rejections) return { status: "REJECTED", ...tally };
  return { status: approvals > rejections ? "APPROVED" : "REJECTED", ...tally };
}
