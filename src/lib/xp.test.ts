import { describe, it, expect } from "vitest";
import {
  xpForLevel,
  levelForXp,
  titleForLevel,
  rankForLevel,
  streakMultiplier,
} from "@/lib/xp";

describe("xpForLevel / levelForXp (courbe 50 × (niveau-1)²)", () => {
  it("respecte les repères documentés dans xp.ts", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(50);
    expect(xpForLevel(5)).toBe(800);
    expect(xpForLevel(10)).toBe(4050);
    expect(xpForLevel(20)).toBe(18050);
  });

  it("levelForXp est l'inverse de xpForLevel aux paliers exacts", () => {
    for (const level of [1, 2, 5, 10, 20, 50]) {
      expect(levelForXp(xpForLevel(level))).toBe(level);
    }
  });

  it("levelForXp ne fait pas passer au niveau suivant juste avant le seuil", () => {
    expect(levelForXp(xpForLevel(5) - 1)).toBe(4);
  });

  it("levelForXp gère un XP négatif ou nul sans lever d'erreur (niveau 1)", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(-100)).toBe(1);
  });
});

describe("titleForLevel", () => {
  it("renvoie le titre du palier courant, pas le suivant", () => {
    expect(titleForLevel(1)).toBe("Victime");
    expect(titleForLevel(4)).toBe("Victime");
    expect(titleForLevel(5)).toBe("Noob");
    expect(titleForLevel(9)).toBe("Noob");
    expect(titleForLevel(10)).toBe("PAPED");
    expect(titleForLevel(100)).toBe("Sans-vie");
  });

  it("plafonne au dernier titre au-delà du niveau 100", () => {
    expect(titleForLevel(250)).toBe("Sans-vie");
  });
});

describe("rankForLevel", () => {
  it("respecte les paliers de rang", () => {
    expect(rankForLevel(1).name).toBe("Bronze");
    expect(rankForLevel(10).name).toBe("Bronze");
    expect(rankForLevel(11).name).toBe("Argent");
    expect(rankForLevel(25).name).toBe("Argent");
    expect(rankForLevel(26).name).toBe("Or");
    expect(rankForLevel(50).name).toBe("Or");
    expect(rankForLevel(51).name).toBe("Platine");
    expect(rankForLevel(75).name).toBe("Platine");
    expect(rankForLevel(76).name).toBe("Diamant");
    expect(rankForLevel(99).name).toBe("Diamant");
    expect(rankForLevel(100).name).toBe("Légende");
  });

  it("seul le rang Légende a le halo pulsant", () => {
    expect(rankForLevel(99).glowing).toBeUndefined();
    expect(rankForLevel(100).glowing).toBe(true);
  });
});

describe("streakMultiplier", () => {
  it("aucun bonus pour un streak de 0 ou 1", () => {
    expect(streakMultiplier(0)).toBe(1);
    expect(streakMultiplier(1)).toBe(1);
  });

  it("+5 % par jour de streak au-delà du premier", () => {
    expect(streakMultiplier(2)).toBeCloseTo(1.05);
    expect(streakMultiplier(3)).toBeCloseTo(1.1);
  });

  it("plafonne à +50 % à partir du jour 11", () => {
    expect(streakMultiplier(11)).toBeCloseTo(1.5);
    expect(streakMultiplier(50)).toBeCloseTo(1.5);
  });
});
