import { describe, expect, it } from "vitest";
import { getLastCompletedTowerSeason, listEndedTowerSeasons, TOWER_ENDED_SEASONS_LIMIT } from "./tower-season-podium-rules";

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

describe("saisons Tower finies à consulter, de la plus récente à la plus ancienne", () => {
  const names = (current: string, earliest: string | null, limit?: number) =>
    listEndedTowerSeasons(new Date(current), earliest ? new Date(earliest) : null, limit).map(season => season.name);

  it("sans aucun crédit, ne propose que la dernière saison finie", () => {
    expect(names("2027-07-10T12:00:00Z", null)).toEqual(["S2 · 2027"]);
  });
  it("remonte jusqu'à la saison du premier crédit, été compris, sans saison en cours", () => {
    expect(names("2027-10-10T12:00:00Z", "2027-02-10T10:00:00Z")).toEqual(["Été · 2027", "S2 · 2027", "S1 · 2027"]);
    expect(names("2028-02-01T12:00:00Z", "2027-02-10T10:00:00Z")).toEqual(["S4 · 2027", "Été · 2027", "S2 · 2027", "S1 · 2027"]);
  });
  it("s'arrête à la saison qui contient le premier crédit, à la milliseconde de son début", () => {
    // S2 2027 commence le 1er avril 00:00 Paris (31 mars 22:00 UTC).
    expect(names("2027-10-10T12:00:00Z", "2027-03-31T22:00:00.000Z")).toEqual(["Été · 2027", "S2 · 2027"]);
    expect(names("2027-10-10T12:00:00Z", "2027-03-31T21:59:59.999Z")).toEqual(["Été · 2027", "S2 · 2027", "S1 · 2027"]);
  });
  it("un premier crédit dans la saison en cours ne fait remonter aucune saison supplémentaire", () => {
    expect(names("2027-07-10T12:00:00Z", "2027-07-05T10:00:00Z")).toEqual(["S2 · 2027"]);
  });
  it("ne renvoie que des saisons finies, contiguës et marquées inactives", () => {
    const current = new Date("2028-05-01T12:00:00Z");
    const seasons = listEndedTowerSeasons(current, new Date("2026-09-10T10:00:00Z"));
    expect(seasons.map(season => season.name)).toEqual(["S1 · 2028", "S4 · 2027", "Été · 2027", "S2 · 2027", "S1 · 2027", "S4 · 2026"]);
    for (const season of seasons) {
      expect(season.active).toBe(false);
      expect(season.endAt.getTime()).toBeLessThanOrEqual(current.getTime());
    }
    for (let index = 1; index < seasons.length; index++) expect(seasons[index].endAt.getTime()).toBeLessThanOrEqual(seasons[index - 1].startAt.getTime());
  });
  it("plafonne le nombre de saisons proposées", () => {
    expect(names("2031-05-01T12:00:00Z", "2020-01-10T10:00:00Z")).toHaveLength(TOWER_ENDED_SEASONS_LIMIT);
    expect(names("2031-05-01T12:00:00Z", "2020-01-10T10:00:00Z", 2)).toEqual(["S1 · 2031", "S4 · 2030"]);
  });
  it("refuse des paramètres invalides", () => {
    expect(() => listEndedTowerSeasons(new Date(NaN), null)).toThrow(RangeError);
    expect(() => listEndedTowerSeasons(new Date("2027-07-10T12:00:00Z"), new Date(NaN))).toThrow(RangeError);
    expect(() => listEndedTowerSeasons(new Date("2027-07-10T12:00:00Z"), null, 0)).toThrow(RangeError);
  });
});
