// Seed des 10 trophées de groupe (Sprint 3 suite). Node/ESM autonome,
// même philosophie que prisma/seed-badges.mjs.
//
// Idempotent PAR CLÉ (`GroupAchievement.key` est `@unique`) : une ligne
// déjà en base avec cette clé n'est jamais recréée ni écrasée — en
// particulier `unlockedAt`, mis à jour uniquement par
// `checkGroupAchievements` (src/lib/group-achievements.ts), n'est jamais
// touché ici.
//
// Liste dupliquée depuis `GROUP_ACHIEVEMENT_DEFS`
// (src/lib/group-achievements.ts — un module TS avec alias `@/...` n'est
// pas exécutable tel quel par Node) : À GARDER EN SYNC si la liste change.

import { PrismaClient } from "@prisma/client";

const ACHIEVEMENTS = [
  { key: "premiere-soiree", name: "Première soirée", description: "1 soirée jouée.", icon: "🎮" },
  { key: "squad", name: "Squad", description: "5 joueurs différents ont participé.", icon: "👥" },
  { key: "marathoniens", name: "Marathoniens", description: "10 soirées jouées.", icon: "🏃" },
  { key: "diversite", name: "Diversité", description: "10 jeux différents joués.", icon: "🎲" },
  {
    key: "reguliers",
    name: "Réguliers",
    description: "4 semaines consécutives avec au moins 1 soirée.",
    icon: "📅",
  },
  {
    key: "noctambules",
    name: "Noctambules",
    description: "1 soirée commencée après 23h.",
    icon: "🌙",
  },
  { key: "century", name: "Century", description: "100 soirées jouées.", icon: "💯" },
  {
    key: "collectionneur-collectif",
    name: "Collectionneur collectif",
    description: "500 jeux dans la bibliothèque du groupe.",
    icon: "📚",
  },
  {
    key: "full-house",
    name: "Full House",
    description: "Une soirée avec TOUS les membres du groupe.",
    icon: "🏠",
  },
  {
    key: "legendaire",
    name: "Légendaire",
    description: "1 membre a atteint le rang Légende.",
    icon: "👑",
  },
];

const prisma = new PrismaClient();

async function main() {
  console.log("\n=== Seed trophées de groupe ===");
  let created = 0;
  for (const achievement of ACHIEVEMENTS) {
    const existing = await prisma.groupAchievement.findUnique({
      where: { key: achievement.key },
    });
    if (existing) {
      console.log(`- ${achievement.icon} ${achievement.name} : déjà en base — rien à faire.`);
      continue;
    }

    await prisma.groupAchievement.create({ data: achievement });
    created += 1;
    console.log(`- ${achievement.icon} ${achievement.name} : créé.`);
  }
  console.log(`=== ${created} trophée(s) créé(s) sur ${ACHIEVEMENTS.length} ===\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
