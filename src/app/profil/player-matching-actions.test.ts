import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), update: vi.fn(), rate: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { update: mocks.update } } }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw Error(`REDIRECT:${url}`); },
  notFound: () => { throw Error("NOT_FOUND"); },
}));
import { updatePlayerMatchingAction } from "./player-matching-actions";

const form = (fields: Record<string, string[]>) => {
  const data = new FormData();
  for (const [key, values] of Object.entries(fields)) for (const value of values) data.append(key, value);
  return data;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("PLAYER_MATCHING_ENABLED", "true");
  mocks.user.mockResolvedValue({ id: "self" });
  mocks.rate.mockReturnValue(true);
  mocks.update.mockResolvedValue({});
});
afterEach(() => vi.unstubAllEnvs());

describe("critères de recherche de joueurs : action serveur (C036)", () => {
  it("enregistre langues, habitudes et ambiances pour la session, sans accepter de doublon", async () => {
    await expect(updatePlayerMatchingAction(form({
      languages: ["FR", "EN", "FR"], playHabits: ["WEEKEND"], communityPreferences: ["CHILL", "TEXT_ONLY"],
      userId: ["victim"],
    }))).rejects.toThrow("REDIRECT:/profil/parametres?habitudes=ok");

    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: "self" },
      data: { languages: ["FR", "EN"], playHabits: ["WEEKEND"], communityPreferences: ["CHILL", "TEXT_ONLY"] },
    });
  });

  it("efface les informations quand tout est décoché", async () => {
    await expect(updatePlayerMatchingAction(new FormData())).rejects.toThrow("habitudes=ok");
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: "self" },
      data: { languages: [], playHabits: [], communityPreferences: [] },
    });
  });

  it("refuse une valeur inconnue sans rien écrire", async () => {
    await expect(updatePlayerMatchingAction(form({ languages: ["KLINGON"], playHabits: [], communityPreferences: [] })))
      .rejects.toThrow("habitudes=invalide");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("exige une session, le drapeau allumé et la limite de débit avant toute écriture", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(updatePlayerMatchingAction(new FormData())).rejects.toThrow("REDIRECT:/");

    mocks.user.mockResolvedValue({ id: "self" });
    mocks.rate.mockReturnValue(false);
    await expect(updatePlayerMatchingAction(new FormData())).rejects.toThrow("habitudes=rate_limited");

    mocks.rate.mockReturnValue(true);
    vi.stubEnv("PLAYER_MATCHING_ENABLED", "false");
    await expect(updatePlayerMatchingAction(new FormData())).rejects.toThrow("NOT_FOUND");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("ne transforme pas une panne de persistance en succès", async () => {
    mocks.update.mockRejectedValue(new Error("database unavailable"));
    await expect(updatePlayerMatchingAction(new FormData())).rejects.toThrow("database unavailable");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
