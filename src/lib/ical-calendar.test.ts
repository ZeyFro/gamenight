import { describe, expect, it } from "vitest";
import { buildIcalCalendar } from "./ical-calendar";

describe("export iCalendar", () => {
  it("conserve les heures murales de Paris en hiver et en été", () => {
    const output = buildIcalCalendar([
      { id: "winter", date: new Date("2026-01-15T20:30:00Z"), title: "Soirée", status: "VOTING", url: "https://example.test/sessions/winter" },
      { id: "summer", date: new Date("2026-07-15T20:30:00Z"), title: "Soirée", status: "SCHEDULED", url: "https://example.test/sessions/summer" },
    ], new Date("2026-01-01T12:00:00Z"));
    expect(output).toContain("TZID:Europe/Paris");
    expect(output).toContain("DTSTART;TZID=Europe/Paris:20260115T203000");
    expect(output).toContain("DTSTART;TZID=Europe/Paris:20260715T203000");
    expect(output).toContain("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU");
    expect(output).toContain("STATUS:TENTATIVE");
    expect(output).toContain("STATUS:CONFIRMED");
  });

  it("échappe les caractères réservés et plie les lignes longues en octets UTF-8", () => {
    const title = `Jeu, test; \u00e9 ${"tr\u00e8s-long ".repeat(12)}\\fin\nligne`;
    const output = buildIcalCalendar([
      { id: "g", date: new Date("2026-10-16T20:00:00Z"), title, status: "SCHEDULED", url: "https://example.test/sessions/g" },
    ]);
    const lines = output.split("\r\n").filter(Boolean);
    expect(lines.some((line) => Buffer.byteLength(line, "utf8") > 75)).toBe(false);
    expect(output).toContain("Jeu\\, test\\; ");
    expect(output).toContain("\\\\fin\\nligne");
    expect(lines.some((line) => line.startsWith(" "))).toBe(true);
  });

  it("garde des UID stables entre deux exports et une structure RFC 5545 minimale", () => {
    const session = { id: "abc123", date: new Date("2026-10-16T20:00:00Z"), title: "Soirée", status: "SCHEDULED" as const, url: "https://example.test/sessions/abc123" };
    const first = buildIcalCalendar([session], new Date("2026-01-01T00:00:00Z"));
    const second = buildIcalCalendar([session], new Date("2026-06-01T00:00:00Z"));
    expect(first).toContain("UID:abc123@gamenight\r\n");
    expect(second).toContain("UID:abc123@gamenight\r\n");
    expect(first.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(first.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(first.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(first.indexOf("BEGIN:VTIMEZONE")).toBeLessThan(first.indexOf("BEGIN:VEVENT"));
    expect(first.match(/BEGIN:VEVENT/g)).toHaveLength(first.match(/END:VEVENT/g)!.length);
  });
});
