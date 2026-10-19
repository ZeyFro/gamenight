import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findActiveMembership: vi.fn(),
  resolveActiveCommunityId: vi.fn(),
  getScopedPrisma: vi.fn(),
  findMany: vi.fn(),
  listAutomaticFreeGameOffers: vi.fn(),
}));

vi.mock("@/lib/community-access", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/lib/community-isolation", () => ({ resolveActiveCommunityId: mocks.resolveActiveCommunityId }));
vi.mock("@/lib/community-scoped-client", () => ({ getScopedPrisma: mocks.getScopedPrisma }));
vi.mock("@/lib/gamerpower-free-games", () => ({ listAutomaticFreeGameOffers: mocks.listAutomaticFreeGameOffers }));

import { getFreeGamesCommunityId, listCurrentFreeGameOffers } from "./free-game-offers";

describe("free game offer access", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("FREE_GAME_FEED_ENABLED", "false"); });

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

  it("garde le manuel prioritaire et retire les doublons du flux optionnel", async () => {
    const now = new Date("2026-10-17T10:00:00.000Z");
    const manual = { id: "manual-1", store: "STEAM", title: "Sélection admin", storeUrl: "https://store.steampowered.com/app/620/?l=french", endsAt: new Date("2026-10-18T10:00:00Z") };
    mocks.getScopedPrisma.mockResolvedValue({ freeGameOffer: { findMany: mocks.findMany } });
    mocks.findMany.mockResolvedValue([manual]);
    mocks.listAutomaticFreeGameOffers.mockResolvedValue([
      { id: "gamerpower-steam-620", store: "STEAM", title: "Portal", storeUrl: "https://store.steampowered.com/app/620/Portal/?l=french&cc=fr", endsAt: null, source: "gamerpower" },
      { id: "gamerpower-epic-foo", store: "EPIC", title: "Other", storeUrl: "https://store.epicgames.com/fr/p/foo", endsAt: null, source: "gamerpower" },
      { id: "gamerpower-epic-foo-copy", store: "EPIC", title: "Other copy", storeUrl: "https://store.epicgames.com/fr/p/foo?lang=fr", endsAt: null, source: "gamerpower" },
    ]);

    vi.stubEnv("FREE_GAME_FEED_ENABLED", "true");
    const offers = await listCurrentFreeGameOffers("user-1", "community-1", now);
    expect(offers.map(({ id, source }) => [id, source])).toEqual([["manual-1", "admin"], ["gamerpower-epic-foo", "gamerpower"]]);
    expect(mocks.listAutomaticFreeGameOffers).toHaveBeenCalledOnce();
  });
});
