import { describe, it, expect } from "vitest";
import { nextSeasonNumber } from "@/lib/seasons";

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
