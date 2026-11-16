import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { getTowerPersonalRank, nextTowerRankStep } from "@/lib/tower-ranks";
import { countCompletedTowerSeasons } from "@/lib/tower-personal-progress-rules";

const id = z.string().min(1).max(191);
const inputSchema = z.object({ viewerId: id, memberId: id, communityId: id });

/**
 * Progression personnelle Tower d'un membre, en lecture seule : étages GAGNÉS via les défis
 * (`TowerChallengeProgress.floorsClimbed`, décision Q1 : indépendant de l'XP), saisons terminées
 * (Q2) et rang cosmétique (`tower-ranks.ts`). Aucune écriture, aucun rôle Discord.
 *
 * Accès revérifié ici, isolation allumée ou non : le lecteur ET le membre doivent avoir une
 * Membership ACTIVE dans cette communauté ACTIVE dont les défis Tower sont activés.
 */
export async function getTowerPersonalProgress(input: unknown, current = new Date()) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { status: "INVALID" } as const;
  if (process.env.TOWER_CHALLENGES_ENABLED !== "true") return { status: "DISABLED" } as const;
  const { viewerId, memberId, communityId } = parsed.data;
  return prisma.$transaction(async tx => {
    const access = await tx.$queryRaw<{ userId: string }[]>`
      SELECT m."userId" FROM "Membership" m
      JOIN "Community" c ON c.id = m."communityId"
      WHERE m."communityId" = ${communityId} AND m."userId" IN (${viewerId}, ${memberId})
        AND m.status = 'ACTIVE' AND c.status = 'ACTIVE' AND c."towerChallengesEnabled" = true
      FOR SHARE OF m, c
    `;
    const allowed = new Set(access.map(row => row.userId));
    if (!allowed.has(viewerId) || !allowed.has(memberId)) return { status: "UNAVAILABLE" } as const;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    const progress = await scopedDb.towerChallengeProgress.findUnique({
      where: { communityId_userId: { communityId, userId: memberId } }, select: { floorsClimbed: true },
    });
    const credits = await scopedDb.$queryRaw<{ rewardedAt: Date; floors: number }[]>`
      SELECT a."rewardedAt", a."rewardFloors" AS floors
      FROM "TowerChallengeAttempt" a
      WHERE a."communityId" = ${communityId} AND a."userId" = ${memberId} AND a."teamId" IS NULL
        AND a.status = 'APPROVED' AND a."rewardedAt" IS NOT NULL
      UNION ALL
      SELECT p."rewardedAt", a."rewardFloors" AS floors
      FROM "TowerChallengeAttemptParticipant" p
      JOIN "TowerChallengeAttempt" a ON a.id = p."attemptId" AND a."communityId" = p."communityId"
      WHERE p."communityId" = ${communityId} AND p."userId" = ${memberId} AND a."teamId" IS NOT NULL
        AND a.status = 'APPROVED' AND p."rewardedAt" IS NOT NULL
    `;
    const floorsClimbed = progress?.floorsClimbed ?? BigInt(0);
    const completedSeasons = countCompletedTowerSeasons(credits, current);
    return {
      status: "PROGRESS",
      floorsClimbed: floorsClimbed.toString(),
      completedSeasons,
      rank: getTowerPersonalRank(floorsClimbed, completedSeasons),
      next: nextTowerRankStep(floorsClimbed, completedSeasons),
    } as const;
  }, { isolationLevel: "RepeatableRead", timeout: 5000, maxWait: 1000 });
}

export type TowerPersonalProgress = Extract<Awaited<ReturnType<typeof getTowerPersonalProgress>>, { status: "PROGRESS" }>;

/**
 * Progression Tower d'un membre dans la communauté ACTIVE du lecteur (fiche d'un pote). `null` si la
 * fonctionnalité est éteinte ou indisponible : aucune requête n'est faite tant que le drapeau est éteint.
 */
export async function getTowerProgressForProfile(viewerId: string, memberId: string): Promise<TowerPersonalProgress | null> {
  if (process.env.TOWER_CHALLENGES_ENABLED !== "true") return null;
  const communityId = await resolveActiveCommunityId(viewerId);
  if (!communityId) return null;
  const result = await getTowerPersonalProgress({ viewerId, memberId, communityId });
  return result.status === "PROGRESS" ? result : null;
}
