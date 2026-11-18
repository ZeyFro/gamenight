import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getTeamApplicationsCommunityId: vi.fn(),
  applyToTeam: vi.fn(),
  withdrawTeamApplication: vi.fn(),
  decideTeamApplication: vi.fn(),
  rateLimit: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/team-applications", () => ({
  getTeamApplicationsCommunityId: mocks.getTeamApplicationsCommunityId,
  applyToTeam: mocks.applyToTeam,
  withdrawTeamApplication: mocks.withdrawTeamApplication,
  decideTeamApplication: mocks.decideTeamApplication,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));

import { applyToTeamAction, decideTeamApplicationAction, withdrawTeamApplicationAction } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe("actions de candidature d'équipe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "member-1" });
    mocks.getTeamApplicationsCommunityId.mockResolvedValue("community-1");
    mocks.rateLimit.mockReturnValue(true);
    mocks.applyToTeam.mockResolvedValue("applied");
    mocks.withdrawTeamApplication.mockResolvedValue("withdrawn");
    mocks.decideTeamApplication.mockResolvedValue("accepted");
  });

  it("refuse un visiteur et une communauté sans candidatures, sans rien écrire", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(applyToTeamAction(form({ teamId: "t", message: "Salut" }))).rejects.toThrow("REDIRECT:/");
    mocks.getCurrentUser.mockResolvedValue({ id: "member-1" });
    mocks.getTeamApplicationsCommunityId.mockResolvedValue(null);
    await expect(applyToTeamAction(form({ teamId: "t", message: "Salut" }))).rejects.toThrow("REDIRECT:/equipes/candidatures?result=unavailable");
    await expect(decideTeamApplicationAction(form({ applicationId: "a", decision: "accept" }))).rejects.toThrow("result=unavailable");
    expect(mocks.applyToTeam).not.toHaveBeenCalled();
    expect(mocks.decideTeamApplication).not.toHaveBeenCalled();
  });

  it("utilise la communauté active du membre et ignore un identifiant de communauté forgé", async () => {
    await expect(applyToTeamAction(form({ communityId: "foreign", teamId: "team-1", message: "  Salut  " }))).rejects.toThrow("result=applied");
    expect(mocks.applyToTeam).toHaveBeenCalledWith("member-1", "community-1", { teamId: "team-1", message: "Salut" });
  });

  it("refuse un message vide ou trop long avant tout accès aux données", async () => {
    await expect(applyToTeamAction(form({ teamId: "team-1", message: "   " }))).rejects.toThrow("result=invalid");
    await expect(applyToTeamAction(form({ teamId: "team-1", message: "x".repeat(501) }))).rejects.toThrow("result=invalid");
    expect(mocks.applyToTeam).not.toHaveBeenCalled();
  });

  it("n'accepte que les décisions accept ou decline", async () => {
    await expect(decideTeamApplicationAction(form({ applicationId: "a", decision: "delete" }))).rejects.toThrow("result=invalid");
    await expect(decideTeamApplicationAction(form({ applicationId: "a", decision: "accept" }))).rejects.toThrow("result=accepted");
    await expect(decideTeamApplicationAction(form({ applicationId: "a", decision: "decline" }))).rejects.toThrow("result=accepted");
    expect(mocks.decideTeamApplication).toHaveBeenNthCalledWith(1, "member-1", "community-1", "a", true);
    expect(mocks.decideTeamApplication).toHaveBeenNthCalledWith(2, "member-1", "community-1", "a", false);
  });

  it("retire une candidature de l'utilisateur courant seulement", async () => {
    await expect(withdrawTeamApplicationAction(form({ applicationId: "app-1" }))).rejects.toThrow("result=withdrawn");
    expect(mocks.withdrawTeamApplication).toHaveBeenCalledWith("member-1", "community-1", "app-1");
    await expect(withdrawTeamApplicationAction(form({}))).rejects.toThrow("result=invalid");
  });

  it("respecte la limite de débit", async () => {
    mocks.rateLimit.mockReturnValue(false);
    await expect(applyToTeamAction(form({ teamId: "team-1", message: "Salut" }))).rejects.toThrow("result=rate");
    expect(mocks.applyToTeam).not.toHaveBeenCalled();
  });
});
