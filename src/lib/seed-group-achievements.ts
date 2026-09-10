import { prisma } from "@/lib/prisma";
import { GROUP_ACHIEVEMENT_DEFS } from "@/lib/group-achievements";

/**
 * Seed des 10 trophées de groupe. Convertie depuis
 * `prisma/seed-group-achievements.mjs` (PR "build ne fait plus que
 * compiler") : importe directement `GROUP_ACHIEVEMENT_DEFS` de
 * `@/lib/group-achievements` au lieu de la dupliquer — l'ancienne version
 * Node/ESM autonome ne pouvait pas résoudre l'alias `@/...`.
 *
 * Idempotent PAR CLÉ (`GroupAchievement.key` est `@unique`) : une ligne
 * déjà en base n'est jamais recréée ni écrasée — en particulier
 * `unlockedAt`, mis à jour uniquement par `checkGroupAchievements`
 * (`@/lib/group-achievements.ts`), n'est jamais touché ici.
 */
export async function seedGroupAchievements(): Promise<void> {
  for (const achievement of GROUP_ACHIEVEMENT_DEFS) {
    const existing = await prisma.groupAchievement.findUnique({
      where: { key: achievement.key },
    });
    if (existing) continue;

    await prisma.groupAchievement.create({ data: achievement });
  }
}
