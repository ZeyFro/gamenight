import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";

const actorSchema = z.object({ userId: z.string().min(1).max(191), communityId: z.string().min(1).max(191) });

/** Fenêtre du récapitulatif : les 7 derniers jours glissants. */
export const TOWER_WEEKLY_RECAP_DAYS = 7;
/** Joueurs mis en avant (cahier §10.3, « mise en avant des joueurs actifs »). */
export const TOWER_WEEKLY_RECAP_TOP = 5;

export type TowerWeeklyActivePlayer = { userId: string; displayName: string; wins: number; floors: number };
export type TowerWeeklyRecap = { since: Date; until: Date; totalWins: number; totalFloors: number; activePlayers: TowerWeeklyActivePlayer[] };

type Row = { userId: string; displayName: string; wins: number; floors: number };

/**
 * Récapitulatif hebdomadaire The Tower (cahier §10.3), EN LECTURE SEULE, dans l'application : défis validés pendant les
 * 7 derniers jours par les membres ACTIFS de la communauté, et mise en avant des joueurs les plus actifs. Ni notification,
 * ni XP, ni écriture. Accès : membre actif d'une communauté active où The Tower est ouverte, comme le palmarès.
 * Un défi d'équipe compte une fois par participant crédité ; départage : réussites, étages, puis identifiant.
 */
export async function getTowerWeeklyRecap(input: unknown, current = new Date()) {
  const parsed = actorSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  if (process.env.TOWER_CHALLENGES_ENABLED !== "true") return { status: "DISABLED" } as const;
  const { userId, communityId } = parsed.data;
  const since = new Date(current.getTime() - TOWER_WEEKLY_RECAP_DAYS * 86_400_000);
  return prisma.$transaction(async tx => {
    const access = await tx.$queryRaw<{ ok: number }[]>`
      SELECT 1 AS ok FROM "Membership" m
      JOIN "Community" c ON c.id = m."communityId"
      WHERE m."userId" = ${userId} AND m."communityId" = ${communityId}
        AND m.status = 'ACTIVE' AND c.status = 'ACTIVE' AND c."towerChallengesEnabled" = true
    `;
    if (!access.length) return { status: "UNAVAILABLE" } as const;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    const rows = await scopedDb.$queryRaw<Row[]>`
      WITH earned AS (
        SELECT a."userId", a."rewardFloors", a."rewardedAt" AS "earnedAt"
        FROM "TowerChallengeAttempt" a
        WHERE a."communityId" = ${communityId} AND a."teamId" IS NULL AND a.status = 'APPROVED'
          AND a."rewardedAt" >= ${since} AND a."rewardedAt" <= ${current}
        UNION ALL
        SELECT p."userId", a."rewardFloors", p."rewardedAt" AS "earnedAt"
        FROM "TowerChallengeAttemptParticipant" p
        JOIN "TowerChallengeAttempt" a ON a.id = p."attemptId" AND a."communityId" = p."communityId"
        WHERE p."communityId" = ${communityId} AND a."teamId" IS NOT NULL AND a.status = 'APPROVED'
          AND p."rewardedAt" >= ${since} AND p."rewardedAt" <= ${current}
      )
      SELECT e."userId", u."discordName" AS "displayName", COUNT(*)::int AS wins, SUM(e."rewardFloors")::int AS floors
      FROM earned e
      JOIN "Membership" m ON m."userId" = e."userId" AND m."communityId" = ${communityId} AND m.status = 'ACTIVE'
      JOIN "User" u ON u.id = e."userId"
      GROUP BY e."userId", u."discordName"
    `;
    const sorted = [...rows].sort((a, b) => b.wins - a.wins || b.floors - a.floors || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
    const recap: TowerWeeklyRecap = {
      since,
      until: current,
      totalWins: rows.reduce((sum, row) => sum + row.wins, 0),
      totalFloors: rows.reduce((sum, row) => sum + row.floors, 0),
      activePlayers: sorted.slice(0, TOWER_WEEKLY_RECAP_TOP),
    };
    return { status: "RECAP", recap } as const;
  }, { isolationLevel: "RepeatableRead", timeout: 5000, maxWait: 1000 });
}
