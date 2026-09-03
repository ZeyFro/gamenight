// Seed des 6 tags par défaut (Sprint 3, FEATURE 6). Idempotent PAR NOM
// (`Tag.name` est `@unique`) — même philosophie que seed-badges.mjs :
// un tag déjà en base avec ce nom exact n'est jamais recréé, laissant les
// potes libres de créer leurs propres tags sans jamais être écrasés par un
// rejeu de ce script à chaque build.

import { PrismaClient } from "@prisma/client";

const DEFAULT_TAGS = ["FPS", "Coop", "Compétitif", "Chill", "Horreur", "Stratégie"];

const prisma = new PrismaClient();

async function main() {
  for (const name of DEFAULT_TAGS) {
    await prisma.tag.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
