import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getCommunityTeamsCommunityId: vi.fn(),
  createCommunityTeam: vi.fn(),
  joinCommunityTeam: vi.fn(),
  leaveCommunityTeam: vi.fn(),
  setCommunityTeamRecruitment: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/community-teams", () => ({
  getCommunityTeamsCommunityId: mocks.getCommunityTeamsCommunityId,
  createCommunityTeam: mocks.createCommunityTeam,
  joinCommunityTeam: mocks.joinCommunityTeam,
  leaveCommunityTeam: mocks.leaveCommunityTeam,
  setCommunityTeamRecruitment: mocks.setCommunityTeamRecruitment,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));

import { createCommunityTeamAction, joinCommunityTeamAction } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe("community team actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "member-1" });
    mocks.getCommunityTeamsCommunityId.mockResolvedValue("community-1");
    mocks.createCommunityTeam.mockResolvedValue("created");
    mocks.joinCommunityTeam.mockResolvedValue("joined");
  });

  it("denies unauthenticated and disabled-community access", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(joinCommunityTeamAction(form({ teamId: "team-1" }))).rejects.toThrow("REDIRECT:/");
    mocks.getCurrentUser.mockResolvedValue({ id: "member-1" });
    mocks.getCommunityTeamsCommunityId.mockResolvedValue(null);
    await expect(joinCommunityTeamAction(form({ teamId: "team-1" }))).rejects.toThrow("REDIRECT:/equipes?result=unavailable");
    expect(mocks.joinCommunityTeam).not.toHaveBeenCalled();
  });

  it("uses the member's active community and ignores a forged community id", async () => {
    await expect(createCommunityTeamAction(form({
      communityId: "foreign-community",
      gameId: "game-1",
      name: "Expédition Valheim",
      description: "Construire une base et explorer ensemble.",
      platform: "PC",
      maxMembers: "6",
    }))).rejects.toThrow("REDIRECT:/equipes?result=created");
    expect(mocks.createCommunityTeam).toHaveBeenCalledWith(expect.objectContaining({ userId: "member-1", communityId: "community-1" }));
  });

  it("rejects malformed ids before invoking the join operation", async () => {
    await expect(joinCommunityTeamAction(form({ teamId: "" }))).rejects.toThrow("REDIRECT:/equipes?result=invalid");
    expect(mocks.joinCommunityTeam).not.toHaveBeenCalled();
  });
});
