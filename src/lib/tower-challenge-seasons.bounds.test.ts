import { describe, expect, it } from "vitest";
import { getTowerSchoolSeason } from "./tower-challenge-seasons";
import { getLastCompletedTowerSeason } from "./tower-season-podium-rules";

// Référence indépendante du code testé : minuit Europe/Paris trouvé par essai des deux décalages possibles.
const clock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
function local(date: Date) {
  const p = Object.fromEntries(clock.formatToParts(date).filter(x => x.type !== "literal").map(x => [x.type, Number(x.value)]));
  return { y: p.year!, m: p.month!, d: p.day!, h: p.hour!, min: p.minute!, s: p.second! };
}
const midnights = new Map<string, Date>();
function referenceMidnight(y: number, m: number, d: number): Date {
  const key = `${y}-${m}-${d}`;
  const cached = midnights.get(key);
  if (cached) return cached;
  const hits = [2, 1].map(offset => new Date(Date.UTC(y, m - 1, d) - offset * 3600000)).filter(candidate => {
    const t = local(candidate);
    return t.y === y && t.m === m && t.d === d && t.h === 0 && t.min === 0 && t.s === 0;
  });
  if (hits.length !== 1) throw new Error(`minuit Paris introuvable ${y}-${m}-${d}`);
  midnights.set(key, hits[0]!);
  return hits[0]!;
}
function expectedFor(date: Date) {
  const { y, m, d } = local(date);
  if (m === 1 && d <= 3) return { name: `S4 · ${y - 1}`, active: false, start: [y - 1, 9, 1], end: [y, 1, 1] };
  if (m === 1 || m === 2 || (m === 3 && d <= 28)) return { name: `S1 · ${y}`, active: true, start: [y, 1, 4], end: [y, 3, 29] };
  if (m === 3) return { name: `S1 · ${y}`, active: false, start: [y, 1, 4], end: [y, 3, 29] };
  if (m <= 6) return { name: `S2 · ${y}`, active: true, start: [y, 4, 1], end: [y, 7, 1] };
  if (m <= 8) return { name: `Été · ${y}`, active: true, start: [y, 7, 1], end: [y, 9, 1] };
  return { name: `S4 · ${y}`, active: true, start: [y, 9, 1], end: [y + 1, 1, 1] };
}
const ends = (y: number) => [referenceMidnight(y, 1, 1), referenceMidnight(y, 3, 29), referenceMidnight(y, 7, 1), referenceMidnight(y, 9, 1)];

describe("calendrier The Tower : balayage horaire 2026–2030 contre une référence indépendante", () => {
  // Balayage de 5 ans heure par heure : le délai par défaut de 5 s est trop court.
  it("nom, activité et bornes (minuit Paris, fin exclusive) valent la table décidée à chaque heure", () => {
    const hour = 3600000;
    for (let t = Date.UTC(2026, 0, 1) - hour; t < Date.UTC(2031, 0, 1); t += hour) {
      const now = new Date(t);
      const expected = expectedFor(now);
      const season = getTowerSchoolSeason(now);
      expect([season.name, season.active], now.toISOString()).toEqual([expected.name, expected.active]);
      expect(season.startAt, now.toISOString()).toEqual(referenceMidnight(...(expected.start as [number, number, number])));
      expect(season.endAt, now.toISOString()).toEqual(referenceMidnight(...(expected.end as [number, number, number])));
      if (season.active) expect(now >= season.startAt && now < season.endAt, now.toISOString()).toBe(true);
      else expect(now >= season.endAt, now.toISOString()).toBe(true);
    }
  }, 60_000);

  it("à la milliseconde autour de chaque fin exclusive : la saison change exactement à minuit Paris", () => {
    for (let year = 2026; year <= 2030; year++) {
      for (const end of ends(year)) {
        const before = getLastCompletedTowerSeason(new Date(end.getTime() - 1));
        const at = getLastCompletedTowerSeason(end);
        expect(at.endAt, `${year} ${end.toISOString()}`).toEqual(end);
        expect(before.endAt.getTime(), `${year} ${end.toISOString()}`).toBeLessThan(end.getTime());
      }
    }
  });

  it("la dernière saison terminée est toujours celle dont la fin exclusive est la plus récente <= maintenant", () => {
    const hour = 3600000;
    for (let t = Date.UTC(2026, 6, 1); t < Date.UTC(2031, 0, 1); t += 7 * hour) {
      const now = new Date(t);
      const year = local(now).y;
      const latest = [...ends(year - 1), ...ends(year)].filter(end => end <= now).sort((a, b) => b.getTime() - a.getTime())[0]!;
      const completed = getLastCompletedTowerSeason(now);
      expect(completed.endAt, now.toISOString()).toEqual(latest);
      expect(completed.active).toBe(false);
    }
  });
});
