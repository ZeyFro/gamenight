import { describe, expect, it } from "vitest";
import { getLastCompletedTowerSeason } from "./tower-season-podium-rules";

describe("dernière saison Tower terminée, heure de Paris", () => {
  it.each([
    ["2027-01-01T00:00:00Z", "S4 · 2026", "2026-12-31T23:00:00Z"],
    ["2027-01-03T23:00:00Z", "S4 · 2026", "2026-12-31T23:00:00Z"],
    ["2027-03-28T21:59:59.999Z", "S4 · 2026", "2026-12-31T23:00:00Z"],
    ["2027-03-28T22:00:00Z", "S1 · 2027", "2027-03-28T22:00:00Z"],
    ["2027-03-31T22:00:00Z", "S1 · 2027", "2027-03-28T22:00:00Z"],
    ["2027-06-30T21:59:59.999Z", "S1 · 2027", "2027-03-28T22:00:00Z"],
    ["2027-06-30T22:00:00Z", "S2 · 2027", "2027-06-30T22:00:00Z"],
    ["2027-08-31T22:00:00Z", "Été · 2027", "2027-08-31T22:00:00Z"],
    ["2027-12-31T23:00:00Z", "S4 · 2027", "2027-12-31T23:00:00Z"],
  ])("à %s, présente %s", (iso, name, end) => {
    const current = new Date(iso);
    const season = getLastCompletedTowerSeason(current);
    expect(season.name).toBe(name);
    expect(season.active).toBe(false);
    expect(season.endAt).toEqual(new Date(end));
    expect(season.endAt.getTime()).toBeLessThanOrEqual(current.getTime());
    expect(season.startAt.getTime()).toBeLessThan(season.endAt.getTime());
  });
  it("refuse une date invalide", () => {
    expect(() => getLastCompletedTowerSeason(new Date(NaN))).toThrow(RangeError);
  });
});
