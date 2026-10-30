import { describe, expect, it } from "vitest";
import { getTowerSchoolSeason } from "./tower-challenge-seasons";

describe("calendrier commun Tower Europe/Paris", () => {
  it("utilise les trimestres standards et les minuits de Paris", () => {
    expect(getTowerSchoolSeason(new Date("2026-09-01T12:00:00Z"))).toMatchObject({
      name: "Trimestre 1 · 2026-2027", startAt: new Date("2026-08-31T22:00:00Z"),
      endAt: new Date("2026-12-31T23:00:00Z"), active: true,
    });
    expect(getTowerSchoolSeason(new Date("2027-01-01T12:00:00Z"))).toMatchObject({
      name: "Trimestre 2 · 2026-2027", startAt: new Date("2026-12-31T23:00:00Z"),
      endAt: new Date("2027-03-31T22:00:00Z"), active: true,
    });
    expect(getTowerSchoolSeason(new Date("2027-04-01T12:00:00Z"))).toMatchObject({
      name: "Trimestre 3 · 2026-2027", startAt: new Date("2027-03-31T22:00:00Z"),
      endAt: new Date("2027-06-30T22:00:00Z"), active: true,
    });
  });

  it("conserve le dernier classement pendant l'intersaison", () => {
    const july = getTowerSchoolSeason(new Date("2027-07-15T12:00:00Z"));
    expect(july).toMatchObject({ name: "Trimestre 3 · 2026-2027", active: false });
    expect(() => getTowerSchoolSeason(new Date(NaN))).toThrow(RangeError);
  });
});
