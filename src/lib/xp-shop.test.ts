import { beforeEach, describe, expect, it, vi } from "vitest";

const { db, stats } = vi.hoisted(() => {
  const stats = { xpTotal: 2_000, xpBalance: 1_000 };
  const db = {
    $transaction: vi.fn(), $queryRaw: vi.fn(),
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

import { buyShopItem, getShopState } from "./xp-shop";
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
    expect(levelForXp(stats.xpTotal)).toBe(level);
  });

  it("refuse une dépense que seule la progression couvrirait", async () => {
    stats.xpBalance = 100;
    expect(await buyShopItem("user", "community", "title-strategist")).toBe("insufficient");
    expect(stats).toEqual({ xpTotal: 2_000, xpBalance: 100 });
    expect(db.xpEvent.create).not.toHaveBeenCalled();
  });
});
