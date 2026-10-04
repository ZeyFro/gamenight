import { describe, expect, it } from "vitest";
import {
  DEFAULT_GAME_FILTERS,
  collectAvailableGenres,
  countActiveFilters,
  matchesGameFilters,
  parseGameFilters,
  serializeGameFilters,
  translateGenre,
  type FilterableGame,
  type GameFilters,
} from "./game-filters";

const game = (over: Partial<FilterableGame> = {}): FilterableGame => ({
  id: "g1",
  source: "STEAM",
  isCoop: false,
  minPlayers: 1,
  maxPlayers: 4,
  igdbDetails: null,
  ...over,
});

const filters = (over: Partial<GameFilters> = {}): GameFilters => ({
  ...DEFAULT_GAME_FILTERS,
  ...over,
});

describe("parseGameFilters", () => {
  it("renvoie les valeurs par défaut sans paramètre", () => {
    expect(parseGameFilters({})).toEqual(DEFAULT_GAME_FILTERS);
  });

  it("ignore les valeurs d'énumération invalides", () => {
    const parsed = parseGameFilters({
      modes: "coop,inconnu",
      sources: "STEAM,NOPE",
      ownership: "FAMILY,X",
    });
    expect(parsed.modes).toEqual(["coop"]);
    expect(parsed.sources).toEqual(["STEAM"]);
    expect(parsed.ownership).toEqual(["FAMILY"]);
  });

  it("borne les nombres et retombe sur le défaut si non numérique", () => {
    const parsed = parseGameFilters({
      playersMin: "-5",
      playersMax: "9999",
      yearMin: "1900",
      yearMax: "abc",
      ownedMin: "0",
    });
    expect(parsed.playersMin).toBe(1);
    expect(parsed.playersMax).toBe(100);
    expect(parsed.yearMin).toBe(1990);
    expect(parsed.yearMax).toBe(2026);
    expect(parsed.ownedMin).toBe(1);
  });

  it("prend la première valeur d'un paramètre répété", () => {
    expect(parseGameFilters({ playersMin: ["3", "7"] }).playersMin).toBe(3);
  });

  it("conserve les genres tels quels (libellés FR)", () => {
    expect(parseGameFilters({ genres: "RPG,Aventure" }).genres).toEqual(["RPG", "Aventure"]);
  });
});

describe("serializeGameFilters", () => {
  it("omet les filtres par défaut", () => {
    expect(serializeGameFilters(DEFAULT_GAME_FILTERS)).toBe("");
  });

  it("fait l'aller-retour avec parseGameFilters", () => {
    const f = filters({
      modes: ["coop", "local"],
      playersMin: 2,
      sources: ["STEAM"],
      ownedMin: 3,
      genres: ["RPG"],
      yearMax: 2020,
      ownership: ["MANUAL"],
    });
    const query = serializeGameFilters(f);
    const params = Object.fromEntries(new URLSearchParams(query));
    expect(parseGameFilters(params)).toEqual(f);
  });
});

describe("countActiveFilters", () => {
  it("vaut 0 par défaut", () => {
    expect(countActiveFilters(DEFAULT_GAME_FILTERS)).toBe(0);
  });

  it("compte la plage de joueurs et d'années comme un seul filtre chacune", () => {
    expect(countActiveFilters(filters({ playersMin: 2, playersMax: 4 }))).toBe(1);
    expect(countActiveFilters(filters({ yearMin: 2000, yearMax: 2010 }))).toBe(1);
  });

  it("compte les 7 groupes", () => {
    expect(
      countActiveFilters(
        filters({
          modes: ["solo"],
          playersMin: 2,
          sources: ["MANUAL"],
          ownedMin: 2,
          genres: ["RPG"],
          yearMin: 2000,
          ownership: ["FAMILY"],
        })
      )
    ).toBe(7);
  });
});

