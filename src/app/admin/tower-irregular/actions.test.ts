import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(), communityId: vi.fn(), grant: vi.fn(), revoke: vi.fn(), rateLimit: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/tower-irregular", () => ({
  getTowerIrregularCommunityId: mocks.communityId, grantTowerIrregular: mocks.grant, revokeTowerIrregular: mocks.revoke,
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));

import { grantTowerIrregularAction, revokeTowerIrregularAction } from "./actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe("actions Irregular (staff)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "staff" });
    mocks.communityId.mockResolvedValue("community-1");
    mocks.rateLimit.mockReturnValue(true);
    mocks.grant.mockResolvedValue("granted");
    mocks.revoke.mockResolvedValue("revoked");
  });

  it("refuse un visiteur et une communauté sans la fonctionnalité, sans rien écrire", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(grantTowerIrregularAction(form({ userId: "u" }))).rejects.toThrow("REDIRECT:/");
    mocks.getCurrentUser.mockResolvedValue({ id: "staff" });
    mocks.communityId.mockResolvedValue(null);
    await expect(grantTowerIrregularAction(form({ userId: "u" }))).rejects.toThrow("result=unavailable");
    await expect(revokeTowerIrregularAction(form({ userId: "u" }))).rejects.toThrow("result=unavailable");
    expect(mocks.grant).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it("utilise la communauté active de l'acteur et ignore un identifiant de communauté forgé", async () => {
    await expect(grantTowerIrregularAction(form({ communityId: "foreign", userId: "u" }))).rejects.toThrow("result=granted");
    expect(mocks.grant).toHaveBeenCalledWith("staff", "community-1", { userId: "u" });
    await expect(revokeTowerIrregularAction(form({ userId: "u" }))).rejects.toThrow("result=revoked");
    expect(mocks.revoke).toHaveBeenCalledWith("staff", "community-1", { userId: "u" });
  });

  it("transmet le refus du staff et la limite de débit", async () => {
    mocks.grant.mockResolvedValue("forbidden");
    await expect(grantTowerIrregularAction(form({ userId: "u" }))).rejects.toThrow("result=forbidden");
    mocks.rateLimit.mockReturnValue(false);
    await expect(grantTowerIrregularAction(form({ userId: "u" }))).rejects.toThrow("result=rate");
  });
});
