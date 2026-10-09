import { describe, expect, it } from "vitest";
import { normalizeAdjustmentReason, parseXpValue, XP_ADJUSTMENT_MAX, XP_ADJUSTMENT_REASON_MAX } from "./admin-xp";

describe("correction d'XP : validation des champs", () => {
  it("accepte un entier d'XP de 0 à la borne, espaces autour tolérés", () => {
    expect(parseXpValue("0")).toBe(0);
    expect(parseXpValue(" 1596 ")).toBe(1596);
    expect(parseXpValue(String(XP_ADJUSTMENT_MAX))).toBe(XP_ADJUSTMENT_MAX);
  });

  it("refuse négatif, décimal, notation scientifique, vide, trop grand ou non texte", () => {
    for (const bad of ["-1", "1.5", "1e3", "", "  ", "abc", "10000001", "123456789", "+5", "0x10"]) {
      expect(parseXpValue(bad), bad).toBeNull();
    }
    expect(parseXpValue(null)).toBeNull();
    expect(parseXpValue(42)).toBeNull();
  });

  it("raison : rognée, vide → null, limite de longueur, refus d'un type inattendu", () => {
    expect(normalizeAdjustmentReason("  abus de création  ")).toEqual({ ok: true, reason: "abus de création" });
    expect(normalizeAdjustmentReason("   ")).toEqual({ ok: true, reason: null });
    expect(normalizeAdjustmentReason(null)).toEqual({ ok: true, reason: null });
    expect(normalizeAdjustmentReason("x".repeat(XP_ADJUSTMENT_REASON_MAX))).toMatchObject({ ok: true });
    expect(normalizeAdjustmentReason("x".repeat(XP_ADJUSTMENT_REASON_MAX + 1))).toEqual({ ok: false });
    expect(normalizeAdjustmentReason(12)).toEqual({ ok: false });
  });
});
