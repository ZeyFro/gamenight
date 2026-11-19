import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(), communityId: vi.fn(), propose: vi.fn(), decide: vi.fn(), rateLimit: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/tower-challenge-proposals", () => ({
  getTowerProposalsCommunityId: mocks.communityId, proposeTowerChallenge: mocks.propose, decideTowerProposal: mocks.decide,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));

import { decideTowerProposalAction, proposeTowerChallengeAction } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe("actions de proposition de défi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "player" });
    mocks.communityId.mockResolvedValue("community-1");
    mocks.rateLimit.mockReturnValue(true);
    mocks.propose.mockResolvedValue({ status: "SUBMITTED" });
    mocks.decide.mockResolvedValue({ status: "APPROVED" });
  });

  it("refuse un visiteur et une communauté sans la fonctionnalité, sans rien écrire", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(proposeTowerChallengeAction(form({ title: "t" }))).rejects.toThrow("REDIRECT:/");
    mocks.getCurrentUser.mockResolvedValue({ id: "player" });
    mocks.communityId.mockResolvedValue(null);
    await expect(proposeTowerChallengeAction(form({ title: "t" }))).rejects.toThrow("result=UNAVAILABLE");
    await expect(decideTowerProposalAction(form({ proposalId: "p", decision: "approve" }))).rejects.toThrow("result=UNAVAILABLE");
    expect(mocks.propose).not.toHaveBeenCalled();
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("transmet le contenu avec la communauté de la session, pas celle du formulaire", async () => {
    await expect(proposeTowerChallengeAction(form({ communityId: "foreign", title: "T", instructions: "I", rewardFloors: "3" }))).rejects.toThrow("result=SUBMITTED");
    expect(mocks.propose).toHaveBeenCalledWith({ communityId: "community-1", userId: "player", content: { title: "T", instructions: "I", rewardFloors: 3 } });
  });

  it("transmet la décision du staff (approuver ou refuser) avec note facultative", async () => {
    await expect(decideTowerProposalAction(form({ proposalId: "p", decision: "approve" }))).rejects.toThrow("result=APPROVED");
    expect(mocks.decide).toHaveBeenLastCalledWith({ communityId: "community-1", userId: "player", decision: { proposalId: "p", approve: true, note: undefined } });
    mocks.decide.mockResolvedValue({ status: "REJECTED" });
    await expect(decideTowerProposalAction(form({ proposalId: "p", decision: "reject", note: "Doublon" }))).rejects.toThrow("result=REJECTED");
    expect(mocks.decide).toHaveBeenLastCalledWith({ communityId: "community-1", userId: "player", decision: { proposalId: "p", approve: false, note: "Doublon" } });
  });

  it("applique la limite de débit", async () => {
    mocks.rateLimit.mockReturnValue(false);
    await expect(proposeTowerChallengeAction(form({ title: "t" }))).rejects.toThrow("result=RATE");
    expect(mocks.propose).not.toHaveBeenCalled();
  });
});
