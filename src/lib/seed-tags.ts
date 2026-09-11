import { prisma } from "@/lib/prisma";

/**
 * Seed des 6 tags par défaut. Convertie depuis `prisma/seed-tags.mjs` (PR
 * "build ne fait plus que compiler") — port mécanique.
 *
 * Idempotent PAR NOM (`Tag.name` est `@unique`) : un tag déjà en base
 * n'est jamais recréé, laissant les potes libres de créer leurs propres
 * tags sans jamais être écrasés.
 */

const DEFAULT_TAGS = ["FPS", "Coop", "Compétitif", "Chill", "Horreur", "Stratégie"];

export async function seedTags(): Promise<void> {
  for (const name of DEFAULT_TAGS) {
    await prisma.tag.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }
}
