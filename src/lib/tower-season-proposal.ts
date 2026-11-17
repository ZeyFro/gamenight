import { z } from "zod";
import type { CommunityRole, MembershipStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { listEndedTowerSeasons } from "@/lib/tower-season-podium-rules";
import { isTowerSeasonCompleted } from "@/lib/tower-season-rules";
import { compareTowerStandings, groupCoWinners, type TowerStandingInput } from "@/lib/tower-standings";

const id = z.string().min(1).max(191);
const inputSchema = z.object({ userId: id, communityId: id, seasonStart: z.string().datetime().optional() });

/** Garde-fou de lecture ; au-delà, la proposition est signalée comme tronquée plutôt que fausse. */
const PROPOSAL_SCAN_LIMIT = 1000;
const PROPOSAL_PLACES = 10;
const PODIUM_PLACES = 3;

type Row = {
  userId: string; displayName: string; rewardFloors: bigint; difficultWins: bigint; reachedAt: Date;
  membershipStatus: MembershipStatus | null;
};

const standing = (row: Row): TowerStandingInput => ({
  userId: row.userId, floors: row.rewardFloors, hardWins: Number(row.difficultWins), reachedAt: row.reachedAt,
});

/**
 * Proposition de palmarès d'une saison Tower FINIE, pour les administrateurs de la communauté
 * (décision Q4 : le système calcule et propose, un administrateur valide la publication).
 *
 * LECTURE SEULE : rien n'est publié, attribué ni enregistré ici (la persistance du Hall of Fame exige
 * une migration). Règles appliquées, toutes décidées : crédits rattachés à la saison de leur
 * `rewardedAt` (Q7, fin exclusive), départage étages / défis à 3 étages / arrivée, co-lauréats sur
 * égalité stricte (Q7), saison « terminée » seulement si au moins un étage y a été crédité (Q2).
 * Les joueurs crédités qui ne sont plus membres actifs ne sont ni classés ni écartés en silence : ils
 * sont listés à part, pour que l'administrateur décide (leur sort au gel n'est pas tranché).
 */
export async function getTowerSeasonProposal(input: unknown, current = new Date()) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  if (process.env.TOWER_CHALLENGES_ENABLED !== "true") return { status: "DISABLED" } as const;
  const { userId, communityId, seasonStart } = parsed.data;
  return prisma.$transaction(async tx => {
    const [actor] = await tx.$queryRaw<{ role: CommunityRole; communityName: string }[]>`
      SELECT m.role, c.name AS "communityName" FROM "Membership" m
      JOIN "Community" c ON c.id = m."communityId"
      WHERE m."userId" = ${userId} AND m."communityId" = ${communityId}
        AND m.status = 'ACTIVE' AND c.status = 'ACTIVE' AND c."towerChallengesEnabled" = true
      FOR SHARE OF m, c
    `;
    if (!actor) return { status: "UNAVAILABLE" } as const;
    if (actor.role !== "ADMIN" && actor.role !== "OWNER") return { status: "FORBIDDEN" } as const;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    const [bounds] = await scopedDb.$queryRaw<{ earliest: Date | null }[]>`
      SELECT MIN(credit."earnedAt") AS earliest FROM (
        SELECT a."rewardedAt" AS "earnedAt" FROM "TowerChallengeAttempt" a
        WHERE a."communityId" = ${communityId} AND a."teamId" IS NULL AND a.status = 'APPROVED'
        UNION ALL
        SELECT p."rewardedAt" AS "earnedAt" FROM "TowerChallengeAttemptParticipant" p
        JOIN "TowerChallengeAttempt" a ON a.id = p."attemptId" AND a."communityId" = p."communityId"
        WHERE p."communityId" = ${communityId} AND a."teamId" IS NOT NULL AND a.status = 'APPROVED'
          AND p."rewardedAt" IS NOT NULL
      ) credit
    `;
    const seasons = listEndedTowerSeasons(current, bounds?.earliest ?? null);
    const season = seasonStart ? seasons.find(item => item.startAt.getTime() === new Date(seasonStart).getTime()) : seasons[0];
    if (!season) return { status: "UNKNOWN_SEASON" } as const;
    const rows = await scopedDb.$queryRaw<Row[]>`
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
        COUNT(*) FILTER (WHERE e."rewardFloors" = 3)::bigint AS "difficultWins", MAX(e."earnedAt") AS "reachedAt",
        m.status AS "membershipStatus"
      FROM earned e
      JOIN "User" u ON u.id = e."userId"
      LEFT JOIN "Membership" m ON m."userId" = e."userId" AND m."communityId" = ${communityId}
      GROUP BY e."userId", u."discordName", m.status
      ORDER BY "rewardFloors" DESC, "difficultWins" DESC, "reachedAt" ASC, e."userId" ASC
      LIMIT ${PROPOSAL_SCAN_LIMIT + 1}
    `;
    const truncated = rows.length > PROPOSAL_SCAN_LIMIT;
    const scanned = rows.slice(0, PROPOSAL_SCAN_LIMIT);
    const byId = new Map(scanned.map(row => [row.userId, row]));
    const active = scanned.filter(row => row.membershipStatus === "ACTIVE");
    const former = scanned.filter(row => row.membershipStatus !== "ACTIVE").sort((a, b) => compareTowerStandings(standing(a), standing(b)));
    const creditedFloors = scanned.reduce((total, row) => total + row.rewardFloors, BigInt(0));
    const groups = groupCoWinners(active.map(standing)).filter(group => group.startRank <= PROPOSAL_PLACES);
    return {
      status: "PROPOSAL",
      communityName: actor.communityName,
      computedAt: current,
      seasons: seasons.map(item => ({ name: item.name, startAt: item.startAt, endAt: item.endAt })),
      season: { name: season.name, startAt: season.startAt, endAt: season.endAt },
      /** Q2 : sans étage crédité, la saison n'est pas « terminée » et n'a pas de palmarès. */
      completed: isTowerSeasonCompleted({ endsAt: season.endAt, now: current, creditedFloors }),
      creditedFloors: creditedFloors.toString(),
      creditedPlayers: scanned.length,
      truncated,
      candidates: groups.flatMap(group => group.members.map(member => ({
        place: group.startRank, exAequo: group.members.length > 1, onPodium: group.startRank <= PODIUM_PLACES,
        displayName: byId.get(member.userId)?.displayName ?? "", rewardFloors: member.floors.toString(),
        difficultWins: String(member.hardWins), reachedAt: member.reachedAt,
      }))),
      formerMembers: former.map(row => ({
        displayName: row.displayName, rewardFloors: row.rewardFloors.toString(), difficultWins: row.difficultWins.toString(),
        reachedAt: row.reachedAt, membershipStatus: row.membershipStatus,
      })),
    } as const;
  }, { isolationLevel: "RepeatableRead", timeout: 5000, maxWait: 1000 });
}
