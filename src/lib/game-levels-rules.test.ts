import { afterEach, describe, expect, it, vi } from "vitest";
import {
  gameLevelAtLeast, gameLevelRemovalSchema, gameLevelSchema, gameLevelsFrom, isGameLevel, isGameLevelsEnabled,
} from "./game-levels-rules";

afterEach(() => vi.unstubAllEnvs());

describe("drapeau GAME_LEVELS_ENABLED", () => {
  it.each([[undefined, false], ["", false], ["false", false], ["TRUE", false], ["1", false], ["true", true]])("valeur %s : %s", (value, expected) => {
    vi.stubEnv("GAME_LEVELS_ENABLED", value as string);
    expect(isGameLevelsEnabled()).toBe(expected);
  });
});

describe("schéma d'un niveau", () => {
  it("accepte les quatre niveaux et rogne l'identifiant", () => {
    for (const level of ["DEBUTANT", "INTERMEDIAIRE", "AVANCE", "EXPERT"]) {
      expect(gameLevelSchema.parse({ gameId: " g1 ", level })).toEqual({ gameId: "g1", level });
    }
  });
  it.each([
    ["niveau inconnu", { gameId: "g", level: "DIEU" }],
    ["niveau en minuscules", { gameId: "g", level: "expert" }],
    ["jeu vide", { gameId: "  ", level: "EXPERT" }],
    ["jeu absent", { level: "EXPERT" }],
    ["champ inconnu (userId forgé)", { gameId: "g", level: "EXPERT", userId: "autre" }],
  ])("refuse : %s", (_label, input) => {
    expect(gameLevelSchema.safeParse(input).success).toBe(false);
  });
  it("le retrait exige un jeu et refuse les champs inconnus", () => {
    expect(gameLevelRemovalSchema.safeParse({ gameId: "g" }).success).toBe(true);
    expect(gameLevelRemovalSchema.safeParse({ gameId: "" }).success).toBe(false);
    expect(gameLevelRemovalSchema.safeParse({ gameId: "g", userId: "x" }).success).toBe(false);
  });
});

describe("comparaison des niveaux", () => {
  it("ordonne du débutant à l'expert", () => {
    expect(gameLevelAtLeast("AVANCE", "INTERMEDIAIRE")).toBe(true);
    expect(gameLevelAtLeast("INTERMEDIAIRE", "INTERMEDIAIRE")).toBe(true);
    expect(gameLevelAtLeast("DEBUTANT", "INTERMEDIAIRE")).toBe(false);
  });
  it("liste les niveaux qui satisfont un minimum", () => {
    expect(gameLevelsFrom("DEBUTANT")).toEqual(["DEBUTANT", "INTERMEDIAIRE", "AVANCE", "EXPERT"]);
    expect(gameLevelsFrom("AVANCE")).toEqual(["AVANCE", "EXPERT"]);
    expect(gameLevelsFrom("EXPERT")).toEqual(["EXPERT"]);
  });
  it("reconnaît une valeur valide", () => {
    expect(isGameLevel("EXPERT")).toBe(true);
    expect(isGameLevel("expert")).toBe(false);
    expect(isGameLevel(undefined)).toBe(false);
  });
});
