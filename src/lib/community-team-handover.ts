import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedPrisma, scopedTransactionPrisma } from "@/lib/community-scoped-client";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Maintenance explicitly triggered by an authenticated cron, never on a page read.
 * Team captain activity means management actions OR last community XP activity.
 * Login-only activity is not a reliable signal in the existing schema.
 */
export async function transferInactiveCommunityTeamCaptains(
  date = new Date(),
  dryRun = true,
): Promise<{ eligible: number; transferred: number }> {
  const cutoff = new Date(date.getTime() - THIRTY_DAYS_MS);
  const scopedDb = scopedPrisma(null);
  const candidateTeams = await scopedDb.communityTeam.findMany({
    where: {
      community: { status: "ACTIVE", communityTeamsEnabled: true },
      captainLastActivityAt: { lte: cutoff },
    },
    select: { id: true, communityId: true },
    orderBy: { captainLastActivityAt: "asc" },
    take: 25,
  });
  let eligible = 0;
  let transferred = 0;
  for (const row of candidateTeams) {
    const outcome = await prisma.$transaction(async (tx) => {
      const scopedDb = scopedTransactionPrisma(tx, {
        communityIds: [row.communityId], includesDefault: false,
      });
      const team = await scopedDb.communityTeam.findFirst({
        where: { id: row.id, communityId: row.communityId, captainLastActivityAt: { lte: cutoff } },
        select: {
          createdById: true,
          captainId: true,
          members: {
            where: { user: { memberships: { some: { communityId: row.communityId, status: "ACTIVE" } } } },
            orderBy: [{ joinedAt: "asc" }, { userId: "asc" }],
            select: { userId: true },
          },
        },
      });
      if (!team) return "skip";
      const captainId = team.captainId ?? team.createdById;
      const currentCaptain = await tx.membership.findUnique({
        where: { communityId_userId: { communityId: row.communityId, userId: captainId } },
        select: { status: true },
      });
      const mostRecentActivity = await scopedDb.communityMemberStats.findUnique({
        where: { communityId_userId: { communityId: row.communityId, userId: captainId } },
        select: { streakLastActiveAt: true },
      });
      if (currentCaptain?.status === "ACTIVE" && mostRecentActivity?.streakLastActiveAt &&
        mostRecentActivity.streakLastActiveAt > cutoff) return "skip";
      const successor = team.members.find((m) => m.userId !== captainId);
      if (!successor) return "skip";
      if (dryRun) return "eligible";
      const updated = await scopedDb.communityTeam.updateMany({
        where: { id: row.id, communityId: row.communityId, captainLastActivityAt: { lte: cutoff }, captainId: team.captainId },
        data: { captainId: successor.userId, captainLastActivityAt: date },
      });
      return updated.count ? "transferred" : "skip";
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (outcome !== "skip") eligible++;
    if (outcome === "transferred") transferred++;
  }
  return { eligible, transferred };
}
