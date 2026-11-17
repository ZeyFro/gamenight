import { describe, expect, it } from "vitest";
import {
  availableSoloChallenges,
  pickSoloChallenge,
  toSoloChallengeAssignment,
  attemptStatus,
} from "./tower-challenges-domain";

describe("tower-challenges-domain (logique pure, hors migration)", () => {
  const DEFS = [
    { id: "c1", title: "A", instructions: "x", rewardFloors: 1, gameId: null },
    { id: "c2", title: "B", instructions: "x", rewardFloors: 2, gameId: "g1" },
    { id: "c3", title: "C", instructions: "x", rewardFloors: 2, gameId: "g2" },
  ] as const;

  it("les défis sans gameId sont jouables par tout le monde", () => {
    expect(availableSoloChallenges(DEFS, { playedDefinitionIds: [], ownedGameIds: [] })).toEqual([
      DEFS[0],
    ]);
  });

  it("les défis avec un gameId sont jouables uniquement si possédés", () => {
    expect(availableSoloChallenges(DEFS, { playedDefinitionIds: [], ownedGameIds: ["g1"] })).toEqual([
      DEFS[0],
      DEFS[1],
    ]);
  });

  it("préfère les défis non joués quand disponibles", () => {
    expect(availableSoloChallenges(DEFS, { playedDefinitionIds: ["c2"], ownedGameIds: ["g1"] }, true)).toEqual([
      DEFS[0],
    ]);
  });

  it("retombe sur les défis joués si aucun non joué n'est disponible", () => {
    expect(availableSoloChallenges(DEFS, { playedDefinitionIds: ["c1"], ownedGameIds: [] }, true)).toEqual([
      DEFS[0],
    ]);
  });

  it("les défis sans jeu possédé restent exclus même sans pref enum", () => {
    expect(availableSoloChallenges(DEFS, { playedDefinitionIds: [], ownedGameIds: ["g1"] }, false)).toEqual([
      DEFS[0],
      DEFS[1],
    ]);
  });

  it("tri déterministe par id", () => {
    const inAnyOrder = [DEFS[2], DEFS[0], DEFS[1]];
    expect(availableSoloChallenges(inAnyOrder, { playedDefinitionIds: [], ownedGameIds: ["g1", "g2"] })).toEqual([
      DEFS[0],
      DEFS[1],
      DEFS[2],
    ]);
  });
});

describe("pickSoloChallenge", () => {
  const DEFS = [
    { id: "a", title: "A", instructions: "x", rewardFloors: 1, gameId: null },
    { id: "b", title: "B", instructions: "x", rewardFloors: 2, gameId: null },
    { id: "c", title: "C", instructions: "x", rewardFloors: 3, gameId: null },
  ] as const;

  it("retourne null si aucun défi disponible", () => {
    expect(pickSoloChallenge([])).toBeNull();
  });

  it("retourne le premier sans seed", () => {
    expect(pickSoloChallenge(DEFS)).toEqual(DEFS[0]);
  });

  it("retourne un défi déterministe selon le seed", () => {
    const a = pickSoloChallenge(DEFS, "seed1");
    const b = pickSoloChallenge(DEFS, "seed1");
    expect(a).toBe(b);
    expect(DEFS).toContain(a);
  });

  it("à égalité de seed, même résultat", () => {
    expect(pickSoloChallenge([DEFS[0], DEFS[1]], "s")).toBe(
      pickSoloChallenge([DEFS[0], DEFS[1]], "s")
    );
  });
});

describe("toSoloChallengeAssignment", () => {
  it("projète une définition sur une assignment", () => {
    const d = { id: "c1", title: "A", instructions: "x", rewardFloors: 2, gameId: null };
    expect(toSoloChallengeAssignment(d)).toEqual({
      definitionId: "c1",
      title: "A",
      instructions: "x",
      rewardFloors: 2,
    });
  });
});

describe("attemptStatus", () => {
  const now = new Date(2026, 10, 17, 12, 0, 0);

  it("pending si non soumis et dans le délai", () => {
    const assigned = new Date(2026, 10, 17, 12, 0, 0);
    expect(attemptStatus(assigned, now, false)).toEqual({
      kind: "pending",
      assignedAt: assigned,
      expiresAt: new Date(2026, 10, 19, 12, 0, 0),
    });
  });

  it("expired si hors délai sans soumission", () => {
    const assigned = new Date(2026, 10, 15, 12, 0, 0);
    expect(attemptStatus(assigned, now, false)).toEqual({ kind: "expired" });
  });

  it("submitted si soumis (quelle que soit la date)", () => {
    const assigned = new Date(2026, 10, 15, 12, 0, 0);
    expect(attemptStatus(assigned, now, true)).toEqual({ kind: "submitted" });
  });
});
