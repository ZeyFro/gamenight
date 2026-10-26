import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ membershipFindUnique: vi.fn(), resolveActiveCommunityId: vi.fn() }));
vi.mock("@/lib/community-isolation", () => ({ resolveActiveCommunityId: mocks.resolveActiveCommunityId }));
vi.mock("@/lib/community-scoped-client", () => ({ getScopedPrisma: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { membership: { findUnique: mocks.membershipFindUnique } } }));

import { getCommunityTeamsCommunityId } from "./community-teams";

describe("community teams access", () => {
  beforeEach(() => vi.clearAllMocks());

  it("only resolves an active community with membership and its feature enabled", async () => {
    mocks.resolveActiveCommunityId.mockResolvedValue("community-1");
    mocks.membershipFindUnique.mockResolvedValue({ status: "ACTIVE", community: { status: "ACTIVE", communityTeamsEnabled: true } });
    await expect(getCommunityTeamsCommunityId("user-1")).resolves.toBe("community-1");

    mocks.membershipFindUnique.mockResolvedValue({ status: "ACTIVE", community: { status: "ACTIVE", communityTeamsEnabled: false } });
    await expect(getCommunityTeamsCommunityId("user-1")).resolves.toBeNull();
    mocks.membershipFindUnique.mockResolvedValue(null);
    await expect(getCommunityTeamsCommunityId("user-1")).resolves.toBeNull();
    mocks.resolveActiveCommunityId.mockResolvedValue(null);
    await expect(getCommunityTeamsCommunityId("user-1")).resolves.toBeNull();
  });
});
