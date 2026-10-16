import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

if (!TEST_DATABASE_URL) console.warn("[xp-shop] TEST_DATABASE_URL absente : tests Postgres ignorés.");

describe.skipIf(!TEST_DATABASE_URL)("boutique XP : PostgreSQL", () => {
  let db: import("@prisma/client").PrismaClient;
  let shop: typeof import("./xp-shop");
  let userId: string;
  let communityId: string;

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    db = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
    shop = await import("./xp-shop");
  });
  afterAll(async () => { await db?.$disconnect(); });
  beforeEach(async () => {
    process.env.COMMUNITY_ISOLATION_ENABLED = "true";
    await db.$executeRawUnsafe(`TRUNCATE "CommunityMemberCosmetic", "XpEvent", "CommunityMemberStats", "Membership", "User", "Community" CASCADE`);
    const community = await db.community.create({ data: { slug: "shop", name: "Shop", status: "ACTIVE" } });
    communityId = community.id;
    const user = await db.user.create({ data: { discordId: "shopper", discordName: "Shopper" } });
    userId = user.id;
    await db.membership.create({ data: { communityId, userId, status: "ACTIVE" } });
    await db.communityMemberStats.create({ data: { communityId, userId, xpTotal: 2_000 } });
  });

  it("débite une seule fois deux achats concurrents, puis équipe uniquement un objet possédé", async () => {
    const results = await Promise.all([
      shop.buyShopItem(userId, communityId, "title-strategist"),
      shop.buyShopItem(userId, communityId, "title-strategist"),
    ]);
    expect(results.sort()).toEqual(["owned", "purchased"]);
    expect((await db.communityMemberStats.findUniqueOrThrow({ where: { communityId_userId: { communityId, userId } } })).xpTotal).toBe(1_750);
    await shop.buyShopItem(userId, communityId, "frame-nebula");
    await shop.buyShopItem(userId, communityId, "color-mint");
    expect(await db.xpEvent.aggregate({ where: { userId, reason: "SHOP_PURCHASE" }, _sum: { amount: true } })).toMatchObject({ _sum: { amount: -750 } });
    expect(await shop.equipShopItem(userId, communityId, "TITLE", "title-strategist")).toBe("equipped");
    expect(await shop.equipShopItem(userId, communityId, "FRAME", "frame-nebula")).toBe("equipped");
    expect(await shop.equipShopItem(userId, communityId, "COLOR", "color-mint")).toBe("equipped");
    expect(await shop.equipShopItem(userId, communityId, "FRAME", "frame-solar")).toBe("not_owned");
    expect((await shop.getShopState(userId, communityId)).equipped).toEqual({
      TITLE: "title-strategist",
      FRAME: "frame-nebula",
      COLOR: "color-mint",
    });
  });

  it("refuse un achat trop cher sans changer le solde ni créer d'inventaire", async () => {
    await db.communityMemberStats.update({ where: { communityId_userId: { communityId, userId } }, data: { xpTotal: 100 } });
    expect(await shop.buyShopItem(userId, communityId, "title-strategist")).toBe("insufficient");
    expect((await db.communityMemberStats.findUniqueOrThrow({ where: { communityId_userId: { communityId, userId } } })).xpTotal).toBe(100);
    expect(await db.communityMemberCosmetic.count({ where: { communityId, userId } })).toBe(0);
    expect(await db.xpEvent.count({ where: { communityId, userId, reason: "SHOP_PURCHASE" } })).toBe(0);
  });

  it("refuse de dépenser le solde d'une autre communauté", async () => {
    const other = await db.community.create({ data: { slug: "other-shop", name: "Other Shop", status: "ACTIVE" } });
    expect(await shop.buyShopItem(userId, other.id, "title-strategist")).toBe("unavailable");
    expect(await db.communityMemberCosmetic.count()).toBe(0);
  });
});
