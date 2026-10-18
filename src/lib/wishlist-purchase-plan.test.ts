import { describe, expect, it } from "vitest";
import { parseWishlistPurchasePlanInput } from "./wishlist-purchase-plan";

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
