import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compatibility, isPlayerMatchingEnabled, parsePlayerMatchingFilters, playerMatchingSchema, playerMatchingUserWhere, suggestCompatiblePartners,
  type CompatibilityInput, type MatchingProfile,
} from "./player-matching-rules";

const empty: MatchingProfile = { languages: [], playHabits: [], communityPreferences: [], availablePlatforms: [], tagIds: [] };
const candidate = (userId: string, commonGames: number, profile: Partial<MatchingProfile> = {}): CompatibilityInput => ({ ...empty, ...profile, userId, commonGames });

afterEach(() => vi.unstubAllEnvs());

describe("interrupteur", () => {
  it("actif seulement pour la valeur exacte true", () => {
    for (const value of ["", "1", "TRUE", "yes"]) { vi.stubEnv("PLAYER_MATCHING_ENABLED", value); expect(isPlayerMatchingEnabled()).toBe(false); }
    vi.stubEnv("PLAYER_MATCHING_ENABLED", "true");
    expect(isPlayerMatchingEnabled()).toBe(true);
  });
});

describe("playerMatchingSchema", () => {
  it("garde les options connues, sans doublon ; refuse une valeur inconnue", () => {
    expect(playerMatchingSchema.parse({ languages: ["FR", "FR", "EN"], playHabits: ["WEEKEND"], communityPreferences: [] }))
      .toEqual({ languages: ["FR", "EN"], playHabits: ["WEEKEND"], communityPreferences: [] });
    expect(playerMatchingSchema.safeParse({ languages: ["KLINGON"], playHabits: [], communityPreferences: [] }).success).toBe(false);
  });
});

describe("filtres", () => {
  it("traduit chaque critère en condition sur User ; valeur inconnue = invalide", () => {
    const parsed = parsePlayerMatchingFilters({ language: "FR", habit: "WEEKEND", preference: "CHILL", tagId: "tag-1" });
    if (!parsed.success) throw new Error("filtres valides attendus");
    expect(playerMatchingUserWhere(parsed.data)).toEqual({
      languages: { has: "FR" }, playHabits: { has: "WEEKEND" }, communityPreferences: { has: "CHILL" }, userTags: { some: { tagId: "tag-1" } },
    });
    expect(playerMatchingUserWhere({})).toEqual({});
    expect(parsePlayerMatchingFilters({ language: "XX" }).success).toBe(false);
  });
});

describe("compatibilité", () => {
  const viewer: MatchingProfile = { languages: ["FR"], playHabits: ["WEEKEND"], communityPreferences: ["CHILL"], availablePlatforms: ["WINDOWS"], tagIds: ["t1"] };
  it("score transparent et raisons lisibles", () => {
    const result = compatibility(viewer, candidate("a", 2, { languages: ["FR", "EN"], availablePlatforms: ["WINDOWS"], playHabits: ["WEEKEND"], communityPreferences: ["CHILL"], tagIds: ["t1"] }));
    expect(result.score).toBe(2 * 3 + 4 + 2 + 1 + 1 + 1);
    expect(result.reasons).toEqual(["2 jeux en commun", "Français", "1 plateforme en commun", "Week-end", "Ambiance détente", "1 centre d’intérêt en commun"]);
  });
  it("plafonne les jeux communs à 5 dans le score", () => {
    expect(compatibility(empty, candidate("a", 40)).score).toBe(15);
  });
  it("propose seulement avec un jeu commun ET un autre point commun, meilleurs scores d'abord, 5 au plus", () => {
    const list = suggestCompatiblePartners(viewer, [
      candidate("no-game", 0, { languages: ["FR"] }),
      candidate("game-only", 3),
      candidate("good", 1, { languages: ["FR"] }),
      candidate("best", 2, { languages: ["FR"], playHabits: ["WEEKEND"] }),
      ...["c1", "c2", "c3", "c4"].map(id => candidate(id, 1, { tagIds: ["t1"] })),
    ]);
    expect(list.map(row => row.userId)).toEqual(["best", "good", "c1", "c2", "c3"]);
  });
});
