import { describe, expect, it } from "vitest";
import { getTowerSchoolSeason } from "./tower-challenge-seasons";
import * as m_p18 from "./tower-challenge-seasons";

describe("calendrier The Tower (décision du 17/11/2026) — fuseau Europe/Paris", () => {
  it.each([
    // Veille du lancement : S3 2026 (sept.–nov.), toujours active.
    ["2026-11-30T22:59:59.999Z", "S3 · 2026"],
    // Lancement : minuit Paris du 1er décembre 2026 (CET = UTC+1) → S1.
    ["2026-11-30T23:00:00Z", "S1 · 2026-2027"],
    ["2026-12-03T10:00:00Z", "S1 · 2026-2027"],
    ["2027-01-02T12:00:00Z", "S1 · 2026-2027"],
    ["2027-03-31T21:59:59.999Z", "S1 · 2026-2027"],
    ["2027-03-31T22:00:00Z", "S2 · 2027"],
    ["2027-06-30T21:59:59.999Z", "S2 · 2027"],
    ["2027-06-30T22:00:00Z", "Été · 2027"],
    ["2027-08-31T21:59:59.999Z", "Été · 2027"],
    ["2027-08-31T22:00:00Z", "S3 · 2027"],
    ["2027-11-30T22:59:59.999Z", "S3 · 2027"],
    ["2027-11-30T23:00:00Z", "S1 · 2027-2028"],
  ])("à %s : %s, toujours active", (iso, name) => {
    expect(getTowerSchoolSeason(new Date(iso))).toMatchObject({ name, active: true });
  });
  it("S1 2026-2027 va du 1er décembre 2026 00:00 au 1er avril 2027 00:00 (fin exclusive), CET puis CEST", () => {
    expect(getTowerSchoolSeason(new Date("2026-12-01T09:00:00Z"))).toMatchObject({
      startAt: new Date("2026-11-30T23:00:00Z"), // CET
      endAt: new Date("2027-03-31T22:00:00Z"), // CEST (changement d'heure le 28 mars 2027)
    });
  });
  it("S3 se termine à minuit Paris en heure d'hiver, S2 et l'été à minuit en heure d'été", () => {
    expect(getTowerSchoolSeason(new Date("2027-10-01T10:00:00Z"))).toMatchObject({
      startAt: new Date("2027-08-31T22:00:00Z"), endAt: new Date("2027-11-30T23:00:00Z"),
    });
    expect(getTowerSchoolSeason(new Date("2027-05-01T10:00:00Z"))).toMatchObject({
      startAt: new Date("2027-03-31T22:00:00Z"), endAt: new Date("2027-06-30T22:00:00Z"),
    });
  });
  it("les saisons se suivent sans trou ni chevauchement sur plusieurs années", () => {
    let now = new Date("2026-12-01T12:00:00Z");
    for (let i = 0; i < 12; i++) {
      const current = getTowerSchoolSeason(now);
      const next = getTowerSchoolSeason(current.endAt);
      expect(next.startAt).toEqual(current.endAt);
      expect(getTowerSchoolSeason(new Date(current.endAt.getTime() - 1)).name).toBe(current.name);
      now = current.endAt;
    }
  });
  it("rejette les dates invalides", () => {
    expect(() => getTowerSchoolSeason(new Date(NaN))).toThrow(RangeError);
  });
});

describe("tower-challenge-seasons · jours restants", () => {
  it('jours restants dans la saison', () => {
    expect(m_p18.daysLeftInTowerSeason(new Date('2027-06-29T22:00:00Z'))).toBe(1);
    expect(m_p18.daysLeftInTowerSeason(new Date('2027-06-30T10:00:00Z'))).toBe(1);
    expect(m_p18.daysLeftInTowerSeason(new Date('2027-06-15T22:00:00Z'))).toBe(15);
    expect(m_p18.daysLeftInTowerSeason(new Date('2027-03-31T21:00:00Z'))).toBe(1);
    expect(() => m_p18.daysLeftInTowerSeason(new Date(NaN))).toThrow(RangeError);
  });
});
