export interface ChallengeVote {
  voterId: string;
  approve: boolean;
  votedAt: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const TOWER_CHALLENGE_VOTE_QUORUM = 3;
export const TOWER_CHALLENGE_MAX_QUORUM_RESUBMISSIONS = 1;

type VoteResult =
  | { status: "OPEN"; approvals: number; rejections: number }
  | { status: "APPROVED" | "REJECTED"; approvals: number; rejections: number }
  // 24 h écoulées sans quorum, prolongation pas encore enregistrée : une seule fois, +24 h.
  | { status: "EXTEND"; approvals: number; rejections: number }
  // Prolongation écoulée sans quorum : rejet sans pénalité (voir canResubmitAfterNoQuorum).
  | { status: "NO_QUORUM"; approvals: number; rejections: number };

/** Échéance du vote : 24 h, plus 24 h une seule fois si la prolongation sans quorum a été enregistrée. */
export function challengeVoteDeadline(openedAt: Date, extended = false): Date {
  const opened = openedAt.getTime();
  if (!Number.isFinite(opened)) {
    throw new RangeError("Ouverture de vote invalide");
  }
  return new Date(opened + (extended ? 2 : 1) * DAY_MS);
}

/** Une seule resoumission après un rejet sans quorum. */
export function canResubmitAfterNoQuorum(resubmissionCount: number): boolean {
  if (!Number.isInteger(resubmissionCount) || resubmissionCount < 0) throw new RangeError("Compteur de resoumissions invalide");
  return resubmissionCount < TOWER_CHALLENGE_MAX_QUORUM_RESUBMISSIONS;
}

// Cette règle ne remplace ni le contrôle d'appartenance ni le verrou de clôture en base.
export function evaluateChallengeVote(input: {
  authorId: string;
  openedAt: Date;
  now: Date;
  votes: readonly ChallengeVote[];
  extended?: boolean;
}): VoteResult {
  const opened = input.openedAt.getTime();
  const current = input.now.getTime();
  if (!input.authorId.trim() || !Number.isFinite(opened) || !Number.isFinite(current) || current < opened) {
    throw new RangeError("Ouverture de vote invalide");
  }
  const closes = challengeVoteDeadline(input.openedAt, input.extended === true).getTime();
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
  if (voters.size < TOWER_CHALLENGE_VOTE_QUORUM) return { status: input.extended === true ? "NO_QUORUM" : "EXTEND", ...tally };
  if (approvals === rejections) return { status: "REJECTED", ...tally };
  return { status: approvals > rejections ? "APPROVED" : "REJECTED", ...tally };
}

export function missingChallengeVoters(distinctVoters: number): number {
  if (typeof distinctVoters !== "number" || !Number.isFinite(distinctVoters) || !Number.isInteger(distinctVoters) || distinctVoters < 0) {
    throw new RangeError("Nombre de votants distincts invalide");
  }
  return Math.max(0, 3 - distinctVoters);
}
