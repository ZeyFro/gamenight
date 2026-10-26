import { describe, expect, it } from "vitest";
import { getTowerProgress } from "@/lib/tower-progression";

describe("getTowerProgress", () => {
  it("place les niveaux 1 à 10 au premier étage", () => {
    expect(getTowerProgress(0)).toMatchObject({ floor: 1, level: 1, progress: 0, xpToNextFloor: 5000 });
    expect(getTowerProgress(4050)).toMatchObject({ floor: 1, level: 10, progress: 0.81, xpToNextFloor: 950 });
  });

  it("franchit l'étage au seuil XP exact du niveau 11", () => {
    expect(getTowerProgress(4999)).toMatchObject({ floor: 1, level: 10, progress: 0.9998, xpToNextFloor: 1 });
    expect(getTowerProgress(5000)).toMatchObject({ floor: 2, level: 11, progress: 0, xpToNextFloor: 15000 });
  });

  it("ne dérive pas l'étage quand le total XP est négatif", () => {
    expect(getTowerProgress(-50)).toMatchObject({ floor: 1, level: 1, progress: 0, xpToNextFloor: 5000 });
  });
});
