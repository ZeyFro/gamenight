import { describe, expect, it } from "vitest";
import { parseWishlistPurchasePlanInput } from "./wishlist-purchase-plan";
import * as m_p06 from "./wishlist-purchase-plan";

describe("wishlist purchase plan input", () => {
  const now = new Date("2026-10-17T08:00:00Z");

  it("accepts a future calendar date and trims the optional note", () => {
    expect(parseWishlistPurchasePlanInput("2026-10-18", "  Jouer ensemble  ", now)).toEqual({
      targetDate: new Date("2026-10-18T12:00:00.000Z"),
      note: "Jouer ensemble",
    });
    expect(parseWishlistPurchasePlanInput("2026-10-17", " ", now)).toEqual({
      targetDate: new Date("2026-10-17T12:00:00.000Z"),
      note: null,
    });
  });

  it("rejects malformed, impossible or past dates and overlong notes", () => {
    expect(parseWishlistPurchasePlanInput("2026-2-01", "", now)).toBeNull();
    expect(parseWishlistPurchasePlanInput("2026-02-30", "", now)).toBeNull();
    expect(parseWishlistPurchasePlanInput("2026-10-16", "", now)).toBeNull();
    expect(parseWishlistPurchasePlanInput("2026-10-18", "x".repeat(301), now)).toBeNull();
  });
});

// Tâche Qwen qwen-p06-wishlist-note — repris du test de preuve loop/checks (node:test) sous vitest.
describe("wishlist-purchase-plan · p06-wishlist-note", () => {
  const now = new Date('2026-11-15T10:00:00Z');
  it('le comportement existant est conserve', () => {
    expect(m_p06.parseWishlistPurchasePlanInput('2026-12-25', 'Noël', now)).toEqual({ targetDate: new Date(Date.UTC(2026, 11, 25, 12)), note: 'Noël' });
    expect(m_p06.parseWishlistPurchasePlanInput('2026-12-25', '   ', now)!.note).toBe(null);
    expect(m_p06.parseWishlistPurchasePlanInput('2026-02-30', 'x', now)).toBe(null);
    expect(m_p06.parseWishlistPurchasePlanInput('2026-11-14', 'x', now)).toBe(null);
    expect(m_p06.parseWishlistPurchasePlanInput('2026-12-25', 42, now)).toBe(null);
  });
  it('les espaces multiples, tabulations et retours a la ligne sont ramenes a un espace', () => {
    expect(m_p06.parseWishlistPurchasePlanInput('2026-12-25', '  Noël\t\t 2026 \n  budget  ', now)!.note).toBe('Noël 2026 budget');
  });
  it('les caracteres de controle ne subsistent pas', () => {
    expect(m_p06.parseWishlistPurchasePlanInput('2026-12-25', 'a\u0007b', now)!.note).toBe('a b');
  });
  it('la longueur maximale se mesure sur la note nettoyee', () => {
    const spaced = 'a  '.repeat(120);
    const cleaned = m_p06.parseWishlistPurchasePlanInput('2026-12-25', spaced, now);
    expect(cleaned!.note).toBe('a '.repeat(119) + 'a');
    expect(m_p06.parseWishlistPurchasePlanInput('2026-12-25', 'x'.repeat(301), now)).toBe(null);
    expect(m_p06.parseWishlistPurchasePlanInput('2026-12-25', 'x'.repeat(300), now)!.note!.length).toBe(300);
  });
});
