import { prisma } from "@/lib/prisma";
import { ensureGroupAchievements } from "@/lib/group-achievements";
import { getDefaultCommunityId } from "@/lib/default-community";

/**
 * Seed des 10 trophées de groupe, PAR communauté (PR9) : la communauté par
 * défaut (créée si elle manque) et chaque communauté ACTIVE. Convertie depuis
 * `prisma/seed-group-achievements.mjs` (PR "build ne fait plus que
 * compiler") : importe directement `GROUP_ACHIEVEMENT_DEFS` de
 * `@/lib/group-achievements` au lieu de la dupliquer.
 *
 * Idempotent PAR CLÉ (`GroupAchievement` est unique sur `(communityId, key)`) :
 * une ligne déjà en base n'est jamais recréée ni écrasée — en particulier
 * `unlockedAt`, mis à jour uniquement par `checkGroupAchievements`
 * (`@/lib/group-achievements.ts`), n'est jamais touché ici.
 */
export async function seedGroupAchievements(): Promise<void> {
  const active = await prisma.community.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  const communityIds = new Set([await getDefaultCommunityId(), ...active.map((c) => c.id)]);
  for (const communityId of communityIds) await ensureGroupAchievements(communityId);
}
