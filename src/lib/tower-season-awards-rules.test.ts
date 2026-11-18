import { describe, expect, it } from "vitest";
import { getTowerSchoolSeason } from "./tower-challenge-seasons";
import {
  activeTowerAwards, buildTowerSeasonAwards, isTowerSeasonAwardsEnabled, nextTowerSeason, shouldDelayTowerAwards,
  towerAwardExpiry, towerAwardPresentation,
} from "./tower-season-awards-rules";

describe("distinctions saisonnières : règles pures", () => {
  it.each([undefined, "", "false", "TRUE", "1"])("drapeau %o : éteint", value => {
    expect(isTowerSeasonAwardsEnabled({ TOWER_SEASON_AWARDS_ENABLED: value })).toBe(false);
  });
  it("drapeau true : allumé", () => {
    expect(isTowerSeasonAwardsEnabled({ TOWER_SEASON_AWARDS_ENABLED: "true" })).toBe(true);
  });

  describe("durée = jusqu'à la fin de la saison suivante", () => {
    it.each([
      ["2027-02-10T12:00:00Z", "S2 · 2027"],
      ["2027-05-10T12:00:00Z", "Été · 2027"],
      ["2027-08-10T12:00:00Z", "S4 · 2027"],
      ["2027-11-10T12:00:00Z", "S1 · 2028"],
    ])("après la saison de %s vient %s", (date, expected) => {
      expect(nextTowerSeason(getTowerSchoolSeason(new Date(date))).name).toBe(expected);
    });
    it("expire à la fin (exclusive) de la saison suivante", () => {
      const s1 = getTowerSchoolSeason(new Date("2027-02-10T12:00:00Z"));
      expect(towerAwardExpiry(s1).getTime()).toBe(getTowerSchoolSeason(new Date("2027-05-10T12:00:00Z")).endAt.getTime());
    });
  });

  it("présente un titre et un cadre par place du podium, et refuse une autre place", () => {
    expect(towerAwardPresentation(1, "S1 · 2027")).toMatchObject({ title: "Champion · S1 · 2027", frameColorName: "or" });
    expect(towerAwardPresentation(2, "S1 · 2027").title).toBe("Vice-champion · S1 · 2027");
    expect(towerAwardPresentation(3, "S1 · 2027").frameColorName).toBe("bronze");
    expect(() => towerAwardPresentation(4, "x")).toThrow(RangeError);
    expect(() => towerAwardPresentation(0, "x")).toThrow(RangeError);
  });

  it("attribue le podium, ex æquo compris, et rien au-delà de la 3e place", () => {
    const drafts = buildTowerSeasonAwards([
      { startRank: 1, members: [{ userId: "a" }, { userId: "b" }] },
      { startRank: 3, members: [{ userId: "c" }, { userId: "d" }] },
      { startRank: 5, members: [{ userId: "e" }] },
    ]);
    expect(drafts).toEqual([{ userId: "a", place: 1 }, { userId: "b", place: 1 }, { userId: "c", place: 3 }, { userId: "d", place: 3 }]);
    expect(buildTowerSeasonAwards([])).toEqual([]);
  });

  it("retarde l'attribution tant qu'une contestation est ouverte sur la saison (Q7)", () => {
    expect(shouldDelayTowerAwards({ openAppealsInSeason: 0 })).toBe(false);
    expect(shouldDelayTowerAwards({ openAppealsInSeason: 1 })).toBe(true);
  });

  it("ne garde que les distinctions encore valables (fin exclusive), la plus haute place d'abord", () => {
    const now = new Date("2027-05-01T00:00:00Z");
    const list = [
      { place: 3, seasonName: "a", expiresAt: new Date("2027-07-01T00:00:00Z") },
      { place: 1, seasonName: "b", expiresAt: new Date("2027-05-01T00:00:00Z") },
      { place: 2, seasonName: "c", expiresAt: new Date("2027-09-01T00:00:00Z") },
      { place: 1, seasonName: "d", expiresAt: new Date("2027-05-01T00:00:01Z") },
    ];
    expect(activeTowerAwards(list, now).map(award => award.seasonName)).toEqual(["d", "c", "a"]);
  });
});
