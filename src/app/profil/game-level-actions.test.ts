import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  rateLimit: vi.fn(),
  setLevel: vi.fn(),
  removeLevel: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock("@/lib/game-levels", () => ({ setUserGameLevel: mocks.setLevel, removeUserGameLevel: mocks.removeLevel }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));

import { removeGameLevelAction, setGameLevelAction } from "./game-level-actions";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe("actions des niveaux par jeu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GAME_LEVELS_ENABLED", "true");
    mocks.getCurrentUser.mockResolvedValue({ id: "me" });
    mocks.rateLimit.mockReturnValue(true);
    mocks.setLevel.mockResolvedValue("saved");
    mocks.removeLevel.mockResolvedValue("removed");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("refuse un visiteur", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(setGameLevelAction(form({ gameId: "g", level: "COMPETITIF" }))).rejects.toThrow("REDIRECT:/");
    expect(mocks.setLevel).not.toHaveBeenCalled();
  });

  it("est inerte flag éteint", async () => {
    vi.stubEnv("GAME_LEVELS_ENABLED", "false");
    await expect(setGameLevelAction(form({ gameId: "g", level: "COMPETITIF" }))).rejects.toThrow("niveaux=indisponible");
    await expect(removeGameLevelAction(form({ gameId: "g" }))).rejects.toThrow("niveaux=indisponible");
    expect(mocks.setLevel).not.toHaveBeenCalled();
    expect(mocks.removeLevel).not.toHaveBeenCalled();
  });

  it("n'écrit que pour la session : un userId forgé est ignoré", async () => {
    await expect(setGameLevelAction(form({ gameId: "g", level: "CONFIRME" }))).rejects.toThrow("niveaux=saved");
    expect(mocks.setLevel).toHaveBeenCalledWith("me", "g", "CONFIRME");
    await expect(setGameLevelAction(form({ gameId: "g2", level: "COMPETITIF", userId: "autre" }))).rejects.toThrow("niveaux=saved");
    expect(mocks.setLevel).toHaveBeenLastCalledWith("me", "g2", "COMPETITIF");
  });

  it("refuse un niveau hors énumération sans écrire", async () => {
    await expect(setGameLevelAction(form({ gameId: "g", level: "DIEU" }))).rejects.toThrow("niveaux=invalide");
    await expect(removeGameLevelAction(form({ gameId: "" }))).rejects.toThrow("niveaux=invalide");
    expect(mocks.setLevel).not.toHaveBeenCalled();
    expect(mocks.removeLevel).not.toHaveBeenCalled();
  });

  it("applique la limite de débit et relaie la limite par utilisateur", async () => {
    mocks.rateLimit.mockReturnValue(false);
    await expect(setGameLevelAction(form({ gameId: "g", level: "COMPETITIF" }))).rejects.toThrow("niveaux=rate_limited");
    mocks.rateLimit.mockReturnValue(true);
    mocks.setLevel.mockResolvedValue("limit");
    await expect(setGameLevelAction(form({ gameId: "g", level: "COMPETITIF" }))).rejects.toThrow("niveaux=limit");
  });

  it("retire le niveau de la session", async () => {
    await expect(removeGameLevelAction(form({ gameId: "g" }))).rejects.toThrow("niveaux=removed");
    expect(mocks.removeLevel).toHaveBeenCalledWith("me", "g");
  });
});
