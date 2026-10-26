import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findActiveMembership: vi.fn(), resolveActiveCommunityId: vi.fn() }));
vi.mock("@/lib/community-access", () => ({ findActiveMembership: mocks.findActiveMembership }));
vi.mock("@/lib/community-isolation", () => ({ resolveActiveCommunityId: mocks.resolveActiveCommunityId }));
vi.mock("@/lib/community-scoped-client", () => ({ getScopedPrisma: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { getCommunityTeamsCommunityId } from "./community-teams";

describe("community teams access", () => {
  beforeEach(() => vi.clearAllMocks());

  it("only resolves an active community with membership and its feature enabled", async () => {
    mocks.resolveActiveCommunityId.mockResolvedValue("community-1");
    mocks.findActiveMembership.mockResolvedValue({ community: { communityTeamsEnabled: true } });
    await expect(getCommunityTeamsCommunityId("user-1")).resolves.toBe("community-1");

    mocks.findActiveMembership.mockResolvedValue({ community: { communityTeamsEnabled: false } });
    await expect(getCommunityTeamsCommunityId("user-1")).resolves.toBeNull();
    mocks.resolveActiveCommunityId.mockResolvedValue(null);
    await expect(getCommunityTeamsCommunityId("user-1")).resolves.toBeNull();
  });
});
