import { describe, expect, it } from "vitest";
import { expandCommunityDates, type CommunityDateInput } from "./community-dates";

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
