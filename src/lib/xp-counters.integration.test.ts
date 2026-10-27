import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Contrat des deux compteurs : xpTotal = progression (niveau, grade, classements), xpBalance = solde dépensable.
// Complète xp-shop / admin-xp / community-progression : une assertion sur les DEUX compteurs par chemin d'écriture.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/discord-level-up", () => ({ announceLevelUp: vi.fn() }));
vi.mock("@/lib/community-announce", () => ({ postToCommunity: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (TEST_DATABASE_URL && new URL(TEST_DATABASE_URL).hostname !== "127.0.0.1") throw new Error("Postgres local uniquement");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
if (!TEST_DATABASE_URL) console.warn("[xp-counters] TEST_DATABASE_URL absente : tests Postgres SKIPPÉS.");

describe.skipIf(!TEST_DATABASE_URL)("compteurs XP : progression et solde, PostgreSQL", () => {
  let db: import("@prisma/client").PrismaClient;
  let shop: typeof import("./xp-shop");
  let xp: typeof import("./xp-actions");
  let userId: string;
  let communityId: string;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma;
    shop = await import("./xp-shop");
    xp = await import("./xp-actions");
  });
  afterAll(async () => { await db?.$disconnect(); });
  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    await db.$executeRawUnsafe(`TRUNCATE "CommunityMemberCosmetic", "XpEvent", "LevelUpEvent", "XpBet", "CommunityMemberStats", "Membership", "User", "Community" CASCADE`);
    communityId = (await db.community.create({ data: { slug: "counters", name: "Counters", status: "ACTIVE" } })).id;
    userId = (await db.user.create({ data: { discordId: "counters", discordName: "Counters" } })).id;
    await db.membership.create({ data: { communityId, userId, status: "ACTIVE" } });
    (await import("./default-community")).resetDefaultCommunityIdCache();
  });
  const seed = (xpTotal: number, xpBalance: number) => db.communityMemberStats.create({ data: { communityId, userId, xpTotal, xpBalance } });
  const stats = () => db.communityMemberStats.findUniqueOrThrow({ where: { communityId_userId: { communityId, userId } } });

  it("awardXp crédite progression et solde du même montant", async () => {
    await seed(100, 40);
    expect(await xp.awardXp(userId, communityId, "VOTE", "v1", 5, { applyStreak: false })).toMatchObject({ awarded: true });
    expect(await stats()).toMatchObject({ xpTotal: 105, xpBalance: 45 });
  });

  it("un pari gagné crédite deux fois la mise sur les deux compteurs, la mise ayant déjà débité les deux", async () => {
    await seed(1_000, 1_000);
    const session = await db.session.create({ data: { communityId, createdById: userId, date: new Date(), status: "SCHEDULED" } });
    const { placeBet, resolveBets } = await import("./xp-bets");
    expect(await placeBet(session.id, userId, userId, 100)).toBe(true);
    expect(await stats()).toMatchObject({ xpTotal: 900, xpBalance: 900 });
    await resolveBets(session.id, new Set([userId]));
    expect(await stats()).toMatchObject({ xpTotal: 1_100, xpBalance: 1_100 });
  });

  it("un pari perdu ne rend rien : les deux compteurs restent débités", async () => {
    await seed(1_000, 300);
    const session = await db.session.create({ data: { communityId, createdById: userId, date: new Date(), status: "SCHEDULED" } });
    const { placeBet, resolveBets } = await import("./xp-bets");
    expect(await placeBet(session.id, userId, userId, 150)).toBe(true);
    await resolveBets(session.id, new Set());
    expect(await stats()).toMatchObject({ xpTotal: 850, xpBalance: 150 });
  });

  it("solde exactement égal au prix : achat accepté et solde à 0 ; un point de moins : refusé sans effet", async () => {
    await seed(2_000, 249);
    expect(await shop.buyShopItem(userId, communityId, "title-strategist")).toBe("insufficient");
    expect(await stats()).toMatchObject({ xpTotal: 2_000, xpBalance: 249 });
    await db.communityMemberStats.update({ where: { communityId_userId: { communityId, userId } }, data: { xpBalance: 250 } });
    expect(await shop.buyShopItem(userId, communityId, "title-strategist")).toBe("purchased");
    expect(await stats()).toMatchObject({ xpTotal: 2_000, xpBalance: 0 });
    expect(await shop.buyShopItem(userId, communityId, "color-mint")).toBe("insufficient");
    expect(await stats()).toMatchObject({ xpTotal: 2_000, xpBalance: 0 });
  });

  it("l'équipement et le retrait ne touchent aucun compteur et n'écrivent aucun événement", async () => {
    await seed(2_000, 500);
    await shop.buyShopItem(userId, communityId, "color-mint");
    const events = await db.xpEvent.count();
    expect(await shop.equipShopItem(userId, communityId, "COLOR", "color-mint")).toBe("equipped");
    expect(await shop.equipShopItem(userId, communityId, "COLOR", null)).toBe("equipped");
    expect(await stats()).toMatchObject({ xpTotal: 2_000, xpBalance: 300 });
    expect(await db.xpEvent.count()).toBe(events);
  });

  it("pénalité d'absence : plafonnée à la progression, solde jamais négatif, jamais de dette", async () => {
    await seed(3, 100);
    expect(await xp.applySessionAbsencePenalty(userId, communityId, "s1", 10)).toBe(true);
    expect(await stats()).toMatchObject({ xpTotal: 0, xpBalance: 97 });
    expect(await db.xpEvent.findFirstOrThrow({ where: { reason: "SESSION_ABSENCE" } })).toMatchObject({ amount: -3 });
    expect(await xp.applySessionAbsencePenalty(userId, communityId, "s2", 10)).toBe(false);
    expect(await stats()).toMatchObject({ xpTotal: 0, xpBalance: 97 });
  });

  it("le niveau et le grade suivent xpTotal aux seuils, même solde dépensé à zéro", async () => {
    // Niveau 11 (grade Argent) à 5 000 XP de progression : 50 × 10².
    await seed(4_999, 4_999);
    await db.communityMemberStats.update({ where: { communityId_userId: { communityId, userId } }, data: { xpBalance: 250 } });
    expect(await shop.buyShopItem(userId, communityId, "title-strategist")).toBe("purchased");
    expect(await stats()).toMatchObject({ xpTotal: 4_999, xpBalance: 0 });
    expect(await xp.awardXp(userId, communityId, "VOTE", "seuil-10", 1, { applyStreak: false })).toEqual({ awarded: true, leveledUp: true });
    expect(await stats()).toMatchObject({ xpTotal: 5_000, xpBalance: 1 });
    expect(await db.levelUpEvent.findMany({ select: { level: true } })).toEqual([{ level: 11 }]);
  });

  it("l'ancien achat SHOP_PURCHASE reste dans la progression par période, le nouvel achat en est exclu", async () => {
    await seed(400, 400);
    await db.xpEvent.createMany({ data: [
      { communityId, userId, reason: "PARTICIPATE", amount: 500, sourceId: "gain" },
      { communityId, userId, reason: "SHOP_PURCHASE", amount: -100, sourceId: "title-strategist" },
    ] });
    const { getScoreboard } = await import("./scoreboard");
    const weekXp = async () => (await getScoreboard("week", { communityId })).find((entry) => entry.userId === userId)?.periodXp;
    expect(await weekXp()).toBe(400);
    expect(await shop.buyShopItem(userId, communityId, "color-mint")).toBe("purchased");
    expect(await weekXp()).toBe(400);
    expect(await stats()).toMatchObject({ xpTotal: 400, xpBalance: 200 });
  });
});
