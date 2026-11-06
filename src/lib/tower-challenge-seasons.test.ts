import { describe, expect, it } from "vitest";
import { getTowerSchoolSeason } from "./tower-challenge-seasons";

describe("calendrier The Tower — fuseau Europe/Paris", () => {
  it.each([
    ["2026-12-31T22:59:59Z", "S4 · 2026", true],
    ["2026-12-31T23:00:00Z", "S4 · 2026", false],
    ["2027-01-03T22:59:59Z", "S4 · 2026", false],
    ["2027-01-03T23:00:00Z", "S1 · 2027", true],
    ["2027-03-28T21:59:59Z", "S1 · 2027", true],
    ["2027-03-28T22:00:00Z", "S1 · 2027", false],
    ["2027-03-31T22:00:00Z", "S2 · 2027", true],
    ["2027-06-30T22:00:00Z", "Été · 2027", true],
    ["2027-08-31T22:00:00Z", "S4 · 2027", true],
  ])("à %s : %s, active=%s", (iso, name, active) => {
    expect(getTowerSchoolSeason(new Date(iso))).toMatchObject({ name, active });
  });
  it("respecte les heures de Paris et le changement d'heure de mars", () => {
    expect(getTowerSchoolSeason(new Date("2027-01-04T12:00:00Z"))).toMatchObject({
      startAt: new Date("2027-01-03T23:00:00Z"),
      endAt: new Date("2027-03-28T22:00:00Z"),
    });
  });
  it("rejette les dates invalides", () => {
    expect(() => getTowerSchoolSeason(new Date(NaN))).toThrow(RangeError);
  });
});
