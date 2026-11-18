import type { Prisma } from "@prisma/client";
import { playerClassifiedFiltersSchema, playerClassifiedFilterWhere, type PlayerClassifiedFilters } from "./player-classified-filters";
import { findActiveMembership } from "@/lib/community-access";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { getScopedPrisma } from "@/lib/community-scoped-client";
import { levelKey, loadVisibleLevels } from "@/lib/game-level-filter";
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
  const where: Prisma.PlayerClassifiedWhereInput = {
    ...filterWhere,
    communityId,
    expiresAt: { gt: now },
    createdBy: { ...filterWhere.createdBy, memberships: { some: { communityId, status: "ACTIVE" } } },
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
  const levels = await loadVisibleLevels(userId, listings.map((listing) => ({ userId: listing.createdBy.id, gameId: listing.game.id })));
  return listings.map((listing) => ({ ...listing, authorLevel: levels.get(levelKey(listing.createdBy.id, listing.game.id)) ?? null }));
}
