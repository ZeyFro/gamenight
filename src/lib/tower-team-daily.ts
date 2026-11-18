import { prisma } from "@/lib/prisma";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { getTeamDailyTowerChallenge } from "@/lib/tower-challenges";
import { getTowerParisDayKey } from "@/lib/tower-challenge-rules";
import { towerTransactionBudget, setTowerStatementDeadline } from "@/lib/tower-deadline";
import { logger } from "@/lib/logger";

export type TowerTeamDailySummary = { checked: number; failed: number; complete: boolean };

export async function assignDailyTowerTeamChallenges(deadline: Date): Promise<TowerTeamDailySummary> {
  const summary = { checked: 0, failed: 0, complete: false };
  const guildId = process.env.TOWER_DISCORD_GUILD_ID;
  if (process.env.TOWER_CHALLENGES_ENABLED !== "true") return summary;
  if (!/^[0-9]{16,20}$/.test(guildId ?? "")) return summary;
  if (!Number.isFinite(deadline.getTime()) || Date.now() >= deadline.getTime() - 5) return summary;
  const requestKey = "team-" + getTowerParisDayKey(new Date());

  const teams = await prisma.$transaction(async (tx) => {
    await setTowerStatementDeadline(tx, deadline);
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
    await setTowerStatementDeadline(tx, deadline);
    return scopedDb.communityTeam.findMany({
      where: {
        communityId: community.id,
        towerChallengeAttempts: { none: { requestKey } },
        members: {
          some: {
            user: {
              memberships: { some: { communityId: community.id, status: "ACTIVE" } },
            },
          },
        },
      },
      orderBy: { id: "asc" },
      take: 101,
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
  }, towerTransactionBudget(deadline, { timeout: 5000, maxWait: 1000 }));

  let visited = 0;
  for (const team of teams.slice(0, 100)) {
    if (Date.now() >= deadline.getTime() - 5) break;
    const actor = team.members[0];
    if (!actor) { summary.failed++; visited++; continue; }
    try {
      const result = await getTeamDailyTowerChallenge({
        communityId: team.communityId,
        userId: actor.userId,
        teamId: team.id,
      }, deadline);
      if (result.status === "TEAM_CHALLENGE") summary.checked += 1;
      else summary.failed += 1;
    } catch (error) {
      summary.failed += 1;
      logger.error("tower:team-daily", error, { communityId: team.communityId, teamId: team.id });
    }
    visited++;
  }
  summary.complete = visited === teams.length && summary.failed === 0;
  return summary;
}
