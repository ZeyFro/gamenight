import { describe, expect, it, vi } from "vitest";
import { isTournamentScoresEnabled, scoreConsistencyError } from "@/lib/tournament-scores";
import { declareWinnerSchema } from "@/lib/validations";

const base = { matchId: "m1", winnerId: "u1" };

describe("declareWinnerSchema (scores)", () => {
  it("accepte l'absence de scores", () => {
    expect(declareWinnerSchema.safeParse(base).success).toBe(true);
    expect(declareWinnerSchema.safeParse({ ...base, score1: "", score2: "" }).success).toBe(true);
  });
  it("accepte 0 à 999 et convertit les chaînes", () => {
    const r = declareWinnerSchema.safeParse({ ...base, score1: "999", score2: "0" });
    expect(r.success && [r.data.score1, r.data.score2]).toEqual([999, 0]);
  });
  it("refuse hors bornes, décimaux et négatifs", () => {
    for (const s of ["1000", "-1", "1.5", "abc"]) {
      expect(declareWinnerSchema.safeParse({ ...base, score1: s, score2: "1" }).success).toBe(false);
    }
  });
  it("refuse un score sans l'autre", () => {
    expect(declareWinnerSchema.safeParse({ ...base, score1: "3", score2: "" }).success).toBe(false);
    expect(declareWinnerSchema.safeParse({ ...base, score2: "3" }).success).toBe(false);
  });
});

describe("scoreConsistencyError", () => {
  it("exige le score strictement le plus haut pour le gagnant", () => {
    expect(scoreConsistencyError(1, 3, 2)).toBeNull();
    expect(scoreConsistencyError(2, 2, 3)).toBeNull();
    expect(scoreConsistencyError(1, 2, 3)).toMatch(/gagnant/);
    expect(scoreConsistencyError(2, 2, 2)).toMatch(/gagnant/);
  });
});

describe("isTournamentScoresEnabled", () => {
  it("actif uniquement si exactement true", () => {
    vi.stubEnv("TOURNAMENT_SCORES_ENABLED", "true");
    expect(isTournamentScoresEnabled()).toBe(true);
    for (const v of ["", "TRUE", "1"]) {
      vi.stubEnv("TOURNAMENT_SCORES_ENABLED", v);
      expect(isTournamentScoresEnabled()).toBe(false);
    }
    vi.unstubAllEnvs();
  });
});
