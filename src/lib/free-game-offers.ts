import { findActiveMembership } from "@/lib/community-access";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { getScopedPrisma } from "@/lib/community-scoped-client";
import { listAutomaticFreeGameOffers } from "@/lib/gamerpower-free-games";

export async function getFreeGamesCommunityId(userId: string): Promise<string | null> {
  const communityId = await resolveActiveCommunityId(userId);
  if (!communityId) return null;
  const membership = await findActiveMembership(userId, communityId);
  return membership?.community.freeGamesEnabled ? communityId : null;
}

export async function listCurrentFreeGameOffers(userId: string, communityId: string, now: Date) {
  const scopedDb = await getScopedPrisma(userId);
  const manual = await scopedDb.freeGameOffer.findMany({
    where: {
      communityId,
      startsAt: { lte: now },
      endsAt: { gt: now },
    },
    select: { id: true, store: true, title: true, storeUrl: true, endsAt: true },
    orderBy: { endsAt: "asc" },
  });
  const curated = manual.map((offer) => ({ ...offer, source: "admin" as const }));
  if (process.env.FREE_GAME_FEED_ENABLED !== "true") return curated;

  const identities = new Set(curated.map((offer) => productIdentity(offer.store, offer.storeUrl)));
  const automatic = await listAutomaticFreeGameOffers();
  const uniqueAutomatic = automatic.filter((offer) => {
    const identity = productIdentity(offer.store, offer.storeUrl);
    if (identities.has(identity)) return false;
    identities.add(identity);
    return true;
  });
  return [...curated, ...uniqueAutomatic];
}

function productIdentity(store: string, storeUrl: string): string {
  try {
    const url = new URL(storeUrl);
    const steamAppId = store === "STEAM" ? url.pathname.match(/^\/app\/(\d+)(?:\/|$)/)?.[1] : null;
    if (steamAppId) return `STEAM:${steamAppId}`;
    return `${store}:${url.hostname}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return `${store}:${storeUrl}`;
  }
}
