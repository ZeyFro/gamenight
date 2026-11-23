import { describe, expect, it } from "vitest";
import { getTowerSchoolSeason, getTowerSeasonProgress } from "@/lib/tower-challenge-seasons";
import { getSeasonProgress } from "@/lib/seasons";

/**
 * Une seule saison est affichée aux joueurs (audit du 23/11/2026 : l'accueil montrait « Saison 2 — Jour 23/30 » pendant que
 * /tower montrait « S3 · 2026 »). Ces tests figent la progression de la saison Tower et la bascule du 1er décembre.
 */
describe("progression de la saison Tower (jours civils Europe/Paris)", () => {
  it("le 23/11/2026 : S3 · 2026, jour 84 sur 91, encore 8 jours (même nom que /tower)", () => {
    const now = new Date("2026-11-23T12:00:00Z");
    expect(getTowerSeasonProgress(now)).toEqual({ name: "S3 · 2026", day: 84, totalDays: 91, daysLeft: 8 });
    expect(getTowerSeasonProgress(now).name).toBe(getTowerSchoolSeason(now).name);
  });
  it("bascule du 1er décembre à minuit de Paris : 30/11 23:59 = dernier jour de S3, 01/12 00:00 = jour 1 de S1 · 2026-2027", () => {
    const before = new Date("2026-11-30T22:59:00Z"); // 23:59 à Paris (UTC+1)
    const after = new Date("2026-11-30T23:00:00Z"); // 00:00 le 1er décembre à Paris
    expect(getTowerSeasonProgress(before)).toEqual({ name: "S3 · 2026", day: 91, totalDays: 91, daysLeft: 1 });
    expect(getTowerSeasonProgress(after)).toEqual({ name: "S1 · 2026-2027", day: 1, totalDays: 121, daysLeft: 121 });
    expect(getTowerSchoolSeason(before).endAt.getTime()).toBe(after.getTime());
    expect(getTowerSchoolSeason(after).startAt.getTime()).toBe(after.getTime());
  });
  it("changement d'heure : un jour de 23 h ou 25 h compte pour un jour (28/03/2027 : jour 118 de S1, 29/03 : 119)", () => {
    expect(getTowerSeasonProgress(new Date("2027-03-28T10:00:00Z")).day).toBe(118);
    expect(getTowerSeasonProgress(new Date("2027-03-29T10:00:00Z")).day).toBe(119);
    expect(getTowerSeasonProgress(new Date("2027-03-31T21:30:00Z"))).toMatchObject({ day: 121, daysLeft: 1 }); // 23:30 à Paris (UTC+2)
    expect(getTowerSeasonProgress(new Date("2027-03-31T22:00:00Z")).name).toBe("S2 · 2027"); // 00:00 le 1er avril
  });
  it("chaque jour de l'année tombe dans une saison, jour entre 1 et totalDays", () => {
    for (let ms = Date.UTC(2026, 11, 1); ms < Date.UTC(2027, 11, 5); ms += 86_400_000 * 3) {
      const p = getTowerSeasonProgress(new Date(ms));
      expect(p.day).toBeGreaterThanOrEqual(1);
      expect(p.day).toBeLessThanOrEqual(p.totalDays);
      expect(p.daysLeft).toBe(p.totalDays - p.day + 1);
    }
  });
});

describe("l'accueil et /saisons lisent la même saison que /tower", () => {
  it("getSeasonProgress renvoie la saison Tower, sans dépendre d'un serveur ni de la base", async () => {
    const shown = await getSeasonProgress();
    expect(shown.name).toBe(getTowerSchoolSeason().name);
    expect(shown.name).toMatch(/^(S[123]|Été) · /);
    expect(shown).not.toHaveProperty("number");
  });
});
