import { describe, it, expect } from "vitest";
import { nextSeasonNumber, rankUsersByXp } from "@/lib/seasons";

describe("nextSeasonNumber (PR Atomicité saisons + tournois)", () => {
  it("aucune saison n'a jamais existé : démarre à 1", () => {
    expect(nextSeasonNumber(null)).toBe(1);
  });

  it("reprend au numéro suivant le plus élevé jamais atteint", () => {
    expect(nextSeasonNumber(1)).toBe(2);
    expect(nextSeasonNumber(3)).toBe(4);
    expect(nextSeasonNumber(41)).toBe(42);
  });
});

describe("rankUsersByXp (PR Fiabilise la clôture des saisons)", () => {
  it("tableau vide : retourne un tableau vide", () => {
    expect(rankUsersByXp([])).toEqual([]);
  });

  it("un seul user : position 1", () => {
    expect(rankUsersByXp([{ id: "a", xpTotal: 50 }])).toEqual([
      { id: "a", xpTotal: 50, position: 1 },
    ]);
  });

  it("trie par xpTotal décroissant, positions 1-indexées séquentielles", () => {
    const result = rankUsersByXp([
      { id: "a", xpTotal: 10 },
      { id: "b", xpTotal: 30 },
      { id: "c", xpTotal: 20 },
    ]);
    expect(result.map((u) => u.id)).toEqual(["b", "c", "a"]);
    expect(result.map((u) => u.position)).toEqual([1, 2, 3]);
  });

  it("égalité de xpTotal : chacun reçoit une position distincte et strictement croissante, jamais deux users à la même position", () => {
    const result = rankUsersByXp([
      { id: "a", xpTotal: 20 },
      { id: "b", xpTotal: 20 },
      { id: "c", xpTotal: 5 },
    ]);
    expect(result.map((u) => u.position)).toEqual([1, 2, 3]);
    // Les deux ex-aequo occupent bien les deux premières positions (ordre
    // relatif entre eux non spécifié, cf. commentaire sur rankUsersByXp).
    expect(new Set(result.slice(0, 2).map((u) => u.id))).toEqual(new Set(["a", "b"]));
    expect(result[2].id).toBe("c");
  });

  it("ne mute pas le tableau d'entrée", () => {
    const input = [
      { id: "a", xpTotal: 10 },
      { id: "b", xpTotal: 30 },
    ];
    const original = [...input];
    rankUsersByXp(input);
    expect(input).toEqual(original);
  });
});
