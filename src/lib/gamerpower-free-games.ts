import "server-only";
import { unstable_cache } from "next/cache";
import { z } from "zod";
import { logger } from "@/lib/logger";

const REVALIDATE_SECONDS = 15 * 60;
const MAX_AGE_MS = 30 * 60 * 1000;
// shortcut: inspect three offers per store per refresh; raise with a measured need and a source-rate plan.
const MAX_CANDIDATES_PER_STORE = 3;
const MAX_OFFERS_PER_STORE = 3;
const source = "https://www.gamerpower.com/api/giveaways";

const giveawaySchema = z.object({
  id: z.union([z.number().int().positive(), z.string().min(1).max(80)]),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000).nullish(),
  instructions: z.string().max(10000).nullish(),
  type: z.string(),
  status: z.string(),
  open_giveaway_url: z.string().url(),
}).passthrough();

const excludedConditions = /\b(?:key|keys|points|subscription|subscriptions|trial|trials|membership|memberships|purchase required|paid|payment|paywall|dlc|in.game currency|demo|beta|playtest|free weekend|\barp\b)\b/i;

export type AutomaticFreeGameOffer = {
  id: string;
  store: "STEAM" | "EPIC";
  title: string;
  storeUrl: string;
  endsAt: null;
  source: "gamerpower";
};

type StorePlatform = "steam" | "epic-games-store";
type FeedSnapshot = {
  observedAt: string;
  offers: AutomaticFreeGameOffer[];
  activeOfferIds: Record<StorePlatform, string[]>;
  unavailablePlatforms: StorePlatform[];
};

function safeStoreUrl(value: string): Pick<AutomaticFreeGameOffer, "store" | "storeUrl"> | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (url.hostname === "store.steampowered.com" && /^\/app\/\d+(?:\/|$)/.test(url.pathname)) {
      url.search = "";
      url.searchParams.set("l", "french");
      url.searchParams.set("cc", "fr");
      url.hash = "";
      return { store: "STEAM", storeUrl: url.toString() };
    }
    if (url.hostname === "store.epicgames.com" && /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?p\/[a-z0-9-]+\/?$/i.test(url.pathname)) {
      const slug = url.pathname.match(/\/p\/([a-z0-9-]+)/i)?.[1];
      if (!slug) return null;
      url.pathname = `/fr/p/${slug}`;
      url.search = "";
      url.hash = "";
      return { store: "EPIC", storeUrl: url.toString() };
    }
  } catch {
    return null;
  }
  return null;
}

function isGamerPowerOpenUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      (url.hostname === "www.gamerpower.com" || url.hostname === "gamerpower.com") &&
      /^\/open\/[a-z0-9-]+\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

async function resolveOfficialStoreUrl(openUrl: string) {
  if (!isGamerPowerOpenUrl(openUrl)) return null;
  try {
    const response = await fetch(openUrl, { redirect: "manual", signal: AbortSignal.timeout(5000) });
    if (![301, 302, 303, 307, 308].includes(response.status)) return null;
    const location = response.headers.get("location");
    return location ? safeStoreUrl(new URL(location, openUrl).toString()) : null;
  } catch {
    return null;
  }
}

