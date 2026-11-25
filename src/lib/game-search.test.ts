import { describe, it, expect } from "vitest";
import { normalizeForSearch, filterLocalGames, excludeLocalIgdbIds, uniqueGameOptions } from "@/lib/game-search";

describe("normalizeForSearch (sélecteur de jeu, création de tournoi)", () => {
  it("aplatit la casse", () => {
    expect(normalizeForSearch("Minecraft")).toBe("minecraft");
  });

  it("aplatit les diacritiques", () => {
    expect(normalizeForSearch("Pokémon")).toBe("pokemon");
  });

  it("retire les espaces de bord", () => {
    expect(normalizeForSearch("  Splatoon  ")).toBe("splatoon");
  });
});

describe("filterLocalGames", () => {
  const games = [
    { name: "Minecraft" },
    { name: "Pokémon Écarlate" },
    { name: "Valheim" },
  ];

  it("requête vide : renvoie tous les jeux", () => {
    expect(filterLocalGames(games, "")).toEqual(games);
  });

  it("filtre par sous-chaîne insensible à la casse", () => {
    expect(filterLocalGames(games, "mine")).toEqual([{ name: "Minecraft" }]);
  });

  it("filtre insensible aux accents (recherche sans accent trouve un nom accentué)", () => {
    expect(filterLocalGames(games, "pokemon")).toEqual([{ name: "Pokémon Écarlate" }]);
  });

  it("aucune correspondance : tableau vide", () => {
    expect(filterLocalGames(games, "zelda")).toEqual([]);
  });
});

describe("excludeLocalIgdbIds", () => {
  const candidates = [
    { igdbId: 1, name: "A" },
    { igdbId: 2, name: "B" },
    { igdbId: 3, name: "C" },
  ];

  it("retire les candidats déjà présents localement (même igdbId)", () => {
    expect(excludeLocalIgdbIds(candidates, new Set([2]))).toEqual([
      { igdbId: 1, name: "A" },
      { igdbId: 3, name: "C" },
    ]);
  });

  it("ensemble vide : ne retire rien", () => {
    expect(excludeLocalIgdbIds(candidates, new Set())).toEqual(candidates);
  });

  it("tout est local : tableau vide", () => {
    expect(excludeLocalIgdbIds(candidates, new Set([1, 2, 3]))).toEqual([]);
  });
});

describe("uniqueGameOptions (doublons visibles des sélecteurs de jeux)", () => {
  it("replie une ligne Steam et sa fiche IGDB du même jeu sur la première, sans toucher la liste reçue", () => {
    const games = [
      { id: "steam-60-parsecs", name: "60 Parsecs!", steamAppId: 646810, igdbId: null },
      { id: "igdb-60-parsecs", name: "60  parsecs!", steamAppId: null, igdbId: 112135 },
      { id: "valheim", name: "Valheim", steamAppId: 892970, igdbId: 126513 },
    ];

    expect(uniqueGameOptions(games)).toEqual([games[0], games[2]]);
    expect(games).toHaveLength(3);
  });

  it("garde les deux lignes quand le nom diffère : « 60 Seconds! » n'est pas « 60 Seconds! Reatomized »", () => {
    const games = [
      { id: "original", name: "60 Seconds!", steamAppId: null, igdbId: 1001 },
      { id: "reatomized", name: "60 Seconds! Reatomized", steamAppId: null, igdbId: 1002 },
    ];

    expect(uniqueGameOptions(games)).toEqual(games);
  });

  it("garde deux jeux distincts de même nom mais de fiches IGDB différentes (remake, réédition)", () => {
    const games = [
      { id: "resident-evil-4-2005", name: "Resident Evil 4", steamAppId: null, igdbId: 1001 },
      { id: "resident-evil-4-2023", name: "Resident Evil 4", steamAppId: null, igdbId: 2002 },
    ];

    expect(uniqueGameOptions(games)).toEqual(games);
  });

  it("garde l'id de la première ligne (celui que le formulaire soumet) et l'ordre d'entrée", () => {
    const games = [
      { id: "premier", name: " 60 parsecs!", steamAppId: 1, igdbId: null },
      { id: "second", name: "60 Parsecs!", steamAppId: null, igdbId: 2 },
      { id: "autre", name: "A Plague Tale", steamAppId: null, igdbId: 3 },
    ];

    expect(uniqueGameOptions(games).map((game) => game.id)).toEqual(["premier", "autre"]);
  });
});
