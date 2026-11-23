import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { getTowerSchoolSeason } from "@/lib/tower-challenge-seasons";
import { rankTowerTeams, type TowerTeamStanding } from "@/lib/tower-team-standings-rules";

const actorSchema = z.object({ userId: z.string().min(1).max(191), communityId: z.string().min(1).max(191) });

/** Nombre d'équipes affichées par classement. */
export const TOWER_TEAM_STANDINGS_LIMIT = 10;

type Row = { teamId: string; name: string; color: string | null; emblem: string | null; floors: number; wins: number; reachedAt: Date };

/**
 * Classement des équipes de la communauté (cahier §14.3), en lecture seule : étages des défis d'équipe validés
 * (un défi compte une fois pour l'équipe, à sa date de validation), saison en cours et depuis
 * toujours. Seules les équipes qui comptent encore un membre actif sont classées. Accès : membre ACTIF d'une
 * communauté ACTIVE où The Tower est ouverte, comme le palmarès.
 */
export async function getTowerTeamStandings(input: unknown, current = new Date()) {
  const parsed = actorSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  if (process.env.TOWER_CHALLENGES_ENABLED !== "true") return { status: "DISABLED" } as const;
  const { userId, communityId } = parsed.data;
  const season = getTowerSchoolSeason(current);
  return prisma.$transaction(async tx => {
    const access = await tx.$queryRaw<{ ok: number }[]>`
      SELECT 1 AS ok FROM "Membership" m
      JOIN "Community" c ON c.id = m."communityId"
      WHERE m."userId" = ${userId} AND m."communityId" = ${communityId}
        AND m.status = 'ACTIVE' AND c.status = 'ACTIVE' AND c."towerChallengesEnabled" = true
    `;
    if (!access.length) return { status: "UNAVAILABLE" } as const;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    const read = (from: Date | null) => scopedDb.$queryRaw<Row[]>`
      WITH earned AS (
        SELECT a."teamId", a."rewardFloors", a."rewardedAt" AS "earnedAt"
        FROM "TowerChallengeAttempt" a
        WHERE a."communityId" = ${communityId} AND a."teamId" IS NOT NULL AND a.status = 'APPROVED' AND a."rewardedAt" IS NOT NULL
      )
      SELECT t.id AS "teamId", t.name, t.color, t.emblem,
        SUM(e."rewardFloors")::int AS floors, COUNT(*)::int AS wins, MAX(e."earnedAt") AS "reachedAt"
      FROM earned e
      JOIN "CommunityTeam" t ON t.id = e."teamId" AND t."communityId" = ${communityId}
      WHERE e."earnedAt" < ${season.endAt}
        ${from ? Prisma.sql`AND e."earnedAt" >= ${from}` : Prisma.empty}
        AND EXISTS (
          SELECT 1 FROM "CommunityTeamMember" tm
          JOIN "Membership" mm ON mm."userId" = tm."userId" AND mm."communityId" = tm."communityId" AND mm.status = 'ACTIVE'
          WHERE tm."teamId" = t.id AND tm."communityId" = ${communityId}
        )
      GROUP BY t.id, t.name, t.color, t.emblem
    `;
    const [seasonRows, allTimeRows] = [await read(season.startAt), await read(null)];
    const top = (rows: Row[]): TowerTeamStanding[] => rankTowerTeams(rows).filter(row => row.rank <= TOWER_TEAM_STANDINGS_LIMIT);
    return { status: "STANDINGS", season, seasonTeams: top(seasonRows), allTimeTeams: top(allTimeRows) } as const;
  }, { isolationLevel: "RepeatableRead", timeout: 5000, maxWait: 1000 });
}
