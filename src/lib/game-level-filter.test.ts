import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { userGameLevel: { findMany: mocks.findMany } } }));

import { gameLevelUserWhere, levelKey, loadVisibleLevels, parseGameLevelFilter } from "./game-level-filter";
import { parsePlayerClassifiedFilters, playerClassifiedFilterWhere } from "./player-classified-filters";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GAME_LEVELS_ENABLED", "true");
  vi.stubEnv("PROFILE_VISIBILITY_ENABLED", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("condition de niveau sur un utilisateur", () => {
  it("est vide sans niveau demandé", () => {
    expect(gameLevelUserWhere({ gameId: "g1" })).toEqual({});
    expect(gameLevelUserWhere({ gameId: "g1", level: "" })).toEqual({});
  });
  it("niveau minimum par défaut : ce niveau et les plus forts", () => {
    expect(gameLevelUserWhere({ gameId: "g1", level: "CONFIRME" })).toEqual({
      gameLevels: { some: { gameId: "g1", level: { in: ["CONFIRME", "COMPETITIF"] } } },
    });
  });
  it("niveau exact", () => {
    expect(gameLevelUserWhere({ gameId: "g1", level: "CONFIRME", levelMatch: "exact" })).toEqual({
      gameLevels: { some: { gameId: "g1", level: "CONFIRME" } },
    });
  });
  it("exclut les profils masqués quand la visibilité est active", () => {
    vi.stubEnv("PROFILE_VISIBILITY_ENABLED", "true");
    expect(gameLevelUserWhere({ gameId: "g1", level: "DEBUTANT" })).toMatchObject({
      NOT: { profileVisibility: { is: { visibility: "HIDDEN" } } },
    });
  });
  it("ne correspond à personne sans jeu, avec un niveau inconnu ou drapeau éteint (jamais élargi)", () => {
    expect(gameLevelUserWhere({ level: "CONFIRME" })).toEqual({ id: { in: [] } });
    expect(gameLevelUserWhere({ gameId: "g1", level: "DIEU" })).toEqual({ id: { in: [] } });
    vi.stubEnv("GAME_LEVELS_ENABLED", "false");
    expect(gameLevelUserWhere({ gameId: "g1", level: "CONFIRME" })).toEqual({ id: { in: [] } });
  });
});

describe("filtre de niveau d'URL (page Potes)", () => {
  it("accepte jeu + niveau + comparaison", () => {
    expect(parseGameLevelFilter({ gameId: "g1", level: "COMPETITIF", levelMatch: "exact" })).toMatchObject({ success: true });
    expect(parseGameLevelFilter({})).toMatchObject({ success: true });
  });
  it.each([
    ["niveau sans jeu", { level: "COMPETITIF" }],
    ["niveau forgé", { gameId: "g1", level: "ROOT" }],
    ["comparaison forgée", { gameId: "g1", level: "COMPETITIF", levelMatch: "all" }],
  ])("refuse : %s", (_label, params) => {
    expect(parseGameLevelFilter(params).success).toBe(false);
  });
  it("refuse tout niveau quand le drapeau est éteint", () => {
    vi.stubEnv("GAME_LEVELS_ENABLED", "false");
    expect(parseGameLevelFilter({ gameId: "g1", level: "COMPETITIF" }).success).toBe(false);
  });
});

describe("filtre de niveau des annonces joueurs", () => {
  it("valide le niveau seulement avec un jeu choisi", () => {
    expect(parsePlayerClassifiedFilters({ gameId: "g1", level: "CONFIRME", levelMatch: "min" }).success).toBe(true);
    expect(parsePlayerClassifiedFilters({ level: "CONFIRME" }).success).toBe(false);
    expect(parsePlayerClassifiedFilters({ gameId: "g1", level: "ROOT" }).success).toBe(false);
    expect(parsePlayerClassifiedFilters({ gameId: "g1", level: "CONFIRME", levelMatch: "tous" }).success).toBe(false);
  });
  it("refuse le niveau flag éteint, et laisse les autres filtres intacts", () => {
    vi.stubEnv("GAME_LEVELS_ENABLED", "false");
    expect(parsePlayerClassifiedFilters({ gameId: "g1", level: "CONFIRME" }).success).toBe(false);
    expect(parsePlayerClassifiedFilters({ gameId: "g1", platform: "WINDOWS" }).success).toBe(true);
  });
  it("ajoute la condition de niveau à l'auteur, à côté des autres filtres", () => {
    const parsed = parsePlayerClassifiedFilters({ gameId: "g1", level: "INTERMEDIAIRE", microphone: "yes" });
    if (!parsed.success) throw new Error("filtres invalides");
    const where = playerClassifiedFilterWhere(parsed.data);
    expect(where.gameId).toBe("g1");
    expect(where.createdBy).toMatchObject({
      gameLevels: { some: { gameId: "g1", level: { in: ["INTERMEDIAIRE", "CONFIRME", "COMPETITIF"] } } },
      microphoneAvailable: true,
    });
  });
  it("sans niveau, la requête est identique à avant", () => {
    const parsed = parsePlayerClassifiedFilters({ gameId: "g1" });
    if (!parsed.success) throw new Error("filtres invalides");
    expect(playerClassifiedFilterWhere(parsed.data).createdBy).toEqual({});
  });
});

describe("tag niveau des résultats", () => {
  it("ne lit rien flag éteint ou sans paire", async () => {
    vi.stubEnv("GAME_LEVELS_ENABLED", "false");
    expect((await loadVisibleLevels("viewer", [{ userId: "u", gameId: "g" }])).size).toBe(0);
    vi.stubEnv("GAME_LEVELS_ENABLED", "true");
    expect((await loadVisibleLevels("viewer", [])).size).toBe(0);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
  it("lit les paires demandées, réserve les profils masqués et garde le lecteur lui-même", async () => {
    vi.stubEnv("PROFILE_VISIBILITY_ENABLED", "true");
    mocks.findMany.mockResolvedValue([{ userId: "u1", gameId: "g1", level: "COMPETITIF" }]);
    const result = await loadVisibleLevels("viewer", [{ userId: "u1", gameId: "g1" }, { userId: "u2", gameId: "g2" }]);
    expect(result.get(levelKey("u1", "g1"))).toBe("COMPETITIF");
    expect(result.has(levelKey("u2", "g2"))).toBe(false);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [{ userId: "u1", gameId: "g1" }, { userId: "u2", gameId: "g2" }],
        user: { OR: [{ id: "viewer" }, { NOT: { profileVisibility: { is: { visibility: "HIDDEN" } } } }] },
      },
    }));
  });
});
