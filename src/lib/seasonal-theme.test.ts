import { describe, expect, it } from "vitest";
import { getSeasonalTheme } from "./seasonal-theme";

describe("getSeasonalTheme", () => {
  it.each([
    ["2026-10-25T00:00:00Z", "halloween"],
    ["2026-11-01T00:00:00Z", "halloween"],
    ["2026-11-02T00:00:00Z", null],
    ["2026-12-20T00:00:00Z", "noel"],
    ["2026-12-26T23:59:00Z", "noel"],
    ["2026-12-27T00:00:00Z", null],
    ["2026-07-01T00:00:00Z", "marathon-ete"],
    ["2026-07-08T00:00:00Z", null],
  ] as const)("maps %s to %s", (iso, theme) => {
    expect(getSeasonalTheme(new Date(iso))).toBe(theme);
  });
});
