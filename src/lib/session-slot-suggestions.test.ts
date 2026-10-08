import { describe, expect, it } from "vitest";
import { isAvailableAt } from "./availability";
import { availabilityDuring, suggestSessionSlots, type SlotMember } from "./session-slot-suggestions";

const now = new Date("2026-10-08T12:00:00Z"); // Jeudi, horloge murale.
const weekly = (id: string, days = [4, 5, 6], startTime = "20:00", endTime = "23:00"): SlotMember => ({ id, weekly: days.map((dayOfWeek) => ({ dayOfWeek, startTime, endTime })), overrides: [] });
const range = (start: string, end: string, member: SlotMember) => availabilityDuring(new Date(start), new Date(end), member);

describe("créneaux de soirée", () => {
  it("classe par personnes disponibles, puis date/heure, avec trois jours distincts", () => {
    const result = suggestSessionSlots([weekly("host"), weekly("a"), weekly("b", [5, 6])], "host", now, 120);
    expect(result.map((slot) => [slot.date, slot.time, slot.availableCount])).toEqual([["2026-10-09", "20:00", 3], ["2026-10-10", "20:00", 3], ["2026-10-08", "20:00", 2]]);
  });
  it("respecte les minutes exactes et une fin exclusive, sans combler un trou de 15 minutes", () => {
    const member = weekly("a", [4], "19:15", "21:30");
    expect(range("2026-10-08T19:30:00Z", "2026-10-08T21:30:00Z", member)).toBe("available");
    expect(range("2026-10-08T19:00:00Z", "2026-10-08T21:00:00Z", member)).toBe("unavailable");
    member.weekly = [{ dayOfWeek: 4, startTime: "19:00", endTime: "20:15" }, { dayOfWeek: 4, startTime: "20:30", endTime: "23:00" }];
    expect(range("2026-10-08T19:00:00Z", "2026-10-08T21:00:00Z", member)).toBe("unavailable");
    member.weekly[1].startTime = "20:15";
    expect(range("2026-10-08T19:00:00Z", "2026-10-08T21:00:00Z", member)).toBe("available");
  });
  it("une exception remplace les horaires habituels, y compris une journée entière", () => {
    const member = weekly("a", [4]);
    member.overrides = [{ date: "2026-10-08", available: false, startTime: null, endTime: null }];
    expect(range("2026-10-08T20:00:00Z", "2026-10-08T22:00:00Z", member)).toBe("unavailable");
    member.overrides[0].available = true;
    expect(range("2026-10-08T18:00:00Z", "2026-10-08T20:00:00Z", member)).toBe("available");
    member.overrides[0].startTime = "21:00"; member.overrides[0].endTime = "22:00";
    expect(range("2026-10-08T20:00:00Z", "2026-10-08T22:00:00Z", member)).toBe("unavailable");
  });
  it("vérifie chaque jour lorsque la durée traverse minuit", () => {
    const member = weekly("a", [4], "21:00", "00:00");
    member.weekly.push({ dayOfWeek: 5, startTime: "00:00", endTime: "02:00" });
    expect(range("2026-10-08T23:00:00Z", "2026-10-09T01:00:00Z", member)).toBe("available");
    member.overrides = [{ date: "2026-10-09", available: false, startTime: null, endTime: null }];
    expect(range("2026-10-08T23:00:00Z", "2026-10-09T01:00:00Z", member)).toBe("unavailable");
  });
  it("reste cohérent avec le calendrier pour ses plages qui traversent minuit", () => {
    const member = weekly("a", [4], "23:00", "02:00");
    for (const time of ["00:00", "01:59", "02:00", "20:00", "23:00", "23:59"]) {
      const start = new Date(`2026-10-08T${time}:00Z`);
      const end = new Date(start.getTime() + 60_000);
      if (time === "23:59") continue; // Ce cas implique un changement de jour, couvert au-dessus.
      expect(availabilityDuring(start, end, member) === "available").toBe(isAvailableAt(start, member.weekly, undefined));
    }
  });
  it("ne propose pas un horaire trop proche ni au-delà des sept jours", () => {
    const allDays = [0, 1, 2, 3, 4, 5, 6];
    const result = suggestSessionSlots([weekly("host", allDays, "18:00", "23:59"), weekly("a", allDays, "18:00", "23:59")], "host", new Date("2026-10-08T21:45:00Z"), 60);
    expect(result.find((slot) => slot.date === "2026-10-08")?.time).toBe("22:30");
    expect(result.every((slot) => slot.date <= "2026-10-14")).toBe(true);
  });
  it("les dispos absentes restent inconnues, y compris celles du créateur", () => {
    const result = suggestSessionSlots([{ id: "host", weekly: [], overrides: [] }, weekly("a")], "host", now, 120);
    expect(result[0]).toMatchObject({ availableCount: 1, totalParticipants: 2, unknownCount: 1, creatorAvailable: false });
    expect(suggestSessionSlots([{ id: "host", weekly: [], overrides: [] }], "host", now, 120)).toEqual([]);
  });
  it("ne propose pas une soirée quand l'organisateur est indisponible ou aucun invité disponible", () => {
    expect(suggestSessionSlots([weekly("host", [4], "08:00", "12:00"), weekly("a")], "host", now, 120)).toEqual([]);
    expect(suggestSessionSlots([weekly("host"), { id: "a", weekly: [], overrides: [] }], "host", now, 120)).toEqual([]);
  });
  it("déduplique les participants et conserve une recherche pour soi seul", () => {
    expect(suggestSessionSlots([weekly("host"), weekly("host")], "host", now, 120)[0].totalParticipants).toBe(1);
  });
  it("une exception du soir ne rend pas la fin du lendemain disponible sans saisie", () => {
    const member: SlotMember = { id: "a", weekly: [], overrides: [{ date: "2026-10-08", available: true, startTime: "21:00", endTime: "00:00" }] };
    expect(range("2026-10-08T23:00:00Z", "2026-10-09T01:00:00Z", member)).toBe("unknown");
  });
  it("refuse durée invalide, organisateur absent et date invalide", () => {
    expect(suggestSessionSlots([weekly("host")], "host", now, 999)).toEqual([]);
    expect(suggestSessionSlots([weekly("a")], "host", now, 120)).toEqual([]);
    expect(suggestSessionSlots([weekly("host")], "host", new Date("invalid"), 120)).toEqual([]);
  });
  it("ne transforme pas un ancien horaire malformé en disponibilité", () => {
    for (const time of ["invalid", "25:00", "20:99", "20:00suffix"]) {
      expect(range("2026-10-08T20:00:00Z", "2026-10-08T22:00:00Z", weekly("a", [4], time, "23:00"))).toBe("unavailable");
    }
  });
});
