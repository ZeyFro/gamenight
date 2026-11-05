import type { Prisma } from "@prisma/client";
import { playerClassifiedFiltersSchema, playerClassifiedFilterWhere, type PlayerClassifiedFilters } from "./player-classified-filters";
import { findActiveMembership } from "@/lib/community-access";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { getScopedPrisma } from "@/lib/community-scoped-client";
export { playerClassifiedExpiresAt, playerClassifiedSchema } from "@/lib/player-classifieds-rules";

export type PlayerClassifiedListing = {
  id: string;
  message: string;
  createdAt: Date;
  expiresAt: Date;
  platform: string | null;
  microphoneRequirement: "REQUIRED" | "OPTIONAL" | "NONE" | null;
  partyType: "CASUAL" | "COMPETITIVE" | "COOPERATIVE" | null;
  startsAt: Date | null;
  durationMinutes: number | null;
  game: { id: string; name: string };
  createdBy: { id: string; discordName: string; discordAvatar: string | null; color: string | null };
};

export async function getPlayerClassifiedCommunityId(userId: string): Promise<string | null> {
  const communityId = await resolveActiveCommunityId(userId);
  if (!communityId) return null;
  const membership = await findActiveMembership(userId, communityId);
  return membership?.community.playerClassifiedsEnabled ? communityId : null;
}

export async function listPlayerClassifieds(userId: string, communityId: string, now: Date, filters: PlayerClassifiedFilters = {}) {
  const filterWhere = playerClassifiedFilterWhere(playerClassifiedFiltersSchema.parse(filters));
  const scopedDb = await getScopedPrisma(userId);
  const where = {
      ...filterWhere,
      communityId,
      expiresAt: { gt: now },
      createdBy: { ...filterWhere.createdBy, memberships: { some: { communityId, status: "ACTIVE" } } },
  } as unknown as Prisma.PlayerClassifiedWhereInput;
  // Les champs de matchmaking sont ajoutés par la migration préparée dans le lot schéma.
  const select = {
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
  } as const;
  const listings = await scopedDb.playerClassified.findMany({
    where,
    select: select as never,
    orderBy: { createdAt: "desc" },
  });
  return listings as unknown as PlayerClassifiedListing[];
}
