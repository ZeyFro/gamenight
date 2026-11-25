import { describe, expect, it } from "vitest";
import { dedupeTierlistGames } from "@/lib/tierlist";

describe("dedupeTierlistGames (doublons visibles de la tierlist)", () => {
  it("garde une seule carte par jeu Steam/IGDB et reporte le rang de la ligne masquée", () => {
    const games = [
      { id: "steam-60-parsecs", name: "60 Parsecs!", coverUrl: null, steamAppId: 646810, igdbId: null },
      { id: "igdb-60-parsecs", name: "60  parsecs!", coverUrl: null, steamAppId: null, igdbId: 112135 },
      { id: "valheim", name: "Valheim", coverUrl: null, steamAppId: 892970, igdbId: 126513 },
    ];

    const result = dedupeTierlistGames(games, [{ gameId: "igdb-60-parsecs", tier: "S" }]);

    expect(result.games.map((game) => game.id)).toEqual(["steam-60-parsecs", "valheim"]);
    expect(result.initialTiers).toEqual({ "steam-60-parsecs": "S" });
  });

  it("préfère le rang de la ligne conservée quand les deux lignes en ont un", () => {
    const games = [
      { id: "steam-60-parsecs", name: "60 Parsecs!", coverUrl: null, steamAppId: 646810, igdbId: null },
      { id: "igdb-60-parsecs", name: "60 parsecs!", coverUrl: null, steamAppId: null, igdbId: 112135 },
    ];

    const result = dedupeTierlistGames(games, [
      { gameId: "igdb-60-parsecs", tier: "S" },
      { gameId: "steam-60-parsecs", tier: "B" },
    ]);

    expect(result.initialTiers).toEqual({ "steam-60-parsecs": "B" });
  });

  it("ne fusionne jamais deux éditions distinctes de même nom", () => {
    const games = [
      { id: "original", name: "60 Seconds!", coverUrl: null, steamAppId: null, igdbId: 1001 },
      { id: "reatomized", name: "60 Seconds! Reatomized", coverUrl: null, steamAppId: null, igdbId: 1002 },
    ];

    const result = dedupeTierlistGames(games, [
      { gameId: "original", tier: "A" },
      { gameId: "reatomized", tier: "C" },
    ]);

    expect(result.games.map((game) => game.id)).toEqual(["original", "reatomized"]);
    expect(result.initialTiers).toEqual({ original: "A", reatomized: "C" });
  });
});
