import { describe, it, expect } from "vitest";
import {
  bracketSizeFor,
  totalRoundsFor,
  computeMatchLoser,
  computeNextSlot,
} from "@/lib/tournaments";

describe("bracketSizeFor (Sprint 5, Tournois Bracket)", () => {
  it("retourne maxPlayers tel quel quand c'est déjà une puissance de 2", () => {
    expect(bracketSizeFor(4)).toBe(4);
    expect(bracketSizeFor(8)).toBe(8);
  });

  it("arrondit à la puissance de 2 supérieure sinon (6 joueurs -> bracket à 8 slots)", () => {
    expect(bracketSizeFor(6)).toBe(8);
  });
});

describe("totalRoundsFor", () => {
  it("calcule le nombre de rounds pour chaque taille de bracket supportée", () => {
    expect(totalRoundsFor(4)).toBe(2);
    expect(totalRoundsFor(8)).toBe(3);
  });
});

describe("computeMatchLoser (PR Atomicité saisons + tournois)", () => {
  it("le perdant est l'autre joueur quand le gagnant est player1", () => {
    expect(computeMatchLoser("p1", "p1", "p2")).toBe("p2");
  });

  it("le perdant est l'autre joueur quand le gagnant est player2", () => {
    expect(computeMatchLoser("p2", "p1", "p2")).toBe("p1");
  });

  it("renvoie null si l'autre slot est vide (bye)", () => {
    expect(computeMatchLoser("p1", "p1", null)).toBeNull();
  });
});

describe("computeNextSlot (PR Atomicité saisons + tournois)", () => {
  it("position paire -> player1Id du match floor(position/2) du round suivant", () => {
    expect(computeNextSlot(1, 0)).toEqual({ nextRound: 2, nextPosition: 0, field: "player1Id" });
    expect(computeNextSlot(1, 2)).toEqual({ nextRound: 2, nextPosition: 1, field: "player1Id" });
  });

  it("position impaire -> player2Id du même match floor(position/2) du round suivant", () => {
    expect(computeNextSlot(1, 1)).toEqual({ nextRound: 2, nextPosition: 0, field: "player2Id" });
    expect(computeNextSlot(1, 3)).toEqual({ nextRound: 2, nextPosition: 1, field: "player2Id" });
  });

  it("2 matchs consécutifs du round N convergent vers le même match du round N+1", () => {
    expect(computeNextSlot(2, 0).nextPosition).toBe(computeNextSlot(2, 1).nextPosition);
    expect(computeNextSlot(2, 0).nextRound).toBe(computeNextSlot(2, 1).nextRound);
  });
});
