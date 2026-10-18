import { findActiveMembership } from "@/lib/community-access";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { getScopedPrisma } from "@/lib/community-scoped-client";

export async function getFreeGamesCommunityId(userId: string): Promise<string | null> {
  const communityId = await resolveActiveCommunityId(userId);
  if (!communityId) return null;
  const membership = await findActiveMembership(userId, communityId);
  return membership?.community.freeGamesEnabled ? communityId : null;
}

export async function listCurrentFreeGameOffers(userId: string, communityId: string, now: Date) {
  const scopedDb = await getScopedPrisma(userId);
  return scopedDb.freeGameOffer.findMany({
    where: {
      communityId,
      startsAt: { lte: now },
      endsAt: { gt: now },
    },
    select: { id: true, store: true, title: true, storeUrl: true, endsAt: true },
    orderBy: { endsAt: "asc" },
  });
}
