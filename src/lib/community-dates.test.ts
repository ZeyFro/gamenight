import { describe, expect, it } from "vitest";
import { expandCommunityDates, expandGameAwards, expandGameReleaseDates, expandSeasonalEvents, expandSteamSales, type CommunityDateInput } from "./community-dates";

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

describe("expandSeasonalEvents", () => {
  it("shows the existing annual event dates only inside the requested range", () => {
    const events = expandSeasonalEvents(new Date("2026-07-01T00:00:00Z"), new Date("2026-10-26T00:00:00Z"));
    expect(events.map(({ id, title, date }) => [id, title, date.toISOString()])).toEqual([
      ["seasonal:2026-7-1", "Marathon d’été", "2026-07-01T00:00:00.000Z"],
      ["seasonal:2026-10-25", "Thème Halloween", "2026-10-25T00:00:00.000Z"],
    ]);
    expect(expandSeasonalEvents(new Date("2026-12-21T00:00:00Z"), new Date("2027-01-01T00:00:00Z"))).toEqual([]);
    expect(expandSeasonalEvents(new Date("2026-12-20T00:00:00Z"), new Date("2026-12-21T00:00:00Z")).map(({ title }) => title)).toEqual(["Thème de Noël"]);
    expect(expandSeasonalEvents(new Date("2026-10-25T00:00:00Z"), new Date("2027-10-26T00:00:00Z")).map(({ id }) => id)).toEqual([
      "seasonal:2026-10-25", "seasonal:2026-12-20", "seasonal:2027-7-1", "seasonal:2027-10-25",
    ]);
  });
});

describe("expandSteamSales", () => {
  it("affiche uniquement les débuts et fins publiés par Steam, avec la source officielle", () => {
    const events = expandSteamSales(new Date("2026-01-01T00:00:00Z"), new Date("2028-01-01T00:00:00Z"));
    expect(events.map(({ title, date }) => [title, date.toISOString()])).toEqual([
      ["Début · Soldes Steam d’hiver 2026", "2026-12-17T00:00:00.000Z"],
      ["Fin · Soldes Steam d’hiver 2026", "2027-01-04T00:00:00.000Z"],
      ["Début · Soldes Steam de printemps 2027", "2027-03-18T00:00:00.000Z"],
      ["Fin · Soldes Steam de printemps 2027", "2027-03-25T00:00:00.000Z"],
      ["Début · Soldes Steam d’été 2027", "2027-06-24T00:00:00.000Z"],
      ["Fin · Soldes Steam d’été 2027", "2027-07-08T00:00:00.000Z"],
    ]);
    expect(new Set(events.map(({ id }) => id)).size).toBe(6);
    for (const event of events) expect(event).toMatchObject({
      kind: "STEAM_SALE", createdById: "system", href: "https://partner.steamgames.com/doc/marketing/discounts/seasonalsales",
    });
  });

  it("respecte la borne haute exclusive et conserve la fin d’hiver après le changement d’année", () => {
    expect(expandSteamSales(new Date("2026-12-17T00:00:00Z"), new Date("2027-01-04T00:00:00Z")).map(({ date }) => date.toISOString())).toEqual(["2026-12-17T00:00:00.000Z"]);
    expect(expandSteamSales(new Date("2027-01-01T00:00:00Z"), new Date("2027-01-05T00:00:00Z")).map(({ date }) => date.toISOString())).toEqual(["2027-01-04T00:00:00.000Z"]);
    expect(expandSteamSales(new Date("2026-12-18T00:00:00Z"), new Date("2027-01-04T00:00:00Z"))).toEqual([]);
  });

  it("n’extrapole ni les autres années ni l’automne 2027 sans date publiée", () => {
    expect(expandSteamSales(new Date("2027-09-01T00:00:00Z"), new Date("2029-01-01T00:00:00Z"))).toEqual([]);
    expect(expandSteamSales(new Date("2026-01-01T00:00:00Z"), new Date("2026-12-17T00:00:00Z"))).toEqual([]);
  });
});
