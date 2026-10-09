import { prisma } from "@/lib/prisma";
import { getDefaultCommunityId } from "@/lib/default-community";
import { isCommunityIsolationEnabled, resolveActiveCommunityId } from "@/lib/community-isolation";

/**
 * Multi-communautés, PR9 — communauté à laquelle rattacher une ligne des tables à
 * `communityId` OBLIGATOIRE (`GameWishlist`, `GroupAchievement`,
 * `GroupSessionStats`, `GroupGameStat`, `GroupActiveWeek`). Contrairement aux
 * autres modèles collectifs, `null` n'existe pas ici : la communauté par défaut
 * a un vrai identifiant, utilisé aussi quand l'isolation est éteinte.
 */

/** Communauté d'une ligne dérivée d'une soirée (`Session.communityId`, `null` = par défaut). */
export async function statsCommunityIdForSession(sessionCommunityId: string | null): Promise<string> {
  return sessionCommunityId ?? (await getDefaultCommunityId());
}

/**
 * Communauté d'une ligne créée PAR un utilisateur (proposition de wishlist) :
 * sa communauté active ; la communauté par défaut quand l'isolation est éteinte ;
 * `null` s'il n'a aucune communauté (création refusée).
 */
export async function writeCommunityIdForUser(userId: string): Promise<string | null> {
  if (!isCommunityIsolationEnabled()) return getDefaultCommunityId();
  return resolveActiveCommunityId(userId);
}

/**
 * PR B — communautés dans lesquelles une action PERSONNELLE de `userId` (premier
 * créneau de dispo, liaison Steam, bibliothèque de jeux) est créditée : toutes les
 * communautés ACTIVE dont il est membre ACTIF ; la communauté par défaut quand
 * l'isolation est éteinte. Chaque communauté a son propre registre d'XP : l'XP
 * « une fois dans la vie » y est donc attribuée une fois PAR communauté. Vide si
 * l'utilisateur n'a aucune communauté (rien n'est crédité).
 */
export async function personalCommunityIds(userId: string): Promise<string[]> {
  if (!isCommunityIsolationEnabled()) return [await getDefaultCommunityId()];
  const memberships = await prisma.membership.findMany({
    where: { userId, status: "ACTIVE", community: { status: "ACTIVE" } },
    select: { communityId: true },
    orderBy: { joinedAt: "asc" },
  });
  return memberships.map((m) => m.communityId);
}
