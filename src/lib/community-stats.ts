import { getDefaultCommunityId } from "@/lib/default-community";
import { isCommunityIsolationEnabled, isMemberOfCommunity, resolveActiveCommunityId } from "@/lib/community-isolation";

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
 * sa communauté active ; la communauté par défaut quand l'isolation est éteinte
 * uniquement s'il en est membre ACTIVE ; `null` sans communauté autorisée.
 */
export async function writeCommunityIdForUser(userId: string): Promise<string | null> {
  if (!isCommunityIsolationEnabled()) {
    if (await isMemberOfCommunity(userId, null)) return getDefaultCommunityId();
    return resolveActiveCommunityId(userId);
  }
  return resolveActiveCommunityId(userId);
}
