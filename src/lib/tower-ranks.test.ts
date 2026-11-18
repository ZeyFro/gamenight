import { describe, expect, it } from "vitest";
import {
  compareTowerRanks, getTowerPersonalRank, nextTowerRankStep, TOWER_HIGH_RANKER_FLOORS, TOWER_HIGH_RANKER_SEASON_CHALLENGES,
  TOWER_RANKER_FLOORS, TOWER_RANK_PRESENTATION,
} from "./tower-ranks";

describe("grades Tower (décisions du 17/11/2026)", () => {
  it.each([
    [0, 0, "Régulars"], [1, 0, "Régulars"], [29, 10, "Régulars"], [30, 0, "Ranker"],
    [99, 9, "Ranker"], [100, 0, "Ranker"], [100, 4, "Ranker"], [100, 5, "High Ranker"],
    [150, 5, "High Ranker"], [99, 5, "Ranker"],
  ] as const)("%i étages, %i défis sur la saison : %s", (floor, challenges, expected) => {
    expect(getTowerPersonalRank(floor, challenges)).toBe(expected);
  });
  it("Irregular n'est jamais déduit : attribution manuelle, prestige sans droit, dépassé par un grade gagné", () => {
    expect(getTowerPersonalRank(0, 0)).toBe("Régulars");
    expect(getTowerPersonalRank(5, 0, { irregularGranted: true })).toBe("Irregular");
    expect(getTowerPersonalRank(30, 0, { irregularGranted: true })).toBe("Ranker");
    expect(getTowerPersonalRank(100, 5, { irregularGranted: true })).toBe("High Ranker");
  });
  it("ne tolère pas une progression invalide", () => {
    expect(() => getTowerPersonalRank(-1, 0)).toThrow(RangeError);
    expect(() => getTowerPersonalRank(20, -1)).toThrow(RangeError);
    expect(() => getTowerPersonalRank(20, 1.5)).toThrow(RangeError);
  });
  it("garde les seuils décidés : 30 étages, 100 étages et 5 défis de la saison", () => {
    expect([TOWER_RANKER_FLOORS, TOWER_HIGH_RANKER_FLOORS, TOWER_HIGH_RANKER_SEASON_CHALLENGES]).toEqual([30, 100, 5]);
  });
  it.each([
    [0, 0, { rank: "Ranker", floorsMissing: "30", challengesMissing: 0 }],
    [29, 3, { rank: "Ranker", floorsMissing: "1", challengesMissing: 0 }],
    [30, 0, { rank: "High Ranker", floorsMissing: "70", challengesMissing: 5 }],
    [99, 2, { rank: "High Ranker", floorsMissing: "1", challengesMissing: 3 }],
    [100, 4, { rank: "High Ranker", floorsMissing: "0", challengesMissing: 1 }],
    [250, 0, { rank: "High Ranker", floorsMissing: "0", challengesMissing: 5 }],
    [100, 5, null],
  ] as const)("%i étages, %i défis : prochaine marche %o", (floor, challenges, expected) => {
    expect(nextTowerRankStep(floor, challenges)).toEqual(expected);
  });
  it("accepte les grands étages en bigint et refuse une progression invalide pour la prochaine marche", () => {
    expect(nextTowerRankStep(BigInt("9007199254740993"), 0)).toEqual({ rank: "High Ranker", floorsMissing: "0", challengesMissing: 5 });
    expect(() => nextTowerRankStep(-1, 0)).toThrow(RangeError);
    expect(() => nextTowerRankStep(10, 1.5)).toThrow(RangeError);
  });
  it("couleurs décidées : gris, violet, or, rouge", () => {
    expect(Object.fromEntries(Object.entries(TOWER_RANK_PRESENTATION).map(([rank, value]) => [rank, value.colorName]))).toEqual({
      "Régulars": "gris", Irregular: "violet", Ranker: "or", "High Ranker": "rouge",
    });
  });
  it("aucun grade ne porte de droit : la présentation n'expose que des couleurs", () => {
    for (const value of Object.values(TOWER_RANK_PRESENTATION)) expect(Object.keys(value).sort()).toEqual(["colorName", "hex"]);
  });
  it("compare les quatre grades dans l'ordre de la hiérarchie", () => {
    expect(compareTowerRanks("Régulars", "Irregular") < 0).toBe(true);
    expect(compareTowerRanks("Irregular", "Ranker") < 0).toBe(true);
    expect(compareTowerRanks("Ranker", "High Ranker") < 0).toBe(true);
    expect(compareTowerRanks("High Ranker", "Régulars") > 0).toBe(true);
    expect(compareTowerRanks("Ranker", "Ranker")).toBe(0);
    expect(() => compareTowerRanks("Boss" as never, "Ranker")).toThrow(RangeError);
    expect(() => compareTowerRanks("Ranker", "toString" as never)).toThrow(RangeError);
  });
});
