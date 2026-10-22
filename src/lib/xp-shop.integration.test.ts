import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/discord-level-up", () => ({ announceLevelUp: vi.fn() }));
vi.mock("@/lib/community-announce", () => ({ postToCommunity: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (TEST_DATABASE_URL && new URL(TEST_DATABASE_URL).hostname !== "127.0.0.1") throw new Error("Postgres local uniquement");
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
    await db.communityMemberStats.create({ data: { communityId, userId, xpTotal: 2_000, xpBalance: 2_000 } });
    (await import("./default-community")).resetDefaultCommunityIdCache();
  });

  it("débite une seule fois deux achats concurrents, puis équipe uniquement un objet possédé", async () => {
    const results = await Promise.all([
      shop.buyShopItem(userId, communityId, "title-strategist"),
      shop.buyShopItem(userId, communityId, "title-strategist"),
    ]);
    expect(results.sort()).toEqual(["owned", "purchased"]);
    expect(await db.communityMemberStats.findUniqueOrThrow({ where: { communityId_userId: { communityId, userId } } })).toMatchObject({ xpTotal: 2_000, xpBalance: 1_750 });
    await shop.buyShopItem(userId, communityId, "frame-nebula");
    await shop.buyShopItem(userId, communityId, "color-mint");
    expect(await db.xpEvent.aggregate({ where: { userId, reason: "SHOP_BALANCE_PURCHASE" }, _sum: { amount: true } })).toMatchObject({ _sum: { amount: -750 } });
    expect(await shop.equipShopItem(userId, communityId, "TITLE", "title-strategist")).toBe("equipped");
    expect(await shop.equipShopItem(userId, communityId, "FRAME", "frame-nebula")).toBe("equipped");
    expect(await shop.equipShopItem(userId, communityId, "COLOR", "color-mint")).toBe("equipped");
    expect(await shop.equipShopItem(userId, communityId, "FRAME", "frame-solar")).toBe("not_owned");
    expect((await shop.getShopState(userId, communityId)).equipped).toEqual({
      TITLE: "title-strategist",
      FRAME: "frame-nebula",
      COLOR: "color-mint",
    });
    expect(await shop.equipShopItem(userId, communityId, "TITLE", null)).toBe("equipped");
    expect(await db.communityMemberStats.findUniqueOrThrow({ where: { communityId_userId: { communityId, userId } } })).toMatchObject({ xpTotal: 2_000, xpBalance: 1_250, equippedTitleId: null });
  });

  it("refuse un achat trop cher sans changer le solde ni créer d'inventaire", async () => {
    await db.communityMemberStats.update({ where: { communityId_userId: { communityId, userId } }, data: { xpBalance: 100 } });
    expect(await shop.buyShopItem(userId, communityId, "title-strategist")).toBe("insufficient");
    expect(await db.communityMemberStats.findUniqueOrThrow({ where: { communityId_userId: { communityId, userId } } })).toMatchObject({ xpTotal: 2_000, xpBalance: 100 });
    expect(await db.communityMemberCosmetic.count({ where: { communityId, userId } })).toBe(0);
    expect(await db.xpEvent.count({ where: { communityId, userId, reason: "SHOP_BALANCE_PURCHASE" } })).toBe(0);
  });

  it("refuse de dépenser le solde d'une autre communauté", async () => {
    const other = await db.community.create({ data: { slug: "other-shop", name: "Other Shop", status: "ACTIVE" } });
    expect(await shop.buyShopItem(userId, other.id, "title-strategist")).toBe("unavailable");
    expect(await db.communityMemberCosmetic.count()).toBe(0);
  });

  it("refuse achat et équipement quand la communauté est suspendue", async () => {
    await shop.buyShopItem(userId, communityId, "title-strategist");
    await db.community.update({ where: { id: communityId }, data: { status: "SUSPENDED" } });
    expect(await shop.buyShopItem(userId, communityId, "frame-nebula")).toBe("unavailable");
    expect(await shop.equipShopItem(userId, communityId, "TITLE", "title-strategist")).toBe("unavailable");
    expect(await stats()).toMatchObject({ xpTotal: 2_000, xpBalance: 1_750, equippedTitleId: null });
  });

  const stats = () => db.communityMemberStats.findUniqueOrThrow({ where: { communityId_userId: { communityId, userId } } });

  it("deux achats différents concurrents ne peuvent pas dépenser deux fois le même solde", async () => {
    await db.communityMemberStats.update({ where: { communityId_userId: { communityId, userId } }, data: { xpBalance: 400 } });
    const results = await Promise.all([
      shop.buyShopItem(userId, communityId, "title-strategist"),
      shop.buyShopItem(userId, communityId, "frame-nebula"),
    ]);
    expect(results.sort()).toEqual(["insufficient", "purchased"]);
    expect([100, 150]).toContain((await stats()).xpBalance);
    expect((await stats()).xpTotal).toBe(2_000);
    expect(await db.communityMemberCosmetic.count()).toBe(1);
  });

  it("gain et achat simultanés conservent le crédit des deux compteurs", async () => {
    const { awardXp } = await import("./xp-actions");
    await Promise.all([
      awardXp(userId, communityId, "VOTE", "vote-concurrent", 100, { applyStreak: false }),
      shop.buyShopItem(userId, communityId, "title-strategist"),
    ]);
    expect(await stats()).toMatchObject({ xpTotal: 2_100, xpBalance: 1_850 });
    expect(await awardXp(userId, communityId, "VOTE", "vote-concurrent", 100)).toMatchObject({ awarded: false });
    expect(await stats()).toMatchObject({ xpTotal: 2_100, xpBalance: 1_850 });
  });

  it("les backfills Steam et badges créditent les deux compteurs sans doublon", async () => {
    const defaultId = await (await import("./default-community")).getDefaultCommunityId();
    await db.membership.create({ data: { userId, communityId: defaultId, status: "ACTIVE" } });
    await db.user.update({ where: { id: userId }, data: { steamId64: "76561197960287930" } });
    await db.badge.create({ data: { name: "Départ", icon: "B", description: "Présence", category: "ENGAGEMENT", rarity: "COMMON", modifiedById: userId, criteria: { type: "STREAK_DAYS", count: 0 }, xpReward: 10 } });
    const { backfillXp } = await import("./backfill-xp");
    const { backfillBadges } = await import("./backfill-badges");
    for (let attempt = 0; attempt < 2; attempt++) { await backfillXp(); await backfillBadges(); }
    const { XP_AMOUNTS } = await import("./xp");
    const expected = XP_AMOUNTS.STEAM_LINK_FIRST + 10;
    expect(await db.communityMemberStats.findUniqueOrThrow({ where: { communityId_userId: { communityId: defaultId, userId } } })).toMatchObject({ xpTotal: expected, xpBalance: expected });
    expect(await db.xpEvent.count({ where: { communityId: defaultId, userId } })).toBe(2);
    expect(await stats()).toMatchObject({ xpTotal: 2_000, xpBalance: 2_000 });
  });

  it("les classements global et par période conservent la progression après achat", async () => {
    await db.xpEvent.create({ data: { communityId, userId, reason: "VOTE", sourceId: "initial", amount: 2_000 } });
    await shop.buyShopItem(userId, communityId, "title-strategist");
    const { getScoreboard } = await import("./scoreboard");
    for (const period of ["global", "week", "month"] as const) {
      expect((await getScoreboard(period, { communityId })).find((entry) => entry.userId === userId)).toMatchObject({ periodXp: 2_000, level: 7 });
    }
  });

  it("la pénalité garde son montant de progression et plafonne le solde sans dette", async () => {
    await db.communityMemberStats.update({ where: { communityId_userId: { communityId, userId } }, data: { xpBalance: 2 } });
    const { applySessionAbsencePenalty } = await import("./xp-actions");
    expect(await applySessionAbsencePenalty(userId, communityId, "absent", 10)).toBe(true);
    expect(await stats()).toMatchObject({ xpTotal: 1_990, xpBalance: 0 });
    expect(await applySessionAbsencePenalty(userId, communityId, "absent", 10)).toBe(false);
    expect(await stats()).toMatchObject({ xpTotal: 1_990, xpBalance: 0 });
  });

  it("les paris utilisent le solde, tout en conservant leur effet historique sur la progression", async () => {
    await db.communityMemberStats.update({ where: { communityId_userId: { communityId, userId } }, data: { xpBalance: 100 } });
    const session = await db.session.create({ data: { communityId, createdById: userId, date: new Date(), status: "SCHEDULED" } });
    const { placeBet } = await import("./xp-bets");
    expect(await placeBet(session.id, userId, userId, 60)).toBe(false);
    expect(await stats()).toMatchObject({ xpTotal: 2_000, xpBalance: 100 });
    expect(await placeBet(session.id, userId, userId, 50)).toBe(true);
    expect(await stats()).toMatchObject({ xpTotal: 1_950, xpBalance: 50 });
  });

  it("le reset photographie la progression puis remet les deux compteurs à zéro en gardant les objets", async () => {
    await shop.buyShopItem(userId, communityId, "title-strategist");
    await shop.equipShopItem(userId, communityId, "TITLE", "title-strategist");
    const seasons = await import("./seasons");
    await seasons.ensureActiveSeasonExists(communityId);
    await db.season.updateMany({ where: { communityId }, data: { endDate: new Date(0) } });
    await seasons.finalizeSeasonIfDue();
    expect(await db.seasonSnapshot.findFirstOrThrow({ where: { userId } })).toMatchObject({ xp: 2_000, level: 7 });
    expect(await stats()).toMatchObject({ xpTotal: 0, xpBalance: 0, equippedTitleId: "title-strategist" });
    expect((await shop.getShopState(userId, communityId)).ownedIds.has("title-strategist")).toBe(true);
  });
});
