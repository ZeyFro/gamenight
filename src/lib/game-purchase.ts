import { unstable_cache } from "next/cache";
import { fetchSteamStoreDetails } from "@/lib/steam-store";
import { logger } from "@/lib/logger";

// L'heure du relevé est mise en cache AVEC les données, jamais recréée à la lecture.
const readSteamPurchase = unstable_cache(async (appId: number) => {
  const details = await fetchSteamStoreDetails(appId, { signal: AbortSignal.timeout(5000) });
  return details ? { isFree: details.isFree, priceFormatted: details.priceFormatted,
    currency: details.priceCurrency, observedAt: new Date().toISOString() } : null;
}, ["steam-purchase-fr-v1"], { revalidate: 3600 });

export async function getSteamPurchaseInfo(appId: number) {
  if (!Number.isSafeInteger(appId) || appId <= 0) return null;
  try { return await readSteamPurchase(appId); }
  catch { logger.warn("steam-store", "Prix de fiche indisponible.", { appId }); return null; }
}
