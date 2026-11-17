import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), setProfileVisibility: vi.fn(), rateLimit: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/profile-visibility", () => ({ setProfileVisibility: mocks.setProfileVisibility }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));

import { setProfileVisibilityAction } from "./visibility-actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe("setProfileVisibilityAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "me" });
    mocks.rateLimit.mockReturnValue(true);
    mocks.setProfileVisibility.mockResolvedValue("saved");
  });
  it("refuse un visiteur", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(setProfileVisibilityAction(form({ visibility: "HIDDEN" }))).rejects.toThrow("REDIRECT:/");
    expect(mocks.setProfileVisibility).not.toHaveBeenCalled();
  });
  it("n'écrit que pour l'utilisateur de la session, même avec un userId forgé", async () => {
    await expect(setProfileVisibilityAction(form({ userId: "victime", visibility: "HIDDEN" }))).rejects.toThrow("REDIRECT:/potes");
    expect(mocks.setProfileVisibility).toHaveBeenCalledWith("me", "HIDDEN");
  });
  it("refuse une valeur inconnue et respecte la limite de débit", async () => {
    await expect(setProfileVisibilityAction(form({ visibility: "PUBLIC" }))).rejects.toThrow("REDIRECT:/potes");
    mocks.rateLimit.mockReturnValue(false);
    await expect(setProfileVisibilityAction(form({ visibility: "HIDDEN" }))).rejects.toThrow("REDIRECT:/potes");
    expect(mocks.setProfileVisibility).not.toHaveBeenCalled();
  });
});
