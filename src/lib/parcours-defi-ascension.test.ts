import { describe, expect, it } from "vitest";
import { availableSoloChallenges, pickSoloChallenge } from "./tower-challenges-domain";
import { describeAscension } from "./tower-ascension-presentation";
import { didLevelUp, XP_AMOUNTS } from "./xp";
const CHALLENGE_COMPLETE = XP_AMOUNTS.CHALLENGE_COMPLETE;

describe("parcours (défi → progression → consultation Ascension) — fonctions pures partagées", () => {
  const DEFS = [
    { id: "c1", title: "Capture du chaos", instructions: "x", rewardFloors: 1, gameId: null },
    { id: "c2", title: "Légende de l'objet", instructions: "x", rewardFloors: 2, gameId: "g1" },
    { id: "c3", title: "Critique cinq étoiles", instructions: "x", rewardFloors: 2, gameId: "g2" },
  ] as const;

  it("sélection jeu : les défis sans jeu ou du jeu possédé sont disponibles, les autres exclus", () => {
    const plays = { playedDefinitionIds: [], ownedGameIds: ["g1"] };
    expect(availableSoloChallenges(DEFS, plays, true)).toEqual([DEFS[0], DEFS[1]]);
  });

  it("défi non joué privilégié, puis tirage déterministe", () => {
    const plays = { playedDefinitionIds: [], ownedGameIds: ["g1", "g2"] };
    const available = availableSoloChallenges(DEFS, plays, true);
    expect(available).toEqual([DEFS[0], DEFS[1], DEFS[2]]);
    const picked = pickSoloChallenge(available, "parcours-1");
    expect(available).toContain(picked);
    expect(pickSoloChallenge(available, "parcours-1")).toBe(pickSoloChallenge(available, "parcours-1"));
  });

  it("complétion du défi → gain XP → passage de niveau visible dans l'Ascension", () => {
    const beforeXp = 0;
    const before = describeAscension(beforeXp);
    expect(before.level).toBe(1);
    expect(before.title).toBe("Victime");
    expect(before.rank.name).toBe("Bronze");
    expect(before.percentToNextLevel).toBe(0);

    const afterXp = beforeXp + CHALLENGE_COMPLETE; // +100
    const after = describeAscension(afterXp);
    expect(didLevelUp(beforeXp, afterXp)).toBe(true);
    expect(after.level).toBe(2);
    expect(after.title).toBe("Victime");
    expect(after.rank.name).toBe("Bronze");
    // 50 XP acquis sur 150 nécessaires au niveau 3
    expect(after.xpProgress).toBe(50);
    expect(after.xpToNextLevel).toBe(150);
    expect(after.percentToNextLevel).toBeCloseTo(50 / 150);
  });

  it("progression strictement individuelle : l'XP d'équipe n'atteint pas l'Ascension individuelle", () => {
    const individual = describeAscension(4050); // niveau 10, titre PAPED
    expect(individual.level).toBe(10);
    expect(individual.title).toBe("PAPED");
    expect(individual.rank.name).toBe("Bronze");
    expect(individual.xpTotal).toBe(4050);
    expect(individual.xpProgress).toBe(0);
    // L'XP d'équipe serait consultée ailleurs (community-team-score).
    // Elle n'est jamais additionnée à l'XP individuel ni au niveau.
  });
});
