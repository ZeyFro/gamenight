import { describe, expect, it } from "vitest";
import { getTowerPersonalRank, TOWER_RANK_PRESENTATION } from "./tower-ranks";
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
  it("réserve la couleur officielle du Ranker", () => {
    expect(TOWER_RANK_PRESENTATION.Ranker.hex).toBe("#8b5cf6");
  });
});
