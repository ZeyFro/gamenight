import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getCommunityId: vi.fn(),
  save: vi.fn(),
  rateLimit: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/community-teams", () => ({
  getCommunityTeamsCommunityId: vi.fn(), createCommunityTeam: vi.fn(), joinCommunityTeam: vi.fn(), leaveCommunityTeam: vi.fn(),
  setCommunityTeamRecruitment: vi.fn(), transferCommunityTeamCaptain: vi.fn(), dissolveCommunityTeam: vi.fn(),
}));
vi.mock("@/lib/team-recruitment-criteria", () => ({
  getTeamRecruitmentCriteriaCommunityId: mocks.getCommunityId,
  saveTeamRecruitmentCriteria: mocks.save,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));

import { saveTeamRecruitmentCriteriaAction } from "./actions";

const form = (entries: [string, string][]) => {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
};

describe("action des critères de recrutement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "captain-1" });
    mocks.getCommunityId.mockResolvedValue("community-1");
    mocks.rateLimit.mockReturnValue(true);
    mocks.save.mockResolvedValue("saved");
  });

  it("refuse un visiteur et une communauté sans le drapeau, sans rien écrire", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(saveTeamRecruitmentCriteriaAction(form([["teamId", "t"]]))).rejects.toThrow("REDIRECT:/");
    mocks.getCurrentUser.mockResolvedValue({ id: "captain-1" });
    mocks.getCommunityId.mockResolvedValue(null);
    await expect(saveTeamRecruitmentCriteriaAction(form([["teamId", "t"]]))).rejects.toThrow("result=unavailable");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("utilise la communauté active et ignore un identifiant de communauté forgé", async () => {
    await expect(saveTeamRecruitmentCriteriaAction(form([["communityId", "foreign"], ["teamId", "team-1"], ["goals", "DETENTE"], ["mic", "REQUIRED"]])))
      .rejects.toThrow("/equipes/gestion?result=saved");
    expect(mocks.save).toHaveBeenCalledWith("captain-1", "community-1", expect.objectContaining({ teamId: "team-1", goals: ["DETENTE"], mic: "REQUIRED" }));
    expect(mocks.save.mock.calls[0][2]).not.toHaveProperty("communityId");
  });

  it("refuse une valeur hors énumération avant tout accès aux données", async () => {
    await expect(saveTeamRecruitmentCriteriaAction(form([["teamId", "team-1"], ["goals", "ADMIN"]]))).rejects.toThrow("result=invalid");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("applique la limite de débit", async () => {
    mocks.rateLimit.mockReturnValue(false);
    await expect(saveTeamRecruitmentCriteriaAction(form([["teamId", "team-1"]]))).rejects.toThrow("result=rate");
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("relaie le refus d'un non-capitaine", async () => {
    mocks.save.mockResolvedValue("forbidden");
    await expect(saveTeamRecruitmentCriteriaAction(form([["teamId", "team-1"]]))).rejects.toThrow("result=forbidden");
  });
});
