const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

type TowerCommunityRole = "MEMBER" | "ADMIN" | "OWNER";

export function isTowerChallengeAppealWindowOpen(rejectedAt: Date, current: Date): boolean {
  const rejected = rejectedAt.getTime();
  const now = current.getTime();
  return Number.isFinite(rejected) && Number.isFinite(now) && now >= rejected && now - rejected < SEVEN_DAYS_MS;
}

export function canReviewTowerChallengeAppeal(input: {
  reviewerId: string;
  reviewerRole: TowerCommunityRole;
  authorId: string;
  authorRole: TowerCommunityRole;
  arbiterId: string | null;
  isParticipant: boolean;
  hasVoted: boolean;
}): boolean {
  if (input.reviewerId === input.authorId || input.isParticipant || input.hasVoted) return false;
  const authorIsStaff = input.authorRole === "ADMIN" || input.authorRole === "OWNER";
  if (authorIsStaff) {
    return input.reviewerId === input.arbiterId && input.reviewerRole === "MEMBER";
  }
  return input.reviewerRole === "ADMIN" || input.reviewerRole === "OWNER";
}
