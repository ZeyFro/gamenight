import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findActiveMembership: vi.fn(),
  resolveActiveCommunityId: vi.fn(),
  getScopedPrisma: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/community-access", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/lib/community-isolation", () => ({ resolveActiveCommunityId: mocks.resolveActiveCommunityId }));
vi.mock("@/lib/community-scoped-client", () => ({ getScopedPrisma: mocks.getScopedPrisma }));

import { getFreeGamesCommunityId, listCurrentFreeGameOffers } from "./free-game-offers";

describe("free game offer access", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires an active member of a community where the feature is enabled", async () => {
    mocks.resolveActiveCommunityId.mockResolvedValue("community-1");
    mocks.findActiveMembership.mockResolvedValue({ community: { freeGamesEnabled: true } });
    await expect(getFreeGamesCommunityId("user-1")).resolves.toBe("community-1");

    mocks.findActiveMembership.mockResolvedValue({ community: { freeGamesEnabled: false } });
    await expect(getFreeGamesCommunityId("user-1")).resolves.toBeNull();
    mocks.resolveActiveCommunityId.mockResolvedValue(null);
    await expect(getFreeGamesCommunityId("user-1")).resolves.toBeNull();
  });

  it("only lists offers currently valid for the active community", async () => {
    mocks.getScopedPrisma.mockResolvedValue({ freeGameOffer: { findMany: mocks.findMany } });
    mocks.findMany.mockResolvedValue([]);
    const now = new Date("2026-10-17T10:00:00.000Z");
    await listCurrentFreeGameOffers("user-1", "community-1", now);

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { communityId: "community-1", startsAt: { lte: now }, endsAt: { gt: now } },
    }));
  });
});
