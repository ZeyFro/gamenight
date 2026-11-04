import { prisma } from "@/lib/prisma";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { getTeamDailyTowerChallenge } from "@/lib/tower-challenges";
import { logger } from "@/lib/logger";

export type TowerTeamDailySummary = { checked: number; failed: number };

export async function assignDailyTowerTeamChallenges(deadline: Date): Promise<TowerTeamDailySummary> {
  const summary = { checked: 0, failed: 0 };
  const guildId = process.env.TOWER_DISCORD_GUILD_ID;
  if (process.env.TOWER_CHALLENGES_ENABLED !== "true") return summary;
  if (!/^[0-9]{16,20}$/.test(guildId ?? "")) return summary;
  if (Date.now() >= deadline.getTime()) return summary;

  const teams = await prisma.$transaction(async (tx) => {
    const community = await tx.community.findFirst({
      where: {
        discordGuildId: guildId,
        status: "ACTIVE",
        towerChallengesEnabled: true,
        communityTeamsEnabled: true,
      },
      select: { id: true },
    });
    if (!community) return [];

    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [community.id], includesDefault: false });
    return scopedDb.communityTeam.findMany({
      where: {
        communityId: community.id,
        members: {
          some: {
            user: {
              memberships: { some: { communityId: community.id, status: "ACTIVE" } },
            },
          },
        },
      },
      orderBy: { id: "asc" },
      take: 100,
      select: {
        id: true,
        communityId: true,
        members: {
          where: {
            user: {
              memberships: { some: { communityId: community.id, status: "ACTIVE" } },
            },
          },
          orderBy: { joinedAt: "asc" },
          take: 1,
          select: { userId: true },
        },
      },
    });
  }, { timeout: 5000, maxWait: 1000 });

  for (const team of teams) {
    if (Date.now() >= deadline.getTime()) break;
    const actor = team.members[0];
    if (!actor) continue;
    try {
      await getTeamDailyTowerChallenge({
        communityId: team.communityId,
        userId: actor.userId,
        teamId: team.id,
      });
      summary.checked += 1;
    } catch (error) {
      summary.failed += 1;
      logger.error("tower:team-daily", error, { communityId: team.communityId, teamId: team.id });
    }
  }
  return summary;
}
