const parisDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
const parisClock = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

export interface TowerSchoolSeason { name: string; startAt: Date; endAt: Date; active: boolean }

function parts(formatter: Intl.DateTimeFormat, date: Date) {
  return Object.fromEntries(formatter.formatToParts(date).filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)])) as Record<string, number>;
}
function parisMidnight(year: number, month: number, day: number): Date {
  const utc = Date.UTC(year, month - 1, day);
  const local = parts(parisClock, new Date(utc));
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return new Date(utc - (asUtc - utc));
}
function season(name: string, start: [number, number, number], end: [number, number, number], active: boolean): TowerSchoolSeason {
  return { name, startAt: parisMidnight(...start), endAt: parisMidnight(...end), active };
}

/** End dates are EXCLUSIVE. A day without an active season cannot award seasonal points.
 * July–August is an active summer season. Jan 1–3 and Mar 29–31 are inactive.
 */
export function getTowerSchoolSeason(now = new Date()): TowerSchoolSeason {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Date de saison invalide");
  const day = parts(parisDay, now);
  const { year, month } = day;
  const dayOfMonth = day.day;
  if (month === 1 && dayOfMonth <= 3) return season(`S4 · ${year - 1}`, [year - 1, 9, 1], [year, 1, 1], false);
  if (month === 1 || month === 2 || (month === 3 && dayOfMonth <= 28)) {
    return season(`S1 · ${year}`, [year, 1, 4], [year, 3, 29], true);
  }
  if (month === 3) return season(`S1 · ${year}`, [year, 1, 4], [year, 3, 29], false);
  if (month <= 6) return season(`S2 · ${year}`, [year, 4, 1], [year, 7, 1], true);
  if (month <= 8) return season(`Été · ${year}`, [year, 7, 1], [year, 9, 1], true);
  return season(`S4 · ${year}`, [year, 9, 1], [year + 1, 1, 1], true);
}
