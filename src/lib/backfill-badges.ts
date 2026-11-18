import { prisma } from "@/lib/prisma";
import { getDefaultCommunityId } from "@/lib/default-community";
import { getMemberStats, lockCommunityProgress, durableProgressWhere } from "@/lib/member-stats";
import { scopedPrismaForCommunityId, scopedTransactionPrisma } from "@/lib/community-scoped-client";
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
 * Idempotent via `@@unique([userId, badgeId])` sur `UserBadge` — le
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
  try {
    await prisma.$transaction(async (tx) => {
      if (!(await lockCommunityProgress(tx, communityId, userId))) return;
      const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
      await scopedDb.userBadge.createMany({ data: [{ communityId, userId, badgeId: badge.id }], skipDuplicates: true });
      if (!badge.xpReward) return;
      // La récompense peut être manquante après un ancien crash, même si le badge existe.
      const event = await scopedDb.xpEvent.createMany({ data: [{ communityId, userId, reason: "BADGE_UNLOCKED", sourceId: badge.id, amount: badge.xpReward }], skipDuplicates: true });
      if (event.count === 0) return;
      await scopedDb.communityMemberStats.createMany({ data: [{ communityId, userId }], skipDuplicates: true });
      await scopedDb.communityMemberStats.update({ where: { communityId_userId: { communityId, userId } }, data: { xpTotal: { increment: badge.xpReward }, xpBalance: { increment: badge.xpReward } } });
    });
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
  }
}

async function computeStats(user: {
  id: string;
  createdAt: Date;
  streakCount: number;
}, communityId: string): Promise<BadgeStats> {
  const scopedDb = await scopedPrismaForCommunityId(communityId);
  const [sessionsCreated, sessionsParticipated, votesCast, superlativesWon, libraryCount] =
    await Promise.all([
      // Chantier nettoyage réel du stockage (V2, suite) — même correctif
      // que `checkSessionsCreatedBadges` (src/lib/badges.ts) : compte les
      // `XpEvent` `CREATE_SESSION`, jamais les lignes `Session` (purgeables).
      scopedDb.xpEvent.count({ where: { communityId, userId: user.id, reason: "CREATE_SESSION" } }),
      scopedDb.xpEvent.count({ where: { communityId, userId: user.id, reason: "PARTICIPATE" } }),
      scopedDb.xpEvent.count({ where: { communityId, userId: user.id, reason: "VOTE" } }),
      scopedDb.superlativeAward.count({ where: { winnerUserId: user.id, ...await durableProgressWhere(communityId) } }),
      prisma.userGame.count({ where: { userId: user.id, owned: true } }),
    ]);

  const accountAgeDays = Math.floor((Date.now() - user.createdAt.getTime()) / DAY_MS);

  return {
    sessionsCreated,
    sessionsParticipated,
    votesCast,
    superlativesWon,
    libraryCount,
    streakCount: user.streakCount,
    accountAgeDays,
  };
}

export async function backfillBadges(): Promise<void> {
  const badges = await prisma.badge.findMany({ where: { active: true } });
  if (badges.length === 0) return; // seedBadges pas encore passé — reporté au prochain passage

  const communityId = await getDefaultCommunityId();
  // Réconciliation historique seulement : pas de duplication automatique des
  // acquis globaux dans chaque serveur rejoint ultérieurement.
  const users = await prisma.user.findMany();
  for (const user of users) {
    const member = await getMemberStats(user.id, communityId);
    const stats = await computeStats({ ...user, streakCount: member.streakCount }, communityId);
    for (const badge of badges) {
      const criteria = badge.criteria as unknown as BadgeCriteria;
      const value = stats[STAT_KEY_FOR_CRITERIA_TYPE[criteria.type]];
      if (value === undefined || value < criteria.count) continue;
      await unlockBadgeRaw(user.id, communityId, badge);
    }
  }
}
