export const TOWER_CHALLENGE_APPEAL_WINDOW_MS = 24 * 60 * 60 * 1000;

type TowerCommunityRole = "MEMBER" | "ADMIN" | "OWNER";

export function isTowerChallengeAppealWindowOpen(resultAnnouncedAt: Date, current: Date): boolean {
  const announced = resultAnnouncedAt.getTime();
  const now = current.getTime();
  return Number.isFinite(announced) && Number.isFinite(now) && now >= announced && now - announced < TOWER_CHALLENGE_APPEAL_WINDOW_MS;
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
  if (authorIsStaff || input.arbiterId !== null) {
    return input.reviewerId === input.arbiterId && input.reviewerRole === "MEMBER";
  }
  return input.reviewerRole === "ADMIN" || input.reviewerRole === "OWNER";
}
