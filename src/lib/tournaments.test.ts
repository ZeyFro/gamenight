import { describe, it, expect } from "vitest";
import { bracketSizeFor, totalRoundsFor } from "@/lib/tournaments";

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
