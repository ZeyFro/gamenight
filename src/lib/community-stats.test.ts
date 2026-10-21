import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDefaultCommunityId: vi.fn(async () => "community-default"),
  isCommunityIsolationEnabled: vi.fn(() => false),
  isMemberOfCommunity: vi.fn(),
  resolveActiveCommunityId: vi.fn(),
}));

vi.mock("@/lib/default-community", () => ({ getDefaultCommunityId: mocks.getDefaultCommunityId }));
vi.mock("@/lib/community-isolation", () => ({
  isCommunityIsolationEnabled: mocks.isCommunityIsolationEnabled,
  isMemberOfCommunity: mocks.isMemberOfCommunity,
  resolveActiveCommunityId: mocks.resolveActiveCommunityId,
}));

import { writeCommunityIdForUser } from "./community-stats";

describe("writeCommunityIdForUser", () => {
  afterEach(() => vi.resetAllMocks());

  it("isolation éteinte : aucun rattachement implicite à default sans adhésion active", async () => {
    mocks.isCommunityIsolationEnabled.mockReturnValue(false);
    mocks.isMemberOfCommunity.mockResolvedValue(false);
    mocks.resolveActiveCommunityId.mockResolvedValue(null);
    await expect(writeCommunityIdForUser("u-b-only")).resolves.toBeNull();
    expect(mocks.isMemberOfCommunity).toHaveBeenCalledWith("u-b-only", null);
  });

  it("isolation éteinte : B-only garde ses statistiques dans sa communauté active B", async () => {
    mocks.isCommunityIsolationEnabled.mockReturnValue(false);
    mocks.isMemberOfCommunity.mockResolvedValue(false);
    mocks.resolveActiveCommunityId.mockResolvedValue("community-b");
    await expect(writeCommunityIdForUser("u-b-only")).resolves.toBe("community-b");
  });

  it("isolation éteinte : conserve le rattachement historique pour un membre default", async () => {
    mocks.isCommunityIsolationEnabled.mockReturnValue(false);
    mocks.isMemberOfCommunity.mockResolvedValue(true);
    await expect(writeCommunityIdForUser("u-default")).resolves.toBe("community-default");
  });

  it("isolation allumée : choisit toujours une communauté active réellement membre", async () => {
    mocks.isCommunityIsolationEnabled.mockReturnValue(true);
    mocks.resolveActiveCommunityId.mockResolvedValue("community-b");
    await expect(writeCommunityIdForUser("u-b-only")).resolves.toBe("community-b");
    expect(mocks.isMemberOfCommunity).not.toHaveBeenCalled();
  });
});
