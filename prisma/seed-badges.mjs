// Seed des 15 badges automatiques par défaut (PR 7/9). Node/ESM autonome,
// même philosophie que les autres scripts prisma/*.mjs — wired dans `npm
// run build`, doit rester silencieux et sûr à rejouer indéfiniment.
//
// Idempotent PAR NOM (`Badge.name` est `@unique`) : un badge déjà en base
// avec ce nom exact n'est jamais recréé ni écrasé — si son critère ou son
// XP est modifié depuis /admin/badges (à venir) ou directement en base,
// ce script ne revient jamais dessus.
//
// XP dérivé de la rareté (`BADGE_XP_BY_RARITY`, dupliqué ici depuis
// src/lib/badge-rarity.ts — même raison que backfill-xp.mjs duplique
// XP_AMOUNTS : un module TS avec alias `@/...` n'est pas exécutable tel
// quel par Node). À GARDER EN SYNC si l'échelle change.

import { PrismaClient } from "@prisma/client";

const BADGE_XP_BY_RARITY = {
  COMMON: 20,
  RARE: 40,
  EPIC: 75,
  LEGENDARY: 150,
};

const BADGES = [
  {
    name: "First Blood",
    icon: "🎉",
    description: "Créer sa première soirée.",
    category: "PARTICIPATION",
    rarity: "COMMON",
    criteria: { type: "SESSIONS_CREATED", count: 1 },
  },
  {
    name: "Habitué",
    icon: "🎮",
    description: "Participer à 10 soirées.",
    category: "PARTICIPATION",
    rarity: "COMMON",
    criteria: { type: "SESSIONS_PARTICIPATED", count: 10 },
  },
  {
    name: "GOAT",
    icon: "🏆",
    description: "Participer à 50 soirées.",
    category: "PARTICIPATION",
    rarity: "RARE",
    criteria: { type: "SESSIONS_PARTICIPATED", count: 50 },
  },
  {
    name: "LÉGENDE",
    icon: "👑",
    description: "Participer à 100 soirées.",
    category: "PARTICIPATION",
    rarity: "LEGENDARY",
    criteria: { type: "SESSIONS_PARTICIPATED", count: 100 },
  },
  {
    name: "Marathon",
    icon: "⚡",
    description: "7 jours de connexion d'affilée.",
    category: "ENGAGEMENT",
    rarity: "RARE",
    criteria: { type: "STREAK_DAYS", count: 7 },
  },
  {
    name: "Insomniaque",
    icon: "🔥",
    description: "30 jours de connexion d'affilée.",
    category: "ENGAGEMENT",
    rarity: "EPIC",
    criteria: { type: "STREAK_DAYS", count: 30 },
  },
  {
    name: "Ancien",
    icon: "💎",
    // 182 jours ≈ 6 mois.
    description: "6 mois sur l'app.",
    category: "ENGAGEMENT",
    rarity: "RARE",
    criteria: { type: "ACCOUNT_AGE_DAYS", count: 182 },
  },
  {
    name: "Vétéran",
    icon: "🌟",
    description: "1 an sur l'app.",
    category: "ENGAGEMENT",
    rarity: "EPIC",
    criteria: { type: "ACCOUNT_AGE_DAYS", count: 365 },
  },
  {
    name: "Bibliophile",
    icon: "📚",
    description: "30 jeux ou plus dans sa bibliothèque.",
    category: "BIBLIOTHEQUE",
    rarity: "COMMON",
    criteria: { type: "LIBRARY_SIZE", count: 30 },
  },
  {
    name: "Collectionneur",
    icon: "🎯",
    description: "100 jeux ou plus dans sa bibliothèque.",
    category: "BIBLIOTHEQUE",
    rarity: "RARE",
    criteria: { type: "LIBRARY_SIZE", count: 100 },
  },
  {
    name: "Citoyen",
    icon: "🗳️",
    description: "20 votes émis.",
    category: "VOTE",
    rarity: "COMMON",
    criteria: { type: "VOTES_CAST", count: 20 },
  },
  {
    name: "Meneur",
    icon: "📣",
    description: "Créer 5 soirées.",
    category: "VOTE",
    rarity: "COMMON",
    criteria: { type: "SESSIONS_CREATED", count: 5 },
  },
  {
    name: "Community leader",
    icon: "🎤",
    description: "Créer 20 soirées.",
    category: "VOTE",
    rarity: "RARE",
    criteria: { type: "SESSIONS_CREATED", count: 20 },
  },
  {
    name: "Compétiteur",
    icon: "🥇",
    description: "Gagner 5 superlatifs.",
    category: "SUPERLATIFS",
    rarity: "RARE",
    criteria: { type: "SUPERLATIVES_WON", count: 5 },
  },
  {
    name: "Star",
    icon: "🌟",
    description: "Gagner 20 superlatifs.",
    category: "SUPERLATIFS",
    rarity: "EPIC",
    criteria: { type: "SUPERLATIVES_WON", count: 20 },
  },
  {
    name: "Challenger",
    icon: "🎯",
    description: "Compléter 5 défis hebdo.",
    category: "ENGAGEMENT",
    rarity: "RARE",
    criteria: { type: "CHALLENGES_COMPLETED", count: 5 },
  },
];

const prisma = new PrismaClient();

async function main() {
  // `modifiedById` (audit trail, PR 8/9 — /admin/badges) est devenu
  // obligatoire sur Badge. Même garde-fou que les autres seeds : pas
  // d'utilisateur encore en base -> reporté au prochain build, plutôt
  // que de planter (cf. le hotfix appliqué à seed-game-stats.mjs après
  // le même oubli lors de l'ajout de l'audit trail sur GameStatType).
  const author = await prisma.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!author) {
    console.log(
      "[seed-badges] Aucun utilisateur en base pour l'instant — seed reporté au prochain build."
    );
    return;
  }

  console.log("\n=== Seed badges ===");
  let created = 0;
  for (const badge of BADGES) {
    const existing = await prisma.badge.findUnique({ where: { name: badge.name } });
    if (existing) {
      console.log(`- ${badge.icon} ${badge.name} : déjà en base — rien à faire.`);
      continue;
    }

    const xpReward = BADGE_XP_BY_RARITY[badge.rarity];
    await prisma.badge.create({ data: { ...badge, xpReward, modifiedById: author.id } });
    created += 1;
    console.log(
      `- ${badge.icon} ${badge.name} (${badge.rarity}) : créé (+${xpReward} XP, critère ${badge.criteria.type} >= ${badge.criteria.count}).`
    );
  }
  console.log(`=== ${created} badge(s) créé(s) sur ${BADGES.length} ===\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
