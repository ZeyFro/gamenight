import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { getLastCompletedTowerSeason } from "@/lib/tower-season-podium-rules";

const actorSchema = z.object({ userId: z.string().min(1).max(191), communityId: z.string().min(1).max(191) });

/** Read-only podium; eligibility is rechecked even when community isolation is OFF. */
export async function getTowerSeasonPodium(input: unknown, current = new Date()) {
  const parsed = actorSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  if (process.env.TOWER_CHALLENGES_ENABLED !== "true") return { status: "DISABLED" } as const;
  const { userId, communityId } = parsed.data;
  const season = getLastCompletedTowerSeason(current);
  return prisma.$transaction(async tx => {
    const access = await tx.$queryRaw<{ userId: string }[]>`
      SELECT m."userId" FROM "Membership" m
      JOIN "Community" c ON c.id = m."communityId"
      WHERE m."userId" = ${userId} AND m."communityId" = ${communityId}
        AND m.status = 'ACTIVE' AND c.status = 'ACTIVE' AND c."towerChallengesEnabled" = true
      FOR SHARE OF m, c
    `;
    if (!access.length) return { status: "UNAVAILABLE" } as const;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    const rows = await scopedDb.$queryRaw<{
      displayName: string; rewardFloors: bigint; difficultWins: bigint; reachedAt: Date;
    }[]>`
      WITH earned AS (
        SELECT a."userId", a."rewardFloors", a."rewardedAt" AS "earnedAt"
        FROM "TowerChallengeAttempt" a
        WHERE a."communityId" = ${communityId} AND a."teamId" IS NULL AND a.status = 'APPROVED'
          AND a."rewardedAt" >= ${season.startAt} AND a."rewardedAt" < ${season.endAt}
        UNION ALL
        SELECT p."userId", a."rewardFloors", p."rewardedAt" AS "earnedAt"
        FROM "TowerChallengeAttemptParticipant" p
        JOIN "TowerChallengeAttempt" a ON a.id = p."attemptId" AND a."communityId" = p."communityId"
        WHERE p."communityId" = ${communityId} AND a."teamId" IS NOT NULL AND a.status = 'APPROVED'
          AND p."rewardedAt" >= ${season.startAt} AND p."rewardedAt" < ${season.endAt}
      )
      SELECT u."discordName" AS "displayName", SUM(e."rewardFloors")::bigint AS "rewardFloors",
        COUNT(*) FILTER (WHERE e."rewardFloors" = 3)::bigint AS "difficultWins", MAX(e."earnedAt") AS "reachedAt"
      FROM earned e
      JOIN "Membership" m ON m."userId" = e."userId" AND m."communityId" = ${communityId} AND m.status = 'ACTIVE'
      JOIN "User" u ON u.id = e."userId"
      GROUP BY e."userId", u."discordName"
      ORDER BY "rewardFloors" DESC, "difficultWins" DESC, "reachedAt" ASC, e."userId" ASC
      LIMIT 3
    `;
    return {
      status: "PODIUM",
      season,
      entries: rows.map((row, index) => ({
        rank: index + 1, displayName: row.displayName, rewardFloors: row.rewardFloors.toString(),
        difficultWins: row.difficultWins.toString(), reachedAt: row.reachedAt,
      })),
    } as const;
  }, { isolationLevel: "RepeatableRead", timeout: 5000, maxWait: 1000 });
}
