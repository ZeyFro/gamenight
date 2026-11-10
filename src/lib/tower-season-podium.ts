import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { getLastCompletedTowerSeason } from "@/lib/tower-season-podium-rules";
import { groupCoWinners } from "@/lib/tower-standings";

const actorSchema = z.object({ userId: z.string().min(1).max(191), communityId: z.string().min(1).max(191) });

/** Garde-fou de lecture : bien au-delà d'un podium, même avec de nombreux ex æquo. */
const PODIUM_SCAN_LIMIT = 200;
const PODIUM_PLACES = 3;

/**
 * Read-only podium; eligibility is rechecked even when community isolation is OFF.
 *
 * Décision Q7 du propriétaire (9 novembre 2026) : l'ordre reste étages, défis à 3 étages, heure
 * d'arrivée ; des joueurs STRICTEMENT égaux sur ces trois critères sont co-lauréats et partagent la
 * même place (`userId` ne sert plus qu'à un ordre d'affichage stable). Les places suivent l'ordre du
 * classement (deux premiers ex æquo, puis une 3e place) et aucun ex æquo d'une place du podium n'est
 * écarté : le podium peut donc compter plus de trois joueurs.
 */
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
      userId: string; displayName: string; rewardFloors: bigint; difficultWins: bigint; reachedAt: Date;
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
      SELECT e."userId", u."discordName" AS "displayName", SUM(e."rewardFloors")::bigint AS "rewardFloors",
        COUNT(*) FILTER (WHERE e."rewardFloors" = 3)::bigint AS "difficultWins", MAX(e."earnedAt") AS "reachedAt"
      FROM earned e
      JOIN "Membership" m ON m."userId" = e."userId" AND m."communityId" = ${communityId} AND m.status = 'ACTIVE'
      JOIN "User" u ON u.id = e."userId"
      GROUP BY e."userId", u."discordName"
      ORDER BY "rewardFloors" DESC, "difficultWins" DESC, "reachedAt" ASC, e."userId" ASC
      LIMIT ${PODIUM_SCAN_LIMIT}
    `;
    const names = new Map(rows.map(row => [row.userId, row.displayName]));
    const groups = groupCoWinners(rows.map(row => ({
      userId: row.userId, floors: row.rewardFloors, hardWins: Number(row.difficultWins), reachedAt: row.reachedAt,
    }))).filter(group => group.startRank <= PODIUM_PLACES);
    return {
      status: "PODIUM",
      season,
      entries: groups.flatMap(group => group.members.map(member => ({
        rank: group.startRank, exAequo: group.members.length > 1, displayName: names.get(member.userId) ?? "",
        rewardFloors: member.floors.toString(), difficultWins: String(member.hardWins), reachedAt: member.reachedAt,
      }))),
    } as const;
  }, { isolationLevel: "RepeatableRead", timeout: 5000, maxWait: 1000 });
}
