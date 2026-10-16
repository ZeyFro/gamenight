import { describe, expect, it } from "vitest";
import { expandCommunityDates, expandGameAwards, expandGameReleaseDates, type CommunityDateInput } from "./community-dates";

const date = (fields: Partial<CommunityDateInput>): CommunityDateInput => ({
  id: "date", title: "Soirée importante", kind: "IMPORTANT", date: new Date("2026-12-31T00:00:00Z"),
  repeatsAnnually: false, createdById: "owner", member: null, ...fields,
});

describe("expandCommunityDates", () => {
  it("expands annual community dates into only the requested range", () => {
    const events = expandCommunityDates([
      date({ date: new Date("2000-12-31T00:00:00Z"), repeatsAnnually: true }),
    ], new Date("2026-12-01T00:00:00Z"), new Date("2027-02-01T00:00:00Z"));
    expect(events.map(({ date: occurrence }) => occurrence.toISOString())).toEqual(["2026-12-31T00:00:00.000Z"]);
  });

  it("shows birthdays without storing a birth year and maps leap day to February 28", () => {
    const events = expandCommunityDates([
      date({ kind: "BIRTHDAY", title: null, member: { discordName: "Pote" }, date: new Date("2000-02-29T00:00:00Z"), repeatsAnnually: true }),
    ], new Date("2027-02-01T00:00:00Z"), new Date("2027-03-01T00:00:00Z"));
    expect(events).toEqual([expect.objectContaining({ title: "Anniversaire · Pote", date: new Date("2027-02-28T00:00:00Z") })]);
  });
});

describe("expandGameReleaseDates", () => {
  it("uses the IGDB UTC calendar day and only includes dates in range", () => {
    const events = expandGameReleaseDates([
      { id: "wish", gameId: "game", title: "Jeu attendu", createdById: "owner", igdbDetails: { releaseDate: "2026-12-31T00:00:00.000Z" } },
      { id: "bad", gameId: "bad-game", title: "Sans date", createdById: "owner", igdbDetails: { releaseDate: "à confirmer" } },
      { id: "old", gameId: "old-game", title: "Hors période", createdById: "owner", igdbDetails: { releaseDate: "2027-01-02T00:00:00.000Z" } },
    ], new Date("2026-12-31T00:00:00Z"), new Date("2027-01-02T00:00:00Z"));
    expect(events).toEqual([expect.objectContaining({
      id: "game-release:wish", title: "Sortie · Jeu attendu", kind: "GAME_RELEASE",
      date: new Date("2026-12-31T00:00:00Z"), href: "/jeux/game",
    })]);
  });
});

describe("expandGameAwards", () => {
  it("adds the official 2026 date as a UTC calendar day only in its range", () => {
    expect(expandGameAwards(new Date("2026-12-10T00:00:00Z"), new Date("2026-12-11T00:00:00Z"))).toEqual([
      expect.objectContaining({ id: "game-awards:2026", title: "The Game Awards 2026", kind: "GAME_AWARDS", date: new Date("2026-12-10T00:00:00Z") }),
    ]);
    expect(expandGameAwards(new Date("2026-12-11T00:00:00Z"), new Date("2026-12-12T00:00:00Z"))).toEqual([]);
  });
});
