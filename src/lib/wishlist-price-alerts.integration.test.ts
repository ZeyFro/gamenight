import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
vi.mock("@/lib/steam-store", () => ({ fetchSteamStoreDetails: mocks.fetch }));
vi.mock("@/lib/cron-lock", () => ({ acquireCronLock: vi.fn(async () => ({ acquired: true, token: "isolated-test" })), releaseCronLock: vi.fn(async () => undefined) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

if (!TEST_DATABASE_URL) console.warn("[wishlist-price-alerts] Postgres local absent : intégrations SKIPPÉES.");

describe.skipIf(!TEST_DATABASE_URL)("alertes Steam : adhésions et communauté revérifiées en PostgreSQL local", () => {
  let db: import("@prisma/client").PrismaClient;
  let checkWishlistSteamPriceAlerts: typeof import("./wishlist-price-alerts")["checkWishlistSteamPriceAlerts"];
  let communityId: string;
  let proposerId: string;
  let removedVoterId: string;
  let serial = 0;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as typeof db;
    ({ checkWishlistSteamPriceAlerts } = await import("./wishlist-price-alerts"));
  });
  afterAll(async () => { await db?.$disconnect(); });
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "Notification", "GameWishlistVote", "GameWishlist", "Membership", "Community", "Game", "User" CASCADE');
    const community = await db.community.create({ data: {
      slug: `price-alert-${++serial}`,
      name: "Prix",
      status: "ACTIVE",
      steamPriceAlertsEnabled: true,
      steamPriceAlertThreshold: 20,
    } });
    communityId = community.id;
    const proposer = await db.user.create({ data: { discordId: `price-proposer-${serial}`, discordName: "Proposant" } });
    const voter = await db.user.create({ data: { discordId: `price-voter-${serial}`, discordName: "Votant retiré" } });
    proposerId = proposer.id;
    removedVoterId = voter.id;
    await db.membership.createMany({ data: [
      { communityId, userId: proposerId, status: "ACTIVE" },
      { communityId, userId: removedVoterId, status: "REMOVED" },
    ] });
    const game = await db.game.create({ data: { name: `Jeu ${serial}`, source: "STEAM", steamAppId: 900000 + serial, addedById: proposerId } });
    const wishlist = await db.gameWishlist.create({ data: { gameId: game.id, proposedById: proposerId, communityId } });
    await db.gameWishlistVote.create({ data: { wishlistId: wishlist.id, userId: removedVoterId, interested: true } });
    mocks.fetch.mockReset().mockResolvedValue({ discountPercent: 50, priceFormatted: "5,00 €" });
  }, 30_000);
  afterEach(() => vi.unstubAllEnvs());

  it("n'envoie pas l'alerte au votant retiré", async () => {
    await expect(checkWishlistSteamPriceAlerts()).resolves.toMatchObject({ checked: 1, notified: 1 });
    expect(await db.notification.findMany({ where: { type: "WISHLIST_PRICE_DROP" }, select: { userId: true, communityId: true } }))
      .toEqual([{ userId: proposerId, communityId }]);
  });

  it("abandonne l'écriture si la communauté est suspendue après le relevé Steam", async () => {
    mocks.fetch.mockImplementation(async () => {
      await db.community.update({ where: { id: communityId }, data: { status: "SUSPENDED" } });
      return { discountPercent: 50, priceFormatted: "5,00 €" };
    });
    await expect(checkWishlistSteamPriceAlerts()).resolves.toMatchObject({ checked: 1, notified: 0 });
    expect(await db.notification.count({ where: { type: "WISHLIST_PRICE_DROP" } })).toBe(0);
  });
});
