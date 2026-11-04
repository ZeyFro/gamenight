import { playerClassifiedFiltersSchema, playerClassifiedFilterWhere, type PlayerClassifiedFilters } from "./player-classified-filters";
import { findActiveMembership } from "@/lib/community-access";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { getScopedPrisma } from "@/lib/community-scoped-client";
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
  return scopedDb.playerClassified.findMany({
    where: {
      ...filterWhere,
      communityId,
      expiresAt: { gt: now },
      createdBy: { ...filterWhere.createdBy, memberships: { some: { communityId, status: "ACTIVE" } } },
    },
    select: {
      id: true,
      message: true,
      createdAt: true,
      expiresAt: true,
      game: { select: { id: true, name: true } },
      createdBy: { select: { id: true, discordName: true, discordAvatar: true, color: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}
