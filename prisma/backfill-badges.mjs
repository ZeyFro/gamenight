// Backfill badges (PR 7/9) — attribue rétroactivement tous les badges déjà
// mérités par les users existants, à partir de l'historique en base.
//
// Node/ESM autonome, même philosophie que prisma/backfill-xp.mjs (pas de
// ts-node/tsx en dépendance) : duplique volontairement les critères des
// badges plutôt que d'importer src/lib/badges.ts (alias `@/...` non
// exécutable tel quel par Node). Wired dans `npm run build`, juste après
// prisma/seed-badges.mjs (a besoin que les 15 `Badge` existent déjà en
// base) : idempotent via `@@unique([userId, badgeId])` sur `UserBadge`,
// donc sûr à rejouer à CHAQUE déploiement — le chemin "live"
// (`checkXxxBadges` dans src/lib/badges.ts) et ce passage de
// réconciliation écrivent tous les deux dans la même table idempotente,
// aucune double attribution possible.
//
// IMPORTANT — DÉCISION (demandée explicitement par l'utilisateur, PR 7/9) :
// ce script ne déclenche JAMAIS de notif Discord "badge débloqué",
// contrairement au chemin live (`unlockBadge`, src/lib/badges.ts). Un
// premier déploiement où plusieurs users méritent déjà rétroactivement
// GOAT/Bibliophile/Citoyen etc. spammerait le salon de 20-30 messages
// "vient de débloquer" pour des exploits vieux de plusieurs mois — aussi
// absurde que le spam de "level up" rétroactifs déjà évité par
// backfill-xp.mjs. L'XP, en revanche, EST accordée rétroactivement (même
// choix que backfill-xp.mjs pour le XP de participation) : un badge
// mérité doit compter dans le total, silencieusement.
//
// LIMITE ASSUMÉE ET DOCUMENTÉE — Marathon (7j) / Insomniaque (30j) :
// `User.streakCount` est une valeur COURANTE, pas un historique des pics
// jamais atteints. Un user qui a déjà tenu un streak de 30 jours puis l'a
// cassé (>24h sans connexion) ne peut PAS être détecté rétroactivement
// ici — seul son streak actuel est visible en base, pas son maximum
// passé. Ce script ne peut donc attribuer ces deux badges qu'aux users
// dont le streak ACTUEL dépasse déjà le seuil au moment du backfill ;
// les autres les débloqueront naturellement en live la prochaine fois
// qu'ils atteignent le seuil (`checkTemporalBadges`, appelée à chaque
// connexion via `getCurrentUser`). Pas de contournement possible sans
// historiser le streak jour par jour, hors scope ici.
//
// Ce script n'a pas accès à une base de prod réelle depuis ce sandbox —
// impossible de connaître à l'avance les badges exacts mérités par
// chaque user. Il imprime donc un récapitulatif détaillé par user à
// chaque exécution (visible dans les logs de build Vercel).

import { PrismaClient } from "@prisma/client";

const STAT_KEY_FOR_CRITERIA_TYPE = {
  SESSIONS_CREATED: "sessionsCreated",
  SESSIONS_PARTICIPATED: "sessionsParticipated",
  VOTES_CAST: "votesCast",
  SUPERLATIVES_WON: "superlativesWon",
  LIBRARY_SIZE: "libraryCount",
  STREAK_DAYS: "streakCount",
  ACCOUNT_AGE_DAYS: "accountAgeDays",
};

const DAY_MS = 24 * 60 * 60 * 1000;

const prisma = new PrismaClient();

/** Écriture idempotente d'un UserBadge + XP, sans notif Discord (voir décision ci-dessus). */
async function unlockBadgeRaw(userId, badge) {
  try {
    await prisma.userBadge.create({ data: { userId, badgeId: badge.id } });
  } catch (err) {
    if (err.code === "P2002") return false; // déjà débloqué (backfill précédent, ou déjà crédité en live)
    throw err;
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
    } catch (err) {
      if (err.code !== "P2002") throw err; // XpEvent déjà présent (chemin live entre-temps) — UserBadge suffit
    }
  }

  return true;
}

async function computeStats(user) {
  const [
    sessionsCreated,
    sessionsParticipated,
    votesCast,
    superlativesWon,
    libraryCount,
  ] = await Promise.all([
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

async function main() {
  const badges = await prisma.badge.findMany();
  if (badges.length === 0) {
    console.log(
      "[backfill-badges] Aucun badge en base pour l'instant (seed-badges.mjs pas encore passé ?) — reporté au prochain build."
    );
    return;
  }

  const users = await prisma.user.findMany();
  if (users.length === 0) {
    console.log("[backfill-badges] Aucun user en base pour l'instant.");
    return;
  }

  console.log("\n=== Backfill badges — récapitulatif (à vérifier manuellement) ===");

  for (const user of users) {
    const stats = await computeStats(user);
    const alreadyUnlocked = await prisma.userBadge.findMany({
      where: { userId: user.id },
      select: { badgeId: true },
    });
    const unlockedIds = new Set(alreadyUnlocked.map((b) => b.badgeId));

    const newlyUnlocked = [];
    for (const badge of badges) {
      if (unlockedIds.has(badge.id)) continue;
      const key = STAT_KEY_FOR_CRITERIA_TYPE[badge.criteria.type];
      const value = stats[key];
      if (value === undefined || value < badge.criteria.count) continue;

      const unlocked = await unlockBadgeRaw(user.id, badge);
      if (unlocked) newlyUnlocked.push(badge);
    }

    console.log(`\n${user.discordName} :`);
    console.log(
      `  stats — soirées créées ${stats.sessionsCreated}, participées ${stats.sessionsParticipated}, votes ${stats.votesCast}, superlatifs gagnés ${stats.superlativesWon}, biblio ${stats.libraryCount}, streak ${stats.streakCount}j, compte ${stats.accountAgeDays}j`
    );
    if (newlyUnlocked.length === 0) {
      console.log("  aucun nouveau badge débloqué par ce backfill.");
    } else {
      for (const b of newlyUnlocked) {
        console.log(`  + débloqué : ${b.icon} ${b.name} (${b.rarity}, +${b.xpReward ?? 0} XP)`);
      }
    }
  }

  console.log("\n=== Fin du récapitulatif ===\n");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
