import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { userProfileVisibility: { findUnique: mocks.findUnique, upsert: mocks.upsert } } }));

import { getProfileVisibility, isProfileVisibilityEnabled, profileVisibilityWhere, setProfileVisibility } from "./profile-visibility";

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe("drapeau PROFILE_VISIBILITY_ENABLED", () => {
  it.each([[undefined, false], ["", false], ["false", false], ["TRUE", false], ["true", true]])("valeur %s : %s", (value, expected) => {
    vi.stubEnv("PROFILE_VISIBILITY_ENABLED", value as string);
    expect(isProfileVisibilityEnabled()).toBe(expected);
  });
});

describe("condition de découverte", () => {
  it("est vide quand le drapeau est éteint : tous les profils restent visibles", () => {
    vi.stubEnv("PROFILE_VISIBILITY_ENABLED", "");
    expect(profileVisibilityWhere()).toEqual({});
  });
  it("exclut seulement les profils HIDDEN quand il est allumé (pas de ligne = visible)", () => {
    vi.stubEnv("PROFILE_VISIBILITY_ENABLED", "true");
    expect(profileVisibilityWhere()).toEqual({ NOT: { profileVisibility: { is: { visibility: "HIDDEN" } } } });
  });
});

describe("lecture et écriture du choix", () => {
  it("sans ligne, le profil est visible par la communauté", async () => {
    mocks.findUnique.mockResolvedValue(null);
    await expect(getProfileVisibility("u1")).resolves.toBe("COMMUNITY");
    mocks.findUnique.mockResolvedValue({ visibility: "HIDDEN" });
    await expect(getProfileVisibility("u1")).resolves.toBe("HIDDEN");
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { userId: "u1" }, select: { visibility: true } });
  });
  it("n'écrit rien tant que le drapeau est éteint", async () => {
    await expect(setProfileVisibility("u1", "HIDDEN")).resolves.toBe("unavailable");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("enregistre le choix du propriétaire seulement", async () => {
    vi.stubEnv("PROFILE_VISIBILITY_ENABLED", "true");
    await expect(setProfileVisibility("u1", "HIDDEN")).resolves.toBe("saved");
    expect(mocks.upsert).toHaveBeenCalledWith({
      where: { userId: "u1" }, create: { userId: "u1", visibility: "HIDDEN" }, update: { visibility: "HIDDEN" },
    });
  });
});
