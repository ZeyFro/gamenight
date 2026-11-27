import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { enqueueForumRemovalsForUser } from "@/lib/player-classified-forum";

export type ProfileVisibilityValue = "COMMUNITY" | "HIDDEN";

/**
 * Visibilité du profil (cahier §12.3). OFF par défaut : actif seulement si la valeur vaut exactement `true`.
 * Éteint, aucune requête ne touche la table `UserProfileVisibility` et tous les profils restent visibles
 * comme avant.
 */
export function isProfileVisibilityEnabled(): boolean {
  return process.env.PROFILE_VISIBILITY_ENABLED === "true";
}

/**
 * Condition à ajouter aux requêtes de découverte (liste des potes, fiche d'un pote) : exclut les profils
 * masqués par leur propriétaire. Vide si le drapeau est éteint. Ne s'applique jamais à son propre profil
 * (l'appelant l'exclut déjà ou court-circuite).
 */
export function profileVisibilityWhere(): Prisma.UserWhereInput {
  if (!isProfileVisibilityEnabled()) return {};
  return { NOT: { profileVisibility: { is: { visibility: "HIDDEN" } } } };
}

export async function getProfileVisibility(userId: string): Promise<ProfileVisibilityValue> {
  const row = await prisma.userProfileVisibility.findUnique({ where: { userId }, select: { visibility: true } });
  return row?.visibility ?? "COMMUNITY";
}

export async function setProfileVisibility(userId: string, visibility: ProfileVisibilityValue): Promise<"saved" | "unavailable"> {
  if (!isProfileVisibilityEnabled()) return "unavailable";
  await prisma.userProfileVisibility.upsert({
    where: { userId },
    create: { userId, visibility },
    update: { visibility },
  });
  // D3 : masquer son profil retire IMMÉDIATEMENT (file) les fils forum déjà créés pour ses annonces ; le balayage du cron rattrape un échec.
  if (visibility === "HIDDEN" && (await enqueueForumRemovalsForUser(userId)) > 0) {
    logger.warn("profile-visibility", "Suppression des fils forum non enfilée : le balayage du cron la rattrapera.", {});
  }
  return "saved";
}
