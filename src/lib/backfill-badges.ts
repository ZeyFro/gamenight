import { prisma } from "@/lib/prisma";
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
async function unlockBadgeRaw(userId: string, badge: Badge): Promise<void> {
  try {
    await prisma.userBadge.create({ data: { userId, badgeId: badge.id } });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return; // déjà débloqué
    throw error;
  }

  if (badge.xpReward) {
    try {
      await prisma.xpEvent.create({
        data: { userId, reason: "BADGE_UNLOCKED", sourceId: badge.id, amount: badge.xpReward },
      });
      await prisma.user.update({
        where: { id: userId },
        data: { xpTotal: { increment: badge.xpReward } },
      });
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error; // XpEvent déjà présent (chemin live entre-temps) — UserBadge suffit
    }
  }
}

async function computeStats(user: {
  id: string;
  createdAt: Date;
  streakCount: number;
}): Promise<BadgeStats> {
  const [sessionsCreated, sessionsParticipated, votesCast, superlativesWon, libraryCount] =
    await Promise.all([
      prisma.session.count({ where: { createdById: user.id } }),
      prisma.xpEvent.count({ where: { userId: user.id, reason: "PARTICIPATE" } }),
      prisma.xpEvent.count({ where: { userId: user.id, reason: "VOTE" } }),
      prisma.superlativeAward.count({ where: { winnerUserId: user.id } }),
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

  const users = await prisma.user.findMany();
  if (users.length === 0) return;

  for (const user of users) {
    const stats = await computeStats(user);
    const alreadyUnlocked = await prisma.userBadge.findMany({
      where: { userId: user.id },
      select: { badgeId: true },
    });
    const unlockedIds = new Set(alreadyUnlocked.map((b) => b.badgeId));

    for (const badge of badges) {
      if (unlockedIds.has(badge.id)) continue;
      const criteria = badge.criteria as unknown as BadgeCriteria;
      const key = STAT_KEY_FOR_CRITERIA_TYPE[criteria.type];
      const value = stats[key];
      if (value === undefined || value < criteria.count) continue;

      await unlockBadgeRaw(user.id, badge);
    }
  }
}
