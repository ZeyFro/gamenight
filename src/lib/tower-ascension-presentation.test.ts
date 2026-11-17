import { describe, expect, it } from "vitest";
import { describeAscension, xpScopeLabel, XP_SCOPE } from "./tower-ascension-presentation";

describe("tower-ascension-presentation", () => {
  it("niveau 1 = 0 XP, titre Victime, rang Bronze", () => {
    expect(describeAscension(0)).toMatchObject({
      xpTotal: 0,
      level: 1,
      title: "Victime",
      xpForCurrentLevel: 0,
      xpForNextLevel: 50,
      xpToNextLevel: 50,
      percentToNextLevel: 0,
    });
    expect(describeAscension(0).rank.name).toBe("Bronze");
  });

  it("niveau 2 après 50 XP", () => {
    const v = describeAscension(50);
    expect(v.level).toBe(2);
    expect(v.xpForCurrentLevel).toBe(50);
    expect(v.xpForNextLevel).toBe(200);
    expect(v.xpToNextLevel).toBe(150);
    expect(v.percentToNextLevel).toBe(0);
  });

  it("progression partielle vers le niveau suivant", () => {
    const v = describeAscension(100);
    expect(v.level).toBe(2); // 50..200
    expect(v.xpForCurrentLevel).toBe(50);
    expect(v.xpForNextLevel).toBe(200);
    expect(v.xpToNextLevel).toBe(150);
    expect(v.xpProgress).toBe(50);
    expect(v.percentToNextLevel).toBeCloseTo(50 / 150);
  });

  it("palier exact : 0 % vers le niveau suivant", () => {
    const v = describeAscension(200);
    expect(v.level).toBe(3);
    expect(v.xpForCurrentLevel).toBe(200);
    expect(v.xpForNextLevel).toBe(450);
    expect(v.xpToNextLevel).toBe(250);
    expect(v.xpProgress).toBe(0);
    expect(v.percentToNextLevel).toBe(0);
  });

  it("100 % atteints juste avant le palier suivant", () => {
    const v = describeAscension(449);
    expect(v.level).toBe(3);
    expect(v.xpForCurrentLevel).toBe(200);
    expect(v.xpForNextLevel).toBe(450);
    expect(v.xpToNextLevel).toBe(250);
    expect(v.xpProgress).toBe(249);
    expect(v.percentToNextLevel).toBeCloseTo(249 / 250);
  });

  it("titre de palier à 10, 20, 50, 100", () => {
    expect(describeAscension(4050).title).toBe("PAPED"); // niveau 10
    expect(describeAscension(18050).title).toBe("Try-hard"); // niveau 20
    expect(describeAscension(120050).title).toBe("No-life"); // niveau 50
    expect(describeAscension(490050).title).toBe("Sans-vie"); // niveau 100
  });

  it("rangs par palier de niveau (seuil exact)", () => {
    expect(describeAscension(0).rank.name).toBe("Bronze");
    expect(describeAscension(5000).rank.name).toBe("Argent"); // niveau 11
    expect(describeAscension(31250).rank.name).toBe("Or"); // niveau 26
    expect(describeAscension(125000).rank.name).toBe("Platine"); // niveau 51
    expect(describeAscension(281250).rank.name).toBe("Diamant"); // niveau 76
    expect(describeAscension(490050).rank.name).toBe("Légende"); // niveau 100
  });

  it("le saison est passé dedans tel quel (optionnel)", () => {
    expect(describeAscension(100, "s2026-hiver").season).toBe("s2026-hiver");
    expect(describeAscension(100).season).toBeUndefined();
  });

  it("labels de scope XP individuel/équipe", () => {
    expect(xpScopeLabel(XP_SCOPE.INDIVIDUAL)).toBe("XP individuel (membre)");
    expect(xpScopeLabel(XP_SCOPE.TEAM)).toBe("XP d'équipe");
  });
});
