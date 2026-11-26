import type { Prisma } from "@prisma/client";
import { playerClassifiedFiltersSchema, playerClassifiedFilterWhere, type PlayerClassifiedFilters } from "./player-classified-filters";
import { findActiveMembership } from "@/lib/community-access";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { getScopedPrisma } from "@/lib/community-scoped-client";
import { withPosterLevels } from "@/lib/game-levels-matchmaking";
import { levelKey, loadVisibleLevels } from "@/lib/game-level-filter";
import { isProfileVisibilityEnabled, profileVisibilityWhere } from "@/lib/profile-visibility";
export { playerClassifiedExpiresAt, playerClassifiedSchema } from "@/lib/player-classifieds-rules";

export async function getPlayerClassifiedCommunityId(userId: string): Promise<string | null> {
  const communityId = await resolveActiveCommunityId(userId);
  if (!communityId) return null;
  const membership = await findActiveMembership(userId, communityId);
  return membership?.community.playerClassifiedsEnabled ? communityId : null;
}

export async function listPlayerClassifieds(userId: string, communityId: string, now: Date, filters: PlayerClassifiedFilters = {}) {
  const filterWhere = playerClassifiedFilterWhere(playerClassifiedFiltersSchema.parse(filters));
  const scopedDb = await getScopedPrisma(userId);
  // Confidentialité (C039) : une annonce est une découverte de joueur. Un profil masqué
  // n'est donc jamais exposé à un autre membre ; son propriétaire continue de voir la sienne.
  const visibility = isProfileVisibilityEnabled()
    ? { OR: [{ id: userId }, profileVisibilityWhere()] }
    : {};
  const where: Prisma.PlayerClassifiedWhereInput = {
    ...filterWhere,
    communityId,
    expiresAt: { gt: now },
    createdBy: {
      ...filterWhere.createdBy,
      ...visibility,
      memberships: { some: { communityId, status: "ACTIVE" } },
    },
  };
  const listings = await scopedDb.playerClassified.findMany({
    where,
    select: {
      id: true,
      message: true,
      createdAt: true,
      expiresAt: true,
      platform: true,
      microphoneRequirement: true,
      partyType: true,
      startsAt: true,
      durationMinutes: true,
      game: { select: { id: true, name: true } },
      createdBy: { select: { id: true, discordName: true, discordAvatar: true, color: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const parsedFilters = playerClassifiedFiltersSchema.parse(filters);
  // Jeu replié dans le sélecteur : le niveau déclaré peut vivre sur n'importe
  // quelle ligne équivalente, comme l'annonce elle-même.
  const gameGroup = parsedFilters.gameIds?.length
    ? parsedFilters.gameIds
    : parsedFilters.gameId ? [parsedFilters.gameId] : [];
  const withPoster = await withPosterLevels(listings, parsedFilters.level || null, parsedFilters.gameIds);
  const levelPairs = [...new Map(withPoster.flatMap((listing) => gameGroup.length
    ? gameGroup.map((gameId) => ({ userId: listing.createdBy.id, gameId }))
    : [{ userId: listing.createdBy.id, gameId: listing.game.id }])
    .map((pair) => [levelKey(pair.userId, pair.gameId), pair])).values()];
  const levels = await loadVisibleLevels(userId, levelPairs);
  const levelOf = (listing: (typeof withPoster)[number]) => {
    for (const gameId of gameGroup.length ? gameGroup : [listing.game.id]) {
      const level = levels.get(levelKey(listing.createdBy.id, gameId));
      if (level) return level;
    }
    return null;
  };
  return withPoster.map((listing) => ({ ...listing, authorLevel: levelOf(listing) }));
}
