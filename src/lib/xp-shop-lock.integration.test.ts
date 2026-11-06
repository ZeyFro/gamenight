import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Boutique sous verrou externe : l'achat n'ouvre jamais de seconde connexion (le client global est limité à UNE connexion :
// s'il était utilisé pendant la transaction, il attendrait la connexion déjà prise par `tx` et échouerait en P2024) et
// échoue de façon explicite (lock_timeout PostgreSQL), sans écriture, quand une autre session garde la ligne de stats verrouillée.
// Le délai de transaction de Prisma seul ne suffit pas : il n'interrompt pas une requête en attente de verrou (constaté : l'erreur
// n'arrive qu'à la libération du verrou).
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const APP_NAME = `gn_shop_lock_${Date.now()}`;
vi.mock("@/lib/discord-level-up", () => ({ announceLevelUp: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} };
  const url = new URL(TEST_DATABASE_URL);
  if (url.hostname !== "127.0.0.1") throw new Error("Postgres local uniquement");
  url.searchParams.set("connection_limit", "1");
  url.searchParams.set("pool_timeout", "3");
  url.searchParams.set("application_name", APP_NAME);
  return { prisma: new PrismaClient({ datasourceUrl: url.toString() }) };
});

if (!TEST_DATABASE_URL) console.warn("[xp-shop-lock] TEST_DATABASE_URL absente : tests Postgres ignorés.");

describe.skipIf(!TEST_DATABASE_URL)("boutique XP : une seule connexion, verrou externe", () => {
  let db: import("@prisma/client").PrismaClient;
  let shop: typeof import("./xp-shop");
  let userId: string;
  let communityId: string;
  const statsKey = () => ({ communityId_userId: { communityId, userId } });

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    db = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
    shop = await import("./xp-shop");
  });
  afterAll(async () => { await db?.$disconnect(); });
  beforeEach(async () => {
    process.env.COMMUNITY_ISOLATION_ENABLED = "true";
    await db.$executeRawUnsafe(`TRUNCATE "CommunityMemberCosmetic", "XpEvent", "CommunityMemberStats", "Membership", "User", "Community" CASCADE`);
    communityId = (await db.community.create({ data: { slug: "shop-lock", name: "Shop lock", status: "ACTIVE" } })).id;
    userId = (await db.user.create({ data: { discordId: "shop-lock", discordName: "Lock" } })).id;
    await db.membership.create({ data: { communityId, userId, status: "ACTIVE" } });
    await db.communityMemberStats.create({ data: { communityId, userId, xpTotal: 1_000, xpBalance: 1_000 } });
    (await import("./default-community")).resetDefaultCommunityIdCache();
  });

  it("achat et équipement aboutissent avec UNE seule connexion : tout passe par `tx`, jamais par le client global", async () => {
    expect(await shop.buyShopItem(userId, communityId, "title-strategist")).toBe("purchased");
    expect(await shop.equipShopItem(userId, communityId, "TITLE", "title-strategist")).toBe("equipped");
    expect(await db.communityMemberStats.findUniqueOrThrow({ where: statsKey() })).toMatchObject({ xpTotal: 1_000, xpBalance: 750, equippedTitleId: "title-strategist" });
  });

  it("verrou externe sur la ligne de stats : statut « busy » après 8 s, une seule connexion applicative, aucune écriture", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const holder = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    let held!: () => void;
    const acquired = new Promise<void>((done) => { held = done; });
    const external = holder.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "userId" FROM "CommunityMemberStats" WHERE "communityId" = ${communityId} AND "userId" = ${userId} FOR UPDATE`;
      held();
      await gate;
    }, { timeout: 60_000 });
    await acquired;
    let failure: unknown;
    let outcome: unknown;
    let connections = -1;
    const started = Date.now();
    try {
      const purchase = shop.buyShopItem(userId, communityId, "frame-nebula").then((value: unknown) => { outcome = value; }, (error: unknown) => { failure = error; });
      await new Promise((resolve) => setTimeout(resolve, 3_000)); // l'achat attend désormais le verrou
      const [row] = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = ${APP_NAME}`;
      connections = row.n;
      await purchase;
    } finally {
      release();
      await external;
      await holder.$disconnect();
    }
    expect(connections).toBe(1);
    expect(failure, "le délai de verrou ne doit pas remonter en erreur 500").toBeUndefined();
    expect(outcome, "statut visible « busy » (rien débité)").toBe("busy");
    expect(Date.now() - started).toBeGreaterThanOrEqual(7_500);
    expect(Date.now() - started).toBeLessThan(15_000); // avant le délai de transaction : l'erreur vient de PostgreSQL, pas de l'expiration Prisma
    expect(await db.communityMemberStats.findUniqueOrThrow({ where: statsKey() })).toMatchObject({ xpTotal: 1_000, xpBalance: 1_000 });
    expect(await db.communityMemberCosmetic.count({ where: { communityId, userId } })).toBe(0);
    expect(await db.xpEvent.count({ where: { communityId, userId } })).toBe(0);
    expect(await shop.buyShopItem(userId, communityId, "frame-nebula")).toBe("purchased"); // le verrou levé, rien n'est resté bloqué
  }, 60_000);
});
