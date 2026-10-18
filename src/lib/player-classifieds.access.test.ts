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

import { getPlayerClassifiedCommunityId, listPlayerClassifieds } from "./player-classifieds";

describe("player classifieds access", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires an active community selection and membership, with the feature enabled", async () => {
    mocks.resolveActiveCommunityId.mockResolvedValue("community-1");
    mocks.findActiveMembership.mockResolvedValue({ community: { playerClassifiedsEnabled: true } });

    await expect(getPlayerClassifiedCommunityId("user-1")).resolves.toBe("community-1");

    mocks.findActiveMembership.mockResolvedValue({ community: { playerClassifiedsEnabled: false } });
    await expect(getPlayerClassifiedCommunityId("user-1")).resolves.toBeNull();
    mocks.resolveActiveCommunityId.mockResolvedValue(null);
    await expect(getPlayerClassifiedCommunityId("user-1")).resolves.toBeNull();
  });

  it("shows only current, non-expired ads whose authors remain active members", async () => {
    const scopedDb = { playerClassified: { findMany: mocks.findMany } };
    mocks.getScopedPrisma.mockResolvedValue(scopedDb);
    mocks.findMany.mockResolvedValue([]);
    const now = new Date("2026-10-17T10:00:00.000Z");

    await listPlayerClassifieds("user-1", "community-1", now);

    expect(mocks.getScopedPrisma).toHaveBeenCalledWith("user-1");
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        communityId: "community-1",
        expiresAt: { gt: now },
        createdBy: { memberships: { some: { communityId: "community-1", status: "ACTIVE" } } },
      }),
    }));
  });
});
