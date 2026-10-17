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

export async function listPlayerClassifieds(userId: string, communityId: string, now: Date) {
  const scopedDb = await getScopedPrisma(userId);
  return scopedDb.playerClassified.findMany({
    where: {
      communityId,
      expiresAt: { gt: now },
      createdBy: { memberships: { some: { communityId, status: "ACTIVE" } } },
    },
    select: {
      id: true,
      message: true,
      createdAt: true,
      expiresAt: true,
      game: { select: { name: true } },
      createdBy: { select: { id: true, discordName: true, discordAvatar: true, color: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}
