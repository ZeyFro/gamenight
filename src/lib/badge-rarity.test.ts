import { describe, expect, it } from "vitest";
import {
  BADGE_XP_BY_RARITY,
  CATEGORY_LABELS,
  CRITERIA_TYPES,
  CRITERIA_TYPE_LABELS,
  RARITY_LABELS,
} from "./badge-rarity";

describe("badge-rarity", () => {
  it("l'XP croît strictement avec la rareté", () => {
    const { COMMON, RARE, EPIC, LEGENDARY } = BADGE_XP_BY_RARITY;
    expect(COMMON).toBeLessThan(RARE);
    expect(RARE).toBeLessThan(EPIC);
    expect(EPIC).toBeLessThan(LEGENDARY);
  });

  it("chaque rareté et catégorie a un libellé FR non vide", () => {
    expect(Object.keys(RARITY_LABELS).sort()).toEqual(
      Object.keys(BADGE_XP_BY_RARITY).sort()
    );
    for (const label of [...Object.values(RARITY_LABELS), ...Object.values(CATEGORY_LABELS)]) {
      expect(label.trim()).not.toBe("");
    }
  });

  it("CRITERIA_TYPES liste les 7 types de critère", () => {
    expect(CRITERIA_TYPES).toEqual(Object.keys(CRITERIA_TYPE_LABELS));
    expect(CRITERIA_TYPES).toHaveLength(7);
    expect(CRITERIA_TYPES).toContain("STREAK_DAYS");
  });
});
