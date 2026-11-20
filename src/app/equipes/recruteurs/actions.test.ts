import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getTeamRecruitersCommunityId: vi.fn(),
  addTeamRecruiter: vi.fn(),
  removeTeamRecruiter: vi.fn(),
  inviteTeamGuest: vi.fn(),
  revokeTeamGuest: vi.fn(),
  respondToTeamGuestInvitation: vi.fn(),
  rateLimit: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/team-recruiters", () => ({
  getTeamRecruitersCommunityId: mocks.getTeamRecruitersCommunityId,
  addTeamRecruiter: mocks.addTeamRecruiter,
  removeTeamRecruiter: mocks.removeTeamRecruiter,
  inviteTeamGuest: mocks.inviteTeamGuest,
  revokeTeamGuest: mocks.revokeTeamGuest,
  respondToTeamGuestInvitation: mocks.respondToTeamGuestInvitation,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));

import { addTeamRecruiterAction, inviteTeamGuestAction, removeTeamRecruiterAction, respondTeamGuestAction, revokeTeamGuestAction } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe("actions recruteurs et invités", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "captain" });
    mocks.getTeamRecruitersCommunityId.mockResolvedValue("community-1");
    mocks.rateLimit.mockReturnValue(true);
    mocks.addTeamRecruiter.mockResolvedValue("added");
    mocks.removeTeamRecruiter.mockResolvedValue("removed");
    mocks.inviteTeamGuest.mockResolvedValue("invited");
    mocks.revokeTeamGuest.mockResolvedValue("revoked");
    mocks.respondToTeamGuestInvitation.mockResolvedValue("accepted");
  });

  it("refuse un visiteur et un serveur sans le drapeau, sans rien écrire", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(addTeamRecruiterAction(form({ teamId: "t", userId: "u" }))).rejects.toThrow("REDIRECT:/");
    mocks.getCurrentUser.mockResolvedValue({ id: "captain" });
    mocks.getTeamRecruitersCommunityId.mockResolvedValue(null);
    await expect(addTeamRecruiterAction(form({ teamId: "t", userId: "u" }))).rejects.toThrow("result=unavailable");
    await expect(inviteTeamGuestAction(form({ teamId: "t", tournamentId: "x", userId: "u" }))).rejects.toThrow("result=unavailable");
    expect(mocks.addTeamRecruiter).not.toHaveBeenCalled();
    expect(mocks.inviteTeamGuest).not.toHaveBeenCalled();
  });

  it("applique la limite de débit avant toute écriture", async () => {
    mocks.rateLimit.mockReturnValue(false);
    await expect(addTeamRecruiterAction(form({ teamId: "t", userId: "u" }))).rejects.toThrow("result=rate");
    expect(mocks.addTeamRecruiter).not.toHaveBeenCalled();
  });

  it("nomme et retire un recruteur pour l'utilisateur courant", async () => {
    await expect(addTeamRecruiterAction(form({ teamId: "t1", userId: "u1" }))).rejects.toThrow("result=recruiter_added");
    expect(mocks.addTeamRecruiter).toHaveBeenCalledWith("captain", "community-1", { teamId: "t1", userId: "u1" });
    await expect(removeTeamRecruiterAction(form({ teamId: "t1", userId: "u1" }))).rejects.toThrow("result=recruiter_removed");
    expect(mocks.removeTeamRecruiter).toHaveBeenCalledWith("captain", "community-1", { teamId: "t1", userId: "u1" });
  });

  it("refuse les champs manquants", async () => {
    await expect(addTeamRecruiterAction(form({ teamId: "t1" }))).rejects.toThrow("result=invalid");
    await expect(inviteTeamGuestAction(form({ teamId: "t1", userId: "u" }))).rejects.toThrow("result=invalid");
    await expect(respondTeamGuestAction(form({ guestId: "g", decision: "peut-être" }))).rejects.toThrow("result=invalid");
    expect(mocks.addTeamRecruiter).not.toHaveBeenCalled();
    expect(mocks.inviteTeamGuest).not.toHaveBeenCalled();
    expect(mocks.respondToTeamGuestInvitation).not.toHaveBeenCalled();
  });

  it("invite, retire et répond (l'invité revient sur la page des candidatures)", async () => {
    await expect(inviteTeamGuestAction(form({ teamId: "t1", tournamentId: "tn1", userId: "u1" }))).rejects.toThrow("result=guest_invited");
    expect(mocks.inviteTeamGuest).toHaveBeenCalledWith("captain", "community-1", { teamId: "t1", tournamentId: "tn1", userId: "u1" });
    await expect(revokeTeamGuestAction(form({ guestId: "g1" }))).rejects.toThrow("result=guest_revoked");
    await expect(respondTeamGuestAction(form({ guestId: "g1", decision: "accept" }))).rejects.toThrow("REDIRECT:/equipes/candidatures?result=guest_accepted");
    expect(mocks.respondToTeamGuestInvitation).toHaveBeenCalledWith("captain", "community-1", "g1", true);
  });
});
