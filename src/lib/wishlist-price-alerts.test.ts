import { describe, expect, it } from "vitest";
import { parseSteamPriceAlertThreshold, shouldSendSteamPriceAlert } from "./wishlist-price-alerts";

describe("wishlist Steam price alerts", () => {
  it("requires the configured discount and honors the seven-day cooldown", () => {
    const now = new Date("2026-10-17T12:00:00Z");
    expect(shouldSendSteamPriceAlert(20, 20, null, now)).toBe(true);
    expect(shouldSendSteamPriceAlert(19, 20, null, now)).toBe(false);
    expect(shouldSendSteamPriceAlert(50, 20, new Date(now.getTime() - 6 * 86_400_000), now)).toBe(false);
    expect(shouldSendSteamPriceAlert(20, 20, new Date(now.getTime() - 7 * 86_400_000), now)).toBe(true);
  });

  it("validates an admin threshold from 5 to 80 percent", () => {
    expect(parseSteamPriceAlertThreshold("20")).toBe(20);
    expect(parseSteamPriceAlertThreshold("4")).toBeNull();
    expect(parseSteamPriceAlertThreshold("81")).toBeNull();
    expect(parseSteamPriceAlertThreshold("20.5")).toBeNull();
  });
});
