import { describe, it, expect } from "vitest";
import {
  xpForLevel,
  levelForXp,
  titleForLevel,
  rankForLevel,
  LEVEL_TITLES,
  streakMultiplier,
  computeAwardedAmount,
  didLevelUp,
  xpLevelLabel,
  levelProgress,
  rankProgress,
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
    expect(titleForLevel(1)).toBe("Recrue");
    expect(titleForLevel(4)).toBe("Recrue");
    expect(titleForLevel(5)).toBe("Apprenti");
    expect(titleForLevel(9)).toBe("Apprenti");
    expect(titleForLevel(10)).toBe("Habitué");
    expect(titleForLevel(100)).toBe("Immortel");
  });

  it("plafonne au dernier titre au-delà du niveau 100", () => {
    expect(titleForLevel(250)).toBe("Immortel");
  });

  it("progression logique : paliers strictement croissants, du niveau 1 au sommet, sans titre moqueur pour un débutant", () => {
    const levels = LEVEL_TITLES.map((tier) => tier.level);
    expect(levels[0]).toBe(1);
    expect([...levels].sort((x, y) => x - y)).toEqual(levels);
    expect(new Set(levels).size).toBe(levels.length);
    expect(new Set(LEVEL_TITLES.map((tier) => tier.title)).size).toBe(LEVEL_TITLES.length);
    const beginners = LEVEL_TITLES.filter((tier) => tier.level < 20).map((tier) => tier.title);
    for (const banned of ["Noob", "Victime", "PAPED", "Sans-vie"]) expect(beginners).not.toContain(banned);
    expect(LEVEL_TITLES.at(-1)?.level).toBe(100);
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

describe("computeAwardedAmount (extrait de awardXp, PR atomicité XP)", () => {
  it("sans streak (streak <= 1) : montant de base inchangé", () => {
    expect(computeAwardedAmount(30, 0, true)).toBe(30);
    expect(computeAwardedAmount(30, 1, true)).toBe(30);
  });

  it("applique le multiplicateur de streak quand applyStreak est vrai", () => {
    // streak 3 → ×1.10 (cf. streakMultiplier), 30 × 1.10 = 33
    expect(computeAwardedAmount(30, 3, true)).toBe(33);
  });

  it("ignore le streak quand applyStreak est faux (backfill)", () => {
    expect(computeAwardedAmount(30, 11, false)).toBe(30);
  });

  it("arrondit le montant final", () => {
    // streak 2 → ×1.05, 15 × 1.05 = 15.75 → 16
    expect(computeAwardedAmount(15, 2, true)).toBe(16);
  });
});

describe("didLevelUp (extrait de awardXp, PR atomicité XP)", () => {
  it("détecte un franchissement de palier", () => {
    // xpForLevel(2) = 50 : avant 45 (niveau 1), après 55 (niveau 2)
    expect(didLevelUp(45, 55)).toBe(true);
  });

  it("aucun franchissement si le niveau reste le même", () => {
    expect(didLevelUp(10, 45)).toBe(false);
  });

  it("pas de faux positif pile au seuil (avant == seuil, après > seuil)", () => {
    expect(didLevelUp(xpForLevel(2), xpForLevel(2) + 1)).toBe(false);
  });

  it("détecte le franchissement pile sur le seuil suivant", () => {
    expect(didLevelUp(xpForLevel(2) - 1, xpForLevel(2))).toBe(true);
  });
});

describe("vocabulaire unique de la progression XP (audit du 23/11/2026)", () => {
  it("« Niveau d'XP » est le seul nom du niveau gagné avec l'XP", () => {
    expect(xpLevelLabel(1)).toBe("Niveau d’XP 1");
    expect(xpLevelLabel(4)).toBe("Niveau d’XP 4");
  });
  it("progression vers le niveau suivant : 771 XP = niveau 4, 321 / 350, 92 %", () => {
    const p = levelProgress(771);
    expect(p).toMatchObject({ level: 4, earned: 321, needed: 350, remaining: 29 });
    expect(Math.floor(p.fraction * 100)).toBe(91);
    expect(levelProgress(0)).toMatchObject({ level: 1, earned: 0, needed: 50, remaining: 50, fraction: 0 });
    expect(levelProgress(-5).level).toBe(1);
  });
  it("progression vers le rang suivant : même XP, 4 229 XP avant Argent (niveau 11)", () => {
    const r = rankProgress(771);
    expect(r.current.name).toBe("Bronze");
    expect(r.next?.name).toBe("Argent");
    expect(r.remaining).toBe(4229);
    expect(Math.floor(r.fraction * 100)).toBe(15);
  });
  it("rang maximal : pas de rang suivant", () => {
    const r = rankProgress(xpForLevel(120));
    expect(r.current.name).toBe("Légende");
    expect(r.next).toBeNull();
    expect(r.remaining).toBeNull();
  });
});
