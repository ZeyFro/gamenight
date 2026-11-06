import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, stats } = vi.hoisted(() => {
  const stats = { xpTotal: 2_000, xpBalance: 1_000 };
  const db = {
    $transaction: vi.fn(), $queryRaw: vi.fn(), $executeRawUnsafe: vi.fn(),
    communityMemberStats: {
      createMany: vi.fn(), findUnique: vi.fn(async () => stats), findUniqueOrThrow: vi.fn(async () => stats),
      update: vi.fn(async ({ data }: { data: Record<string, { decrement: number }> }) => {
        for (const key of ["xpTotal", "xpBalance"] as const) if (data[key]) stats[key] -= data[key].decrement;
        return stats;
      }),
    },
    communityMemberCosmetic: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []), create: vi.fn() },
    xpEvent: { create: vi.fn() },
  };
  return { db, stats };
});
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/member-stats", () => ({ lockCommunityProgress: vi.fn(async () => true) }));
vi.mock("@/lib/community-scoped-client", () => ({ scopedPrismaForCommunityId: vi.fn(async () => db) }));
vi.mock("@/lib/community-stats", () => ({ writeCommunityIdForUser: vi.fn(async () => "community") }));

import { buyShopItem, equipShopItem, getShopState } from "./xp-shop";
import { levelForXp } from "./xp";

describe("boutique : solde distinct de la progression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(stats, { xpTotal: 2_000, xpBalance: 1_000 });
    db.$transaction.mockImplementation((callback) => callback(db));
  });

  it("affiche le solde dépensable", async () => {
    expect((await getShopState("user", "community")).balance).toBe(1_000);
  });

  it("achète sans perdre le niveau acquis", async () => {
    const level = levelForXp(stats.xpTotal);
    expect(await buyShopItem("user", "community", "title-strategist")).toBe("purchased");
    expect(stats).toEqual({ xpTotal: 2_000, xpBalance: 750 });
    expect(db.xpEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ reason: "SHOP_BALANCE_PURCHASE" }),
    }));
    expect(levelForXp(stats.xpTotal)).toBe(level);
  });

  it("refuse une dépense que seule la progression couvrirait", async () => {
    stats.xpBalance = 100;
    expect(await buyShopItem("user", "community", "title-strategist")).toBe("insufficient");
    expect(stats).toEqual({ xpTotal: 2_000, xpBalance: 100 });
    expect(db.xpEvent.create).not.toHaveBeenCalled();
  });

  it("laisse une marge de 15 s aux transactions sous charge (défaut Prisma : 5 s, 500 à l'expiration)", async () => {
    await buyShopItem("user", "community", "title-strategist");
    await equipShopItem("user", "community", "TITLE", null);
    expect(db.$transaction.mock.calls.map((call) => call[1])).toEqual([{ timeout: 15_000, maxWait: 10_000 }, { timeout: 15_000, maxWait: 10_000 }]);
  });

  it("borne l'attente de verrou en premier (lock_timeout 8 s, avant les 15 s de la transaction) pour l'achat et l'équipement", async () => {
    await buyShopItem("user", "community", "title-strategist");
    await equipShopItem("user", "community", "TITLE", null);
    expect(db.$executeRawUnsafe.mock.calls).toEqual([["SET LOCAL lock_timeout = 8000"], ["SET LOCAL lock_timeout = 8000"]]);
    expect(db.$executeRawUnsafe.mock.invocationCallOrder[0]).toBeLessThan(db.$queryRaw.mock.invocationCallOrder[0] ?? Infinity);
  });

  it("n'utilise que `tx` dans la transaction : jamais le client global (pas de seconde connexion)", async () => {
    const fresh = () => ({
      $executeRawUnsafe: vi.fn(), $queryRaw: vi.fn(),
      communityMemberStats: { createMany: vi.fn(), findUniqueOrThrow: vi.fn(async () => ({ xpBalance: 1_000 })), update: vi.fn() },
      communityMemberCosmetic: { findUnique: vi.fn(async () => null), create: vi.fn() },
      xpEvent: { create: vi.fn() },
    });
    const tx = fresh();
    db.$transaction.mockImplementation(async (callback) => callback(tx));
    expect(await buyShopItem("user", "community", "title-strategist")).toBe("purchased");
    expect(await equipShopItem("user", "community", "TITLE", "title-strategist")).toBe("not_owned");
    expect(tx.communityMemberStats.update).toHaveBeenCalledTimes(1);
    expect(tx.xpEvent.create).toHaveBeenCalledTimes(1);
    const global = db as unknown as ReturnType<typeof fresh>;
    for (const fn of [global.$executeRawUnsafe, global.$queryRaw, global.communityMemberStats.createMany, global.communityMemberStats.findUniqueOrThrow,
      global.communityMemberStats.update, global.communityMemberCosmetic.findUnique, global.communityMemberCosmetic.create, global.xpEvent.create]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});
