import { prisma } from "@/lib/prisma";
import { scopedPrismaForCommunityId } from "@/lib/community-scoped-client";
import { personalCommunityIds } from "@/lib/community-stats";
import { ensureMemberStatsRow, getMemberStats } from "@/lib/member-stats";
import { isUniqueConstraintViolation } from "@/lib/xp-actions";
import { STAT_KEY_FOR_CRITERIA_TYPE, type BadgeCriteria, type BadgeStats } from "@/lib/badges";
import type { Badge } from "@prisma/client";

/**
 * Backfill badges — attribue rétroactivement tous les badges déjà mérités
 * par les users existants, à partir de l'historique en base. Convertie
 * depuis `prisma/backfill-badges.mjs` (PR "build ne fait plus que
 * compiler") : réutilise `STAT_KEY_FOR_CRITERIA_TYPE` (exportée depuis
 * `@/lib/badges`) au lieu de la dupliquer.
 *
 * `computeStats` et `unlockBadgeRaw` restent volontairement des
 * implémentations LOCALES, distinctes de `unlockMatchingBadges`/
 * `unlockBadge` (`@/lib/badges.ts`, chemin live) : ce dernier déclenche
 * systématiquement une annonce Discord + notification in-app à chaque
 * déblocage, un comportement que ce backfill doit explicitement NE JAMAIS
 * déclencher (décision produit : un premier passage où plusieurs users
 * méritent rétroactivement GOAT/Bibliophile/Citoyen etc. spammerait le
 * salon de dizaines de messages pour des exploits vieux de plusieurs
 * mois). Réutiliser le chemin live nécessiterait de lui ajouter un mode
 * silencieux — refactor plus risqué que le gain, donc pas fait ici.
 *
 * PR B (multi-communautés) : un badge se gagne PAR communauté. Le passage de
 * réconciliation évalue chaque membre dans CHAQUE communauté dont il est
 * membre actif (la communauté par défaut quand l'isolation est éteinte), sur
 * l'activité de cette communauté, et crédite l'éventuelle récompense d'XP dans
 * le registre de cette communauté.
 *
 * Idempotent via `@@unique([communityId, userId, badgeId])` sur `UserBadge` — le
 * chemin live et ce passage de réconciliation écrivent dans la même
 * table, aucune double attribution possible.
 *
 * LIMITE ASSUMÉE ET DOCUMENTÉE — Marathon (7j) / Insomniaque (30j) :
 * `User.streakCount` est une valeur COURANTE, pas un historique des pics
 * jamais atteints. Un user qui a déjà tenu un streak de 30 jours puis l'a
 * cassé ne peut pas être détecté rétroactivement ici — seul le streak
 * actuel est visible en base. Ces badges se débloqueront naturellement en
 * live la prochaine fois que le seuil est atteint (`checkTemporalBadges`).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Écriture idempotente d'un UserBadge + XP, sans notif Discord (voir décision ci-dessus). */
async function unlockBadgeRaw(userId: string, communityId: string, badge: Badge): Promise<void> {
  const scoped = await scopedPrismaForCommunityId(communityId);
  try {
    await scoped.$transaction(async (scopedDb) => {
      await scopedDb.userBadge.create({ data: { communityId, userId, badgeId: badge.id } });
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return; // déjà débloqué
    throw error;
  }

  if (badge.xpReward) {
    const amount = badge.xpReward;
    try {
      await scoped.$transaction(async (scopedDb) => {
        await scopedDb.xpEvent.create({
          data: { communityId, userId, reason: "BADGE_UNLOCKED", sourceId: badge.id, amount },
        });
        await ensureMemberStatsRow(scopedDb, communityId, userId);
        await scopedDb.communityMemberStats.update({
          where: { communityId_userId: { communityId, userId } },
          data: { xpTotal: { increment: amount } },
        });
      });
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error; // XpEvent déjà présent (chemin live entre-temps) — UserBadge suffit
    }
  }
}

async function computeStats(
  user: {
    id: string;
    createdAt: Date;
  },
  communityId: string
): Promise<BadgeStats> {
  const scopedDb = await scopedPrismaForCommunityId(communityId);
  const memberStats = await getMemberStats(user.id, communityId);
  const [sessionsCreated, sessionsParticipated, votesCast, superlativesWon, libraryCount] =
    await Promise.all([
      // Chantier nettoyage réel du stockage (V2, suite) — même correctif
      // que `checkSessionsCreatedBadges` (src/lib/badges.ts) : compte les
      // `XpEvent` `CREATE_SESSION`, jamais les lignes `Session` (purgeables).
      scopedDb.xpEvent.count({ where: { communityId, userId: user.id, reason: "CREATE_SESSION" } }),
      scopedDb.xpEvent.count({ where: { communityId, userId: user.id, reason: "PARTICIPATE" } }),
      scopedDb.xpEvent.count({ where: { communityId, userId: user.id, reason: "VOTE" } }),
      scopedDb.superlativeAward.count({ where: { winnerUserId: user.id } }),
      prisma.userGame.count({ where: { userId: user.id, owned: true } }),
    ]);

  const accountAgeDays = Math.floor((Date.now() - user.createdAt.getTime()) / DAY_MS);

  return {
    sessionsCreated,
    sessionsParticipated,
    votesCast,
    superlativesWon,
    libraryCount,
    streakCount: memberStats.streakCount,
    accountAgeDays,
  };
}

export async function backfillBadges(): Promise<void> {
  const badges = await prisma.badge.findMany({ where: { active: true } });
  if (badges.length === 0) return; // seedBadges pas encore passé — reporté au prochain passage

  const users = await prisma.user.findMany();
  if (users.length === 0) return;

  for (const user of users) {
    for (const communityId of await personalCommunityIds(user.id)) {
      const scopedDb = await scopedPrismaForCommunityId(communityId);
      const stats = await computeStats(user, communityId);
      const alreadyUnlocked = await scopedDb.userBadge.findMany({
        where: { communityId, userId: user.id },
        select: { badgeId: true },
      });
      const unlockedIds = new Set(alreadyUnlocked.map((b) => b.badgeId));

      for (const badge of badges) {
        if (unlockedIds.has(badge.id)) continue;
        const criteria = badge.criteria as unknown as BadgeCriteria;
        const key = STAT_KEY_FOR_CRITERIA_TYPE[criteria.type];
        const value = stats[key];
        if (value === undefined || value < criteria.count) continue;

        await unlockBadgeRaw(user.id, communityId, badge);
      }
    }
  }
}