async function fetchStoreOffers(platform: StorePlatform): Promise<{ offers: AutomaticFreeGameOffer[]; activeOfferIds: string[] }> {
  const endpoint = new URL(source);
  endpoint.searchParams.set("platform", platform);
  endpoint.searchParams.set("type", "game");
  const response = await fetch(endpoint, { headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(5000) });
  if (response.status === 201) {
    const emptyResult = z.object({ status: z.literal(0), status_message: z.string() }).safeParse(await response.json());
    if (emptyResult.success) return { offers: [], activeOfferIds: [] };
    throw new Error("GamerPower empty response shape is invalid");
  }
  if (!response.ok) throw new Error(`GamerPower HTTP ${response.status}`);
  const body: unknown = await response.json();
  const parsed = z.array(giveawaySchema).safeParse(body);
  if (!parsed.success) throw new Error("GamerPower response shape is invalid");

  const candidates = parsed.data.filter((offer) => offer.type.toLowerCase() === "game" &&
    offer.status.toLowerCase() === "active" &&
    !excludedConditions.test(`${offer.title} ${offer.description ?? ""} ${offer.instructions ?? ""}`))
    .slice(0, MAX_CANDIDATES_PER_STORE);
  const activeOfferIds = parsed.data.filter((offer) => offer.type.toLowerCase() === "game" &&
    offer.status.toLowerCase() === "active" &&
    !excludedConditions.test(`${offer.title} ${offer.description ?? ""} ${offer.instructions ?? ""}`))
    .map((offer) => String(offer.id));
  const resolved = await Promise.all(candidates.map(async (candidate) => {
    const destination = await resolveOfficialStoreUrl(candidate.open_giveaway_url);
    return destination ? {
      id: `gamerpower-${destination.store.toLowerCase()}-${candidate.id}`,
      store: destination.store,
      title: candidate.title,
      storeUrl: destination.storeUrl,
      endsAt: null,
      source: "gamerpower",
    } satisfies AutomaticFreeGameOffer : null;
  }));
  return { offers: resolved.filter((offer): offer is AutomaticFreeGameOffer => offer !== null).slice(0, MAX_OFFERS_PER_STORE), activeOfferIds };
}

const readFeed = unstable_cache(async (): Promise<FeedSnapshot> => {
  const results = await Promise.allSettled([
    fetchStoreOffers("steam"),
    fetchStoreOffers("epic-games-store"),
  ]);
  const offers: AutomaticFreeGameOffer[] = [];
  const activeOfferIds: FeedSnapshot["activeOfferIds"] = { steam: [], "epic-games-store": [] };
  const unavailablePlatforms: StorePlatform[] = [];
  for (const [index, result] of results.entries()) {
    const platform = index === 0 ? "steam" : "epic-games-store";
    if (result.status === "fulfilled") {
      offers.push(...result.value.offers);
      activeOfferIds[platform] = result.value.activeOfferIds;
    } else {
      unavailablePlatforms.push(platform);
      logger.warn("free-game-feed", `Source ${index === 0 ? "Steam" : "Epic"} indisponible.`, {});
    }
  }
  return { observedAt: new Date().toISOString(), offers, activeOfferIds, unavailablePlatforms };
}, ["gamerpower-free-games-v2"], { revalidate: REVALIDATE_SECONDS });

export function isFeedSnapshotFresh(observedAt: string, now: Date): boolean {
  const timestamp = Date.parse(observedAt);
  return Number.isFinite(timestamp) && timestamp <= now.getTime() && now.getTime() - timestamp <= MAX_AGE_MS;
}

export async function listAutomaticFreeGameOffers(): Promise<AutomaticFreeGameOffer[]> {
  if (process.env.FREE_GAME_FEED_ENABLED !== "true") return [];
  try {
    const snapshot = await readFeed();
    return isFeedSnapshotFresh(snapshot.observedAt, new Date()) ? snapshot.offers : [];
  } catch {
    logger.warn("free-game-feed", "Flux d'offres indisponible.", {});
    return [];
  }
}

export async function getAutomaticFreeGameOfferStatus(offerId: string): Promise<"active" | "expired" | "unavailable"> {
  const match = /^gamerpower-(steam|epic)-(.+)$/.exec(offerId);
  if (!match) return "expired";
  const platform: StorePlatform = match[1] === "steam" ? "steam" : "epic-games-store";
  if (process.env.FREE_GAME_FEED_ENABLED !== "true") return "unavailable";
  try {
    const snapshot = await readFeed();
    if (!isFeedSnapshotFresh(snapshot.observedAt, new Date()) || snapshot.unavailablePlatforms.includes(platform)) return "unavailable";
    return snapshot.activeOfferIds[platform].includes(match[2]) ? "active" : "expired";
  } catch {
    logger.warn("free-game-feed", "Source indisponible pendant la vérification avant envoi.", {});
    return "unavailable";
  }
}
