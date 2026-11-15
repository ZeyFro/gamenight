import { describe, expect, it } from "vitest";
import { getTowerPersonalRank, nextTowerRankStep, TOWER_HIGH_RANKER_FLOORS, TOWER_RANKER_FLOORS, TOWER_RANK_PRESENTATION } from "./tower-ranks";
describe("rangs personnels Tower", () => {
  it.each([
    [0, 0, "Irregular"], [1, 0, "Irregular"], [29, 10, "Irregular"], [30, 0, "Ranker"],
    [99, 1, "Ranker"], [100, 0, "Ranker"], [100, 1, "High Ranker"],
    [150, 5, "High Ranker"],
  ] as const)("étage %i, %i saisons terminées : %s", (floor, seasons, expected) => {
    expect(getTowerPersonalRank(floor, seasons)).toBe(expected);
  });
  it("ne tolère pas une progression invalide", () => {
    expect(() => getTowerPersonalRank(-1, 0)).toThrow(RangeError);
    expect(() => getTowerPersonalRank(20, -1)).toThrow(RangeError);
  });
  it("garde les seuils décidés : 30 étages gagnés pour Ranker, 100 pour High Ranker", () => {
    expect([TOWER_RANKER_FLOORS, TOWER_HIGH_RANKER_FLOORS]).toEqual([30, 100]);
  });
  it.each([
    [0, 0, { rank: "Ranker", floorsMissing: "30", seasonMissing: false }],
    [29, 3, { rank: "Ranker", floorsMissing: "1", seasonMissing: false }],
    [30, 0, { rank: "High Ranker", floorsMissing: "70", seasonMissing: true }],
    [99, 1, { rank: "High Ranker", floorsMissing: "1", seasonMissing: false }],
    [100, 0, { rank: "High Ranker", floorsMissing: "0", seasonMissing: true }],
    [250, 0, { rank: "High Ranker", floorsMissing: "0", seasonMissing: true }],
    [100, 1, null],
  ] as const)("étage %i, %i saisons terminées : prochaine marche %o", (floor, seasons, expected) => {
    expect(nextTowerRankStep(floor, seasons)).toEqual(expected);
  });
  it("accepte les grands étages en bigint et refuse une progression invalide pour la prochaine marche", () => {
    expect(nextTowerRankStep(BigInt("9007199254740993"), 0)).toEqual({ rank: "High Ranker", floorsMissing: "0", seasonMissing: true });
    expect(() => nextTowerRankStep(-1, 0)).toThrow(RangeError);
    expect(() => nextTowerRankStep(10, 1.5)).toThrow(RangeError);
  });
  it("réserve la couleur officielle du Ranker", () => {
    expect(TOWER_RANK_PRESENTATION.Ranker.hex).toBe("#8b5cf6");
  });
});
