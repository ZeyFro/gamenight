import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  communities: vi.fn(),
  claimCommunity: vi.fn(),
  wishlist: vi.fn(),
  updateWishlist: vi.fn(),
  claimAlert: vi.fn(),
  createNotifications: vi.fn(),
  transaction: vi.fn(),
  acquire: vi.fn(),
  release: vi.fn(),
  fetch: vi.fn(),
  scoped: vi.fn(),
  scopedTransaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    community: { findMany: mocks.communities, updateMany: mocks.claimCommunity },
    gameWishlist: { updateMany: mocks.updateWishlist },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/community-scoped-client", () => ({ scopedPrisma: mocks.scoped, scopedTransactionPrisma: mocks.scopedTransaction }));
vi.mock("@/lib/cron-lock", () => ({ acquireCronLock: mocks.acquire, releaseCronLock: mocks.release }));
vi.mock("@/lib/steam-store", () => ({ fetchSteamStoreDetails: mocks.fetch }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

import { checkWishlistSteamPriceAlerts } from "./wishlist-price-alerts";

describe("checkWishlistSteamPriceAlerts", () => {
  const entry = {
    id: "wishlist-1",
    priceAlertNotifiedAt: null,
    game: { id: "game-1", name: "Game One", steamAppId: 123 },
    proposedBy: { id: "user-1" },
    votes: [{ userId: "user-2" }, { userId: "user-1" }],
  };
  const transactionClient = { gameWishlist: { updateMany: mocks.claimAlert }, notification: { createMany: mocks.createNotifications } };
  const scopedClient = { gameWishlist: { findMany: mocks.wishlist, updateMany: mocks.updateWishlist } };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquire.mockResolvedValue({ acquired: true, token: "lock" });
    mocks.release.mockResolvedValue(undefined);
    mocks.communities.mockResolvedValue([{ id: "community-1", steamPriceAlertThreshold: 20 }]);
    mocks.claimCommunity.mockResolvedValue({ count: 1 });
    mocks.wishlist.mockResolvedValue([entry]);
    mocks.scoped.mockReturnValue(scopedClient);
    mocks.scopedTransaction.mockReturnValue(transactionClient);
    mocks.fetch.mockResolvedValue({ discountPercent: 25, priceFormatted: "15,00 €" });
    mocks.transaction.mockImplementation((callback) => callback(transactionClient));
    mocks.claimAlert.mockResolvedValue({ count: 1 });
  });

  it("fetches the France quote and atomically notifies the proposer and interested voters", async () => {
    await expect(checkWishlistSteamPriceAlerts()).resolves.toMatchObject({ checked: 1, notified: 1, skipped: null });
    expect(mocks.fetch).toHaveBeenCalledWith(123, expect.objectContaining({ countryCode: "fr" }));
    expect(mocks.createNotifications).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ userId: "user-1", communityId: "community-1", type: "WISHLIST_PRICE_DROP", relatedGameId: "game-1" }),
        expect.objectContaining({ userId: "user-2", communityId: "community-1", type: "WISHLIST_PRICE_DROP", relatedGameId: "game-1" }),
      ],
    });
  });

  it("does not query Steam when another run owns the lock", async () => {
    mocks.acquire.mockResolvedValue({ acquired: false, reason: "locked" });
    await expect(checkWishlistSteamPriceAlerts()).resolves.toEqual({ checked: 0, notified: 0, skipped: "locked" });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.communities).not.toHaveBeenCalled();
  });
});
