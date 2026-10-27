import { getDefaultCommunityId } from "@/lib/default-community";
import type { Prisma } from "@prisma/client";
import { isMemberOfCommunity } from "@/lib/community-isolation";
import { writeCommunityIdForUser } from "@/lib/community-stats";
import { scopedPrismaForCommunityId } from "@/lib/community-scoped-client";

export interface CommunityProgress {
  xpTotal: number;
  xpBalance: number;
  streakCount: number;
  streakLastActiveAt: Date | null;
  bestStreakCount: number;
  tournamentsParticipatedCount: number;
}
export const ZERO_MEMBER_STATS: CommunityProgress = {
  xpTotal: 0, xpBalance: 0, streakCount: 0, streakLastActiveAt: null,
  bestStreakCount: 0, tournamentsParticipatedCount: 0,
};

/** Lecture sans création ni repli sur les colonnes historiques User. */
export async function getMemberStats(userId: string, communityId: string): Promise<CommunityProgress> {
  // Appartenance et ligne de stats sont indépendantes : lues ensemble. Pour un
  // non-membre, la ligne lue en trop est jetée (jamais renvoyée).
  const [isMember, stats] = await Promise.all([
    isMemberOfCommunity(userId, communityId),
    scopedPrismaForCommunityId(communityId).then((scopedDb) =>
      scopedDb.communityMemberStats.findUnique({ where: { communityId_userId: { communityId, userId } } })
    ),
  ]);
  return isMember ? stats ?? { ...ZERO_MEMBER_STATS } : { ...ZERO_MEMBER_STATS };
}
export async function getMemberStatsForViewer(userId: string, viewerId: string): Promise<CommunityProgress> {
  const communityId = await writeCommunityIdForUser(viewerId);
  return communityId === null ? { ...ZERO_MEMBER_STATS } : getMemberStats(userId, communityId);
}
export function projectUserProgress<T extends object>(user: T, stats: CommunityProgress): T & CommunityProgress {
  return { ...user, ...stats };
}

/**
 * Communauté avant stats : FOR SHARE exclut la clôture de saison FOR UPDATE,
 * même pour un premier INSERT. Les statuts sont relus sous verrou.
 * https://www.postgresql.org/docs/16/explicit-locking.html
 */
export async function lockCommunityProgress(tx: Prisma.TransactionClient, communityId: string, userId?: string): Promise<boolean> {
  const communities = await tx.$queryRaw<{ status: string }[]>`
    SELECT status FROM "Community" WHERE id = ${communityId} FOR SHARE
  `;
  if (communities.length === 0) return false;
  if (communities[0].status !== "ACTIVE") return false;
  if (userId === undefined) return true;
  const members = await tx.$queryRaw<{ status: string }[]>`
    SELECT status FROM "Membership" WHERE "communityId" = ${communityId} AND "userId" = ${userId} FOR SHARE
  `;
  return members[0]?.status === "ACTIVE";
}
export async function canProgressInCommunity(userId: string, communityId: string): Promise<boolean> {
  return isMemberOfCommunity(userId, communityId);
}

/** Les résumés nullable pré-PR A appartiennent exclusivement à default. */
export async function durableProgressWhere(communityId: string): Promise<{ OR: Array<{ communityId: string | null }> }> {
  return { OR: [{ communityId }, ...(communityId === await getDefaultCommunityId() ? [{ communityId: null }] : [])] };
}