describe("translateGenre / collectAvailableGenres", () => {
  it("traduit les genres connus, repli sur le nom brut", () => {
    expect(translateGenre("Shooter")).toBe("Tir");
    expect(translateGenre("Roguelike")).toBe("Roguelike");
  });

  it("traduit, dédoublonne et trie en français", () => {
    const games = [
      game({ igdbDetails: { genres: ["Shooter", "Adventure"], releaseDate: null } }),
      game({ igdbDetails: { genres: ["Adventure", "Indie"], releaseDate: null } }),
      game({ igdbDetails: null }),
    ];
    expect(collectAvailableGenres(games)).toEqual(["Aventure", "Indépendant", "Tir"]);
  });
});

describe("matchesGameFilters", () => {
  it("accepte tout avec les filtres par défaut", () => {
    expect(matchesGameFilters(game(), 1, DEFAULT_GAME_FILTERS)).toBe(true);
  });

  it("modes : solo / multi / coop / local", () => {
    expect(matchesGameFilters(game({ maxPlayers: 1 }), 1, filters({ modes: ["solo"] }))).toBe(true);
    expect(matchesGameFilters(game({ maxPlayers: 1 }), 1, filters({ modes: ["multi"] }))).toBe(false);
    expect(matchesGameFilters(game({ maxPlayers: null }), 1, filters({ modes: ["multi"] }))).toBe(true);
    expect(matchesGameFilters(game({ isCoop: true }), 1, filters({ modes: ["coop"] }))).toBe(true);
    expect(matchesGameFilters(game({ maxPlayers: 4 }), 1, filters({ modes: ["local"] }))).toBe(true);
    expect(matchesGameFilters(game({ maxPlayers: 16 }), 1, filters({ modes: ["local"] }))).toBe(false);
    expect(matchesGameFilters(game({ maxPlayers: null }), 1, filters({ modes: ["local"] }))).toBe(false);
  });

  it("joueurs : recouvrement de plage, exclut les jeux sans données", () => {
    const f = filters({ playersMin: 3, playersMax: 5 });
    expect(matchesGameFilters(game({ minPlayers: 1, maxPlayers: 4 }), 1, f)).toBe(true);
    expect(matchesGameFilters(game({ minPlayers: 1, maxPlayers: 2 }), 1, f)).toBe(false);
    expect(matchesGameFilters(game({ minPlayers: 6, maxPlayers: 8 }), 1, f)).toBe(false);
    expect(matchesGameFilters(game({ minPlayers: null, maxPlayers: null }), 1, f)).toBe(false);
  });

  it("source du jeu et nombre de possesseurs", () => {
    expect(matchesGameFilters(game({ source: "MANUAL" }), 1, filters({ sources: ["STEAM"] }))).toBe(false);
    expect(matchesGameFilters(game(), 2, filters({ ownedMin: 3 }))).toBe(false);
    expect(matchesGameFilters(game(), 3, filters({ ownedMin: 3 }))).toBe(true);
  });

  it("genre : traduit côté jeu, jeu sans cache jamais retenu", () => {
    const f = filters({ genres: ["Tir"] });
    expect(
      matchesGameFilters(game({ igdbDetails: { genres: ["Shooter"], releaseDate: null } }), 1, f)
    ).toBe(true);
    expect(matchesGameFilters(game(), 1, f)).toBe(false);
  });

  it("année de sortie : bornes incluses, jeu sans date exclu", () => {
    const f = filters({ yearMin: 2010, yearMax: 2012 });
    const withDate = (d: string) =>
      game({ igdbDetails: { genres: [], releaseDate: d } });
    expect(matchesGameFilters(withDate("2010-01-01T00:00:00.000Z"), 1, f)).toBe(true);
    expect(matchesGameFilters(withDate("2012-12-31T00:00:00.000Z"), 1, f)).toBe(true);
    expect(matchesGameFilters(withDate("2013-01-01T00:00:00.000Z"), 1, f)).toBe(false);
    expect(matchesGameFilters(game(), 1, f)).toBe(false);
  });

  it("provenance : exige ownershipSource correspondant", () => {
    const f = filters({ ownership: ["FAMILY"] });
    expect(matchesGameFilters(game({ ownershipSource: "FAMILY" }), 1, f)).toBe(true);
    expect(matchesGameFilters(game({ ownershipSource: "PERSONAL" }), 1, f)).toBe(false);
    expect(matchesGameFilters(game(), 1, f)).toBe(false);
  });
});
