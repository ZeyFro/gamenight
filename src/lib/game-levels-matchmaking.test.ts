import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { userGameLevel: { findMany: mocks.findMany } } }));

import {
  GAME_LEVEL_LABELS, UNDECLARED_LEVEL_SCORE, averageLevelScore, balanceTeamsByLevel, isGameLevelsMatchmakingEnabled, pairByLevel, resolveGameLevel, seedByAverageLevel,
} from "./game-levels-rules";
import { loadGameLevels, pairParticipantsByLevel, withPosterLevels } from "./game-levels-matchmaking";

const enable = () => { vi.stubEnv("GAME_LEVELS_ENABLED", "true"); vi.stubEnv("GAME_LEVELS_MATCHMAKING_ENABLED", "true"); };
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => vi.clearAllMocks());

describe("libellés et drapeau", () => {
  it("affiche Débutant / Intermédiaire / Confirmé / Compétitif", () => {
    expect(Object.values(GAME_LEVEL_LABELS)).toEqual(["Débutant", "Intermédiaire", "Confirmé", "Compétitif"]);
  });
  it("exige les deux drapeaux, valeur exacte true", () => {
    const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;
    expect(isGameLevelsMatchmakingEnabled(env({}))).toBe(false);
    expect(isGameLevelsMatchmakingEnabled(env({ GAME_LEVELS_MATCHMAKING_ENABLED: "true" }))).toBe(false);
    expect(isGameLevelsMatchmakingEnabled(env({ GAME_LEVELS_ENABLED: "true" }))).toBe(false);
    expect(isGameLevelsMatchmakingEnabled(env({ GAME_LEVELS_ENABLED: "true", GAME_LEVELS_MATCHMAKING_ENABLED: "1" }))).toBe(false);
    expect(isGameLevelsMatchmakingEnabled(env({ GAME_LEVELS_ENABLED: "true", GAME_LEVELS_MATCHMAKING_ENABLED: "true" }))).toBe(true);
  });
});

describe("rang importé (interface prête)", () => {
  it("le niveau déclaré est DECLARED ; un niveau importé primerait", () => {
    expect(resolveGameLevel("AVANCE")).toEqual({ level: "AVANCE", source: "DECLARED" });
    expect(resolveGameLevel("DEBUTANT", "EXPERT")).toEqual({ level: "EXPERT", source: "IMPORTED" });
    expect(resolveGameLevel(null)).toBeNull();
  });
});

describe("équilibrage pur", () => {
  it("apparie le plus fort avec le plus faible, stable", () => {
    const pairs = pairByLevel([
      { player: "a", level: "EXPERT" }, { player: "b", level: "DEBUTANT" }, { player: "c", level: "AVANCE" }, { player: "d", level: "INTERMEDIAIRE" },
    ]);
    expect(pairs).toEqual([["a", "b"], ["c", "d"]]);
  });
  it("les niveaux manquants comptent au milieu et on garde l'ordre d'entrée à égalité", () => {
    expect(pairByLevel([{ player: 1, level: null }, { player: 2, level: null }, { player: 3, level: null }, { player: 4, level: null }])).toEqual([[1, 4], [2, 3]]);
    expect(UNDECLARED_LEVEL_SCORE).toBe(2.5);
  });
  it("refuse moins de 4 joueurs ou un nombre impair", () => {
    expect(pairByLevel([{ player: 1, level: null }, { player: 2, level: null }])).toBeNull();
    expect(pairByLevel(Array.from({ length: 5 }, (_, i) => ({ player: i, level: null })))).toBeNull();
  });
  it("répartit en serpentin des équipes de niveau comparable", () => {
    const players = (["EXPERT", "AVANCE", "AVANCE", "INTERMEDIAIRE", "INTERMEDIAIRE", "DEBUTANT"] as const).map((level, i) => ({ player: `p${i}`, level }));
    const teams = balanceTeamsByLevel(players, 2);
    expect(teams.map(team => team.length)).toEqual([3, 3]);
    const score = (team: string[]) => team.reduce((sum, name) => sum + [4, 3, 3, 2, 2, 1][Number(name.slice(1))], 0);
    expect(Math.abs(score(teams[0]) - score(teams[1]))).toBeLessThanOrEqual(1);
    expect(() => balanceTeamsByLevel(players, 1)).toThrow(RangeError);
  });
  it("classe les têtes de série par niveau moyen décroissant", () => {
    expect(averageLevelScore([])).toBe(2.5);
    expect(seedByAverageLevel([
      { group: "faibles", levels: ["DEBUTANT", "DEBUTANT"] }, { group: "forts", levels: ["EXPERT", "AVANCE"] }, { group: "inconnus", levels: [null, null] },
    ])).toEqual(["forts", "inconnus", "faibles"]);
  });
});

describe("loadGameLevels / withPosterLevels", () => {
  const listing = (id: string, userId: string, gameId = "g1") => ({ id, game: { id: gameId }, createdBy: { id: userId } });

  it("flag éteint : aucune lecture, annonces inchangées", async () => {
    const result = await withPosterLevels([listing("l1", "u1")], "AVANCE");
    expect(result).toEqual([{ ...listing("l1", "u1"), posterLevel: null }]);
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect((await loadGameLevels(["u1"], "g1")).size).toBe(0);
  });

  it("annote avec le niveau de l'auteur pour son jeu et filtre le minimum", async () => {
    enable();
    mocks.findMany.mockResolvedValue([{ userId: "u1", level: "EXPERT" }, { userId: "u2", level: "DEBUTANT" }]);
    const all = await withPosterLevels([listing("l1", "u1"), listing("l2", "u2"), listing("l3", "u3")]);
    expect(all.map(l => l.posterLevel?.level ?? null)).toEqual(["EXPERT", "DEBUTANT", null]);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ gameId: "g1" }) }));
    const filtered = await withPosterLevels([listing("l1", "u1"), listing("l2", "u2"), listing("l3", "u3")], "AVANCE");
    expect(filtered.map(l => l.id)).toEqual(["l1"]);
  });

  it("n'interroge qu'une fois par jeu", async () => {
    enable();
    mocks.findMany.mockResolvedValue([]);
    await withPosterLevels([listing("l1", "u1", "g1"), listing("l2", "u2", "g1"), listing("l3", "u3", "g2")]);
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
  });

  it("appariement de tournoi : null sans drapeau ou sans aucun niveau", async () => {
    const people = ["a", "b", "c", "d"].map(userId => ({ userId }));
    expect(await pairParticipantsByLevel(mocks as never, "g1", people)).toBeNull();
    enable();
    const tx = { userGameLevel: { findMany: vi.fn().mockResolvedValue([]) } };
    expect(await pairParticipantsByLevel(tx as never, "g1", people)).toBeNull();
    tx.userGameLevel.findMany.mockResolvedValue([{ userId: "a", level: "EXPERT" }, { userId: "d", level: "DEBUTANT" }, { userId: "b", level: "AVANCE" }, { userId: "c", level: "INTERMEDIAIRE" }]);
    expect(await pairParticipantsByLevel(tx as never, "g1", people)).toEqual([[people[0], people[3]], [people[1], people[2]]]);
  });
});
