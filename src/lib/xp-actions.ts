import { Prisma, type XpReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { statsCommunityIdForSession } from "@/lib/community-stats";
import { getDefaultCommunityId } from "@/lib/default-community";
import { getMemberStats, lockCommunityProgress, ZERO_MEMBER_STATS, type CommunityProgress } from "@/lib/member-stats";
import { announceLevelUp } from "@/lib/discord-level-up";
import {
  CREATE_SESSION_DAILY_XP_CAP, CREATE_SESSION_XP_WINDOW_MS,
  computeAwardedAmount, didLevelUp, levelForXp, rankForLevel, titleForLevel,
} from "@/lib/xp";
import { createNotification } from "@/lib/notifications";
import { logger } from "@/lib/logger";
import { attemptDefaultRewardDelivery, persistRewardNotice, type RewardNotice } from "@/lib/reward-notifications";
import { absencePenaltyAmount } from "@/lib/session-attendance";

export function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Ledger, progression, solde et niveau atomiques ; l'incrément fournit le vrai solde précédent. */
export async function awardXp(
  userId: string, communityId: string | null, reason: XpReason,
  sourceId: string, baseAmount: number,
  { applyStreak = true, rewardNotice }: { applyStreak?: boolean; rewardNotice?: RewardNotice } = {},
): Promise<{ leveledUp: boolean; awarded: boolean }> {
  const id = await statsCommunityIdForSession(communityId);
  const defaultId = await getDefaultCommunityId();
  try {
    const result = await prisma.$transaction(async (tx) => {
      if (!(await lockCommunityProgress(tx, id, userId))) return null;
      // Le backfill a gardé les gains historiques dans default. Un replay d'un
      // parent d'un autre serveur ne doit pas les créditer une deuxième fois.
      if (id !== defaultId && reason !== "BADGE_UNLOCKED" && await tx.user.findFirst({
        where: { id: userId, xpEvents: { some: { communityId: defaultId, reason, sourceId } } }, select: { id: true },
      })) return null;
      // Ces gestes portent sur le compte global : live et backfill se sérialisent
      // sur User, puis vérifient le ledger toutes communautés dans la transaction.
      if (reason === "STEAM_LINK_FIRST" || reason === "AVAILABILITY_FIRST") {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
        if (await tx.user.findFirst({ where: { id: userId, xpEvents: { some: { reason, sourceId } } }, select: { id: true } })) return null;
      }
      const user = await tx.user.findUnique({ where: { id: userId }, select: { discordId: true } });
      if (!user) return null;
      const scopedDb = scopedTransactionPrisma(tx, { communityIds: [id], includesDefault: false });
      await scopedDb.communityMemberStats.createMany({ data: [{ communityId: id, userId }], skipDuplicates: true });
      if (reason === "CREATE_SESSION") {
        // Plafond anti-farm (création puis suppression en boucle). Le verrou de la
        // ligne de stats sérialise les créations simultanées du même membre : sans
        // lui, deux appels pourraient lire « 2 gains » et en inscrire chacun un.
        await tx.$queryRaw`SELECT "userId" FROM "CommunityMemberStats" WHERE "communityId" = ${id} AND "userId" = ${userId} FOR UPDATE`;
        const recentCreations = await scopedDb.xpEvent.count({
          where: { communityId: id, userId, reason, createdAt: { gte: new Date(Date.now() - CREATE_SESSION_XP_WINDOW_MS) } },
        });
        if (recentCreations >= CREATE_SESSION_DAILY_XP_CAP) return null;
      }
      const stats = await scopedDb.communityMemberStats.findUniqueOrThrow({ where: { communityId_userId: { communityId: id, userId } } });
      const amount = computeAwardedAmount(baseAmount, stats.streakCount, applyStreak);
      let rewardCreditId: string | undefined;
      if (rewardNotice) {
        const created = await scopedDb.xpEvent.createMany({ data: [{ communityId: id, userId, reason, sourceId, amount }], skipDuplicates: true });
        const credit = await scopedDb.xpEvent.findUniqueOrThrow({ where: { communityId_userId_reason_sourceId: { communityId: id, userId, reason, sourceId } } });
        rewardCreditId = credit.id;
        // Sans intention liée au crédit, l'historique ne prouve pas si une annonce a déjà été envoyée.
        // Un crédit existant n'est jamais renotifié ; une intention existante peut encore être livrée.
        if (created.count === 0) return { leveledUp: false, beforeLevel: 0, afterLevel: 0,
          discordId: user.discordId, awarded: false, rewardCreditId };
        await persistRewardNotice(tx, credit, rewardNotice);
      } else {
        await scopedDb.xpEvent.create({ data: { communityId: id, userId, reason, sourceId, amount } });
      }
      const updated = await scopedDb.communityMemberStats.update({
        where: { communityId_userId: { communityId: id, userId } },
        data: { xpTotal: { increment: amount }, xpBalance: { increment: amount } },
      });
      const beforeLevel = levelForXp(updated.xpTotal - amount);
      const afterLevel = levelForXp(updated.xpTotal);
      const leveledUp = didLevelUp(updated.xpTotal - amount, updated.xpTotal);
      if (leveledUp) await scopedDb.levelUpEvent.create({ data: { communityId: id, userId, level: afterLevel } });
      return { leveledUp, beforeLevel, afterLevel, discordId: user.discordId, awarded: true, rewardCreditId };
    });
    if (!result) return { leveledUp: false, awarded: false };
    if (result.rewardCreditId) await attemptDefaultRewardDelivery(result.rewardCreditId);
    if (result.leveledUp) {
      try {
        await announceLevelUp({ discordId: result.discordId }, result.beforeLevel, result.afterLevel, id);
      } catch (error) {
        logger.error("xp-actions", error, { userId, communityId: id, reason, sourceId, effect: "discord" });
      }
      await createNotification({
        userId, communityId: id, type: "LEVEL_UP", title: "🎉 Level up !",
        message: "Niveau " + result.beforeLevel + " → " + result.afterLevel + " · " + titleForLevel(result.afterLevel) + " · " + rankForLevel(result.afterLevel).name,
      });
    }
    return { leveledUp: result.leveledUp, awarded: result.awarded };
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return { leveledUp: false, awarded: false };
    throw error;
  }
}

/** Perte XP idempotente, plafonnée au solde et sans baisse sous zéro. */
export async function applySessionAbsencePenalty(
  userId: string,
  communityId: string | null,
  sessionId: string,
  configuredPenalty: number,
): Promise<boolean> {
  if (!Number.isInteger(configuredPenalty) || configuredPenalty <= 0) return false;
  const id = await statsCommunityIdForSession(communityId);
  try {
    return await prisma.$transaction(async (tx) => {
      if (!(await lockCommunityProgress(tx, id, userId))) return false;
      const scopedDb = scopedTransactionPrisma(tx, { communityIds: [id], includesDefault: false });
      await scopedDb.communityMemberStats.createMany({ data: [{ communityId: id, userId }], skipDuplicates: true });
      await tx.$queryRaw`SELECT "userId" FROM "CommunityMemberStats" WHERE "communityId" = ${id} AND "userId" = ${userId} FOR UPDATE`;
      const stats = await scopedDb.communityMemberStats.findUniqueOrThrow({
        where: { communityId_userId: { communityId: id, userId } },
        select: { xpTotal: true, xpBalance: true },
      });
      const amount = absencePenaltyAmount(configuredPenalty, stats.xpTotal);
      if (amount === 0) return false;
      await scopedDb.xpEvent.create({
        data: { communityId: id, userId, reason: "SESSION_ABSENCE", sourceId: sessionId, amount: -amount },
      });
      await scopedDb.communityMemberStats.update({
        where: { communityId_userId: { communityId: id, userId } },
        data: { xpTotal: { decrement: amount }, xpBalance: Math.max(0, stats.xpBalance - amount) },
      });
      return true;
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return false;
    throw error;
  }
}

const STREAK_MIN_GAP_MS = 12 * 60 * 60 * 1000;
const STREAK_BREAK_MS = 24 * 60 * 60 * 1000;

/**
 * Relit la ligne verrouillée : deux navigations concurrentes ne doublent pas le streak.
 * Voie rapide : un streak déjà enregistré il y a moins de 12 h (cas de presque toutes
 * les pages) ne change rien — une seule lecture, sans transaction ni verrou. Le
 * contrôle d'appartenance reste celui de `getMemberStats` (membre ACTIVE d'une
 * communauté ACTIVE) ; hors de cette voie, la transaction verrouillée relit tout.
 */
export async function touchStreak(userId: string, communityId: string): Promise<CommunityProgress & { touched: boolean }> {
  const known = await getMemberStats(userId, communityId);
  if (known.streakLastActiveAt && Date.now() - known.streakLastActiveAt.getTime() < STREAK_MIN_GAP_MS) {
    return { ...known, touched: false };
  }
  return prisma.$transaction(async (tx) => {
    if (!(await lockCommunityProgress(tx, communityId, userId))) return { ...ZERO_MEMBER_STATS, touched: false };
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    await scopedDb.communityMemberStats.createMany({ data: [{ communityId, userId }], skipDuplicates: true });
    await tx.$queryRaw`SELECT "userId" FROM "CommunityMemberStats" WHERE "communityId" = ${communityId} AND "userId" = ${userId} FOR UPDATE`;
    const stats = await scopedDb.communityMemberStats.findUniqueOrThrow({ where: { communityId_userId: { communityId, userId } } });
    const now = new Date();
    const gap = stats.streakLastActiveAt ? now.getTime() - stats.streakLastActiveAt.getTime() : Infinity;
    if (gap < STREAK_MIN_GAP_MS) return { ...stats, touched: false };
    const streakCount = gap <= STREAK_BREAK_MS ? stats.streakCount + 1 : 1;
    const updated = await scopedDb.communityMemberStats.update({
      where: { communityId_userId: { communityId, userId } },
      data: { streakCount, streakLastActiveAt: now, bestStreakCount: Math.max(stats.bestStreakCount, streakCount) },
    });
    return { ...updated, touched: true };
  });
}
