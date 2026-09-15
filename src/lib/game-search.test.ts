import { describe, it, expect } from "vitest";
import { normalizeForSearch, filterLocalGames, excludeLocalIgdbIds } from "@/lib/game-search";

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
