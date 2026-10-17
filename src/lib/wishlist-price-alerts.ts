import { prisma } from "@/lib/prisma";
import { scopedTransactionPrisma, scopedPrisma } from "@/lib/community-scoped-client";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";
import { fetchSteamStoreDetails } from "@/lib/steam-store";
import { logger } from "@/lib/logger";
import { processInBatches } from "@/lib/cron-batch";

export const STEAM_PRICE_ALERT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
export const STEAM_PRICE_ALERT_SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_STEAM_PRICE_ALERT_THRESHOLD = 20;
const STEAM_PRICE_ALERT_CRON_LOCK = "wishlist-price-alerts";
const MAX_CHECKS_PER_RUN = 12;
const MAX_COMMUNITIES_PER_RUN = 20;
const BATCH_SIZE = 3;
const TIME_BUDGET_MS = 18_000;

export async function checkWishlistSteamPriceAlerts(): Promise<{ checked: number; notified: number; skipped: string | null }> {
  const lock = await acquireCronLock(STEAM_PRICE_ALERT_CRON_LOCK);
  if (!lock.acquired) return { checked: 0, notified: 0, skipped: lock.reason };

  const startedAt = Date.now();
  const now = new Date(startedAt);
  const scanCutoff = new Date(startedAt - STEAM_PRICE_ALERT_SCAN_INTERVAL_MS);
  const notificationCutoff = new Date(startedAt - STEAM_PRICE_ALERT_COOLDOWN_MS);
  const scopedDb = scopedPrisma(null);
  const quotes = new Map<number, ReturnType<typeof fetchSteamStoreDetails>>();
  let checked = 0;
  let notified = 0;

  try {
    const communities = await prisma.community.findMany({
      where: {
        steamPriceAlertsEnabled: true,
        OR: [{ steamPriceAlertScannedAt: null }, { steamPriceAlertScannedAt: { lt: scanCutoff } }],
      },
      orderBy: { steamPriceAlertScannedAt: { sort: "asc", nulls: "first" } },
      take: MAX_COMMUNITIES_PER_RUN,
      select: { id: true, steamPriceAlertThreshold: true, steamPriceAlertScannedAt: true },
    });

    for (const community of communities) {
      if (checked >= MAX_CHECKS_PER_RUN || Date.now() - startedAt >= TIME_BUDGET_MS) break;
      const claimed = await prisma.community.updateMany({
        where: {
          id: community.id,
          steamPriceAlertsEnabled: true,
          OR: [{ steamPriceAlertScannedAt: null }, { steamPriceAlertScannedAt: { lt: scanCutoff } }],
        },
        data: { steamPriceAlertScannedAt: now },
      });
      if (claimed.count !== 1) continue;

      const entries = await scopedDb.gameWishlist.findMany({
        where: {
          communityId: community.id,
          purchasedById: null,
          game: { steamAppId: { not: null } },
        },
        orderBy: { priceAlertCheckedAt: { sort: "asc", nulls: "first" } },
        take: Math.min(BATCH_SIZE, MAX_CHECKS_PER_RUN - checked),
        include: {
          game: { select: { id: true, name: true, steamAppId: true } },
          proposedBy: { select: { id: true } },
          votes: { where: { interested: true }, select: { userId: true } },
        },
      });

      const result = await processInBatches(entries, BATCH_SIZE, async (entry) => {
        const appId = entry.game.steamAppId;
        if (appId === null) return false;
        let quote = quotes.get(appId);
        if (!quote) {
          quote = fetchSteamStoreDetails(appId, { countryCode: "fr", signal: AbortSignal.timeout(4_000) });
          quotes.set(appId, quote);
        }
        let details = null;
        try {
          details = await quote;
        } catch (error) {
          logger.warn("wishlist-price-alerts", "Steam Store indisponible pour une entrée wishlist.", { gameId: entry.game.id, error });
        }

        const recipients = [...new Set([entry.proposedBy.id, ...entry.votes.map((vote) => vote.userId)])];
        let sent = false;
        if (details && recipients.length && shouldSendSteamPriceAlert(
          details.discountPercent,
          community.steamPriceAlertThreshold,
          entry.priceAlertNotifiedAt,
          now,
        )) {
          sent = await prisma.$transaction(async (tx) => {
            const scopedDb = scopedTransactionPrisma(tx, null);
            const claimedEntry = await scopedDb.gameWishlist.updateMany({
              where: {
                id: entry.id,
                OR: [{ priceAlertNotifiedAt: null }, { priceAlertNotifiedAt: { lt: notificationCutoff } }],
              },
              data: { priceAlertCheckedAt: now, priceAlertNotifiedAt: now },
            });
            if (claimedEntry.count !== 1) return false;
            await scopedDb.notification.createMany({
              data: recipients.map((userId) => ({
                userId,
                communityId: community.id,
                type: "WISHLIST_PRICE_DROP" as const,
                title: `-${details!.discountPercent}% sur ${entry.game.name}`,
                message: details!.priceFormatted ? `${details!.priceFormatted} sur Steam (France).` : "Une réduction est disponible sur Steam (France).",
                relatedGameId: entry.game.id,
              })),
            });
            return true;
          });
        } else {
          await scopedDb.gameWishlist.updateMany({ where: { id: entry.id }, data: { priceAlertCheckedAt: now } });
        }
        return sent;
      }, { shouldContinue: () => Date.now() - startedAt < TIME_BUDGET_MS });
      checked += result.processedCount;
      notified += result.results.filter((item) => item.status === "fulfilled" && item.value).length;
    }
  } finally {
    await releaseCronLock(lock.token);
  }

  logger.info("wishlist-price-alerts", `${checked} entrée(s) vérifiée(s), ${notified} alerte(s) in-app.`);
  return { checked, notified, skipped: null };
}

export function shouldSendSteamPriceAlert(
  discountPercent: number,
  thresholdPercent: number,
  lastNotifiedAt: Date | null,
  now: Date,
): boolean {
  return discountPercent >= thresholdPercent &&
    (lastNotifiedAt === null || now.getTime() - lastNotifiedAt.getTime() >= STEAM_PRICE_ALERT_COOLDOWN_MS);
}

export function parseSteamPriceAlertThreshold(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{1,2}$/.test(value)) return null;
  const threshold = Number(value);
  return threshold >= 5 && threshold <= 80 ? threshold : null;
}
