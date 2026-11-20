import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { getLastCompletedTowerSeason } from "@/lib/tower-season-podium-rules";
import { readTowerSeasonPodiumRows } from "@/lib/tower-season-podium";
import { groupCoWinners } from "@/lib/tower-standings";
import {
  activeTowerAwards, buildTowerSeasonAwards, isTowerSeasonAwardsEnabled, shouldDelayTowerAwards, towerAwardExpiry,
  towerAwardPresentation, TOWER_AWARD_PLACES,
} from "@/lib/tower-season-awards-rules";

const COMMUNITIES_PER_RUN = 100;
const id = z.string().min(1).max(191);

function enabled(): boolean {
  return process.env.TOWER_CHALLENGES_ENABLED === "true" && isTowerSeasonAwardsEnabled();
}

export type TowerSeasonAwardsSummary = { communities: number; awarded: number; delayed: number; failed: number };

/**
 * Attribution AUTOMATIQUE des titres et cadres saisonniers aux premiers du palmarès de la dernière saison
 * terminée (cron existant `notification-executor`, après la clôture des défis). Purement cosmétique : aucun XP,
 * aucun droit, aucune notification Discord. Idempotente : une ligne par joueur et par saison (unicité en base,
 * `skipDuplicates`), donc rejouable sans doublon ; une attribution existante n'est jamais retirée ni modifiée.
 * Durée : jusqu'à la fin de la saison suivante. Une contestation ouverte sur la saison retarde la communauté (Q7).
 */
export async function awardTowerSeasonTitles(current = new Date(), deadline?: Date): Promise<TowerSeasonAwardsSummary> {
  const summary = { communities: 0, awarded: 0, delayed: 0, failed: 0 };
  if (!enabled() || !Number.isFinite(current.getTime())) return summary;
  const season = getLastCompletedTowerSeason(current);
  const expiresAt = towerAwardExpiry(season);
  if (expiresAt.getTime() <= current.getTime()) return summary;
  const communities = await prisma.community.findMany({
    where: { status: "ACTIVE", towerChallengesEnabled: true }, orderBy: { id: "asc" }, take: COMMUNITIES_PER_RUN, select: { id: true },
  });
  for (const community of communities) {
    if (deadline && Date.now() >= deadline.getTime()) break;
    summary.communities++;
    try {
      const result = await prisma.$transaction(async tx => {
        const [still] = await tx.$queryRaw<{ ok: boolean }[]>`
          SELECT true AS ok FROM "Community" WHERE id = ${community.id} AND status = 'ACTIVE' AND "towerChallengesEnabled" = true FOR SHARE
        `;
        if (!still) return { delayed: false, created: 0 };
        const scopedDb = scopedTransactionPrisma(tx, { communityIds: [community.id], includesDefault: false });
        const [open] = await scopedDb.$queryRaw<{ total: bigint }[]>`
          SELECT COUNT(*)::bigint AS total FROM "TowerChallengeAppeal" ap
          JOIN "TowerChallengeAttempt" a ON a.id = ap."attemptId" AND a."communityId" = ap."communityId"
          WHERE ap."communityId" = ${community.id} AND ap.status = 'OPEN'
            AND a."assignedAt" >= ${season.startAt} AND a."assignedAt" < ${season.endAt}
        `;
        if (shouldDelayTowerAwards({ openAppealsInSeason: Number(open?.total ?? 0) })) return { delayed: true, created: 0 };
        const rows = await readTowerSeasonPodiumRows(scopedDb, community.id, season);
        const groups = groupCoWinners(rows.map(row => ({
          userId: row.userId, floors: row.rewardFloors, hardWins: Number(row.difficultWins), reachedAt: row.reachedAt,
        })));
        const drafts = buildTowerSeasonAwards(groups);
        if (!drafts.length) return { delayed: false, created: 0 };
        const created = await scopedDb.towerSeasonAward.createMany({
          data: drafts.map(draft => ({
            communityId: community.id, userId: draft.userId, seasonStartAt: season.startAt, seasonName: season.name,
            place: draft.place, awardedAt: current, expiresAt,
          })),
          skipDuplicates: true,
        });
        return { delayed: false, created: created.count };
      }, { timeout: 15000, maxWait: 2000 });
      summary.awarded += result.created;
      if (result.delayed) summary.delayed++;
    } catch (error) {
      summary.failed++;
      logger.error("tower:distinctions-saison", error, { communityId: community.id });
    }
  }
  return summary;
}

/** Distinctions saisonnières encore valables d'un membre, avec leur présentation (titre et cadre). */
export async function getTowerSeasonAwardsForProfile(viewerId: string, memberId: string, current = new Date()) {
  if (!enabled()) return [];
  const viewer = id.safeParse(viewerId);
  const member = id.safeParse(memberId);
  if (!viewer.success || !member.success) return [];
  const communityId = await resolveActiveCommunityId(viewerId);
  if (!communityId) return [];
  return prisma.$transaction(async tx => {
    const access = await tx.$queryRaw<{ userId: string }[]>`
      SELECT m."userId" FROM "Membership" m JOIN "Community" c ON c.id = m."communityId"
      WHERE m."communityId" = ${communityId} AND m."userId" IN (${viewerId}, ${memberId})
        AND m.status = 'ACTIVE' AND c.status = 'ACTIVE' AND c."towerChallengesEnabled" = true
      FOR SHARE OF m, c
    `;
    const allowed = new Set(access.map(row => row.userId));
    if (!allowed.has(viewerId) || !allowed.has(memberId)) return [];
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    const awards = await scopedDb.towerSeasonAward.findMany({
      where: { communityId, userId: memberId, expiresAt: { gt: current }, place: { lte: TOWER_AWARD_PLACES } },
      select: { place: true, seasonName: true, seasonStartAt: true, expiresAt: true },
    });
    return activeTowerAwards(awards, current).map(award => ({
      place: award.place, seasonName: award.seasonName, expiresAt: award.expiresAt, ...towerAwardPresentation(award.place, award.seasonName),
    }));
  }, { timeout: 5000, maxWait: 1000 });
}
