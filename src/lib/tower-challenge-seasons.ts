const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
});
const parisTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

export interface TowerSchoolSeason {
  name: string;
  startAt: Date;
  endAt: Date;
  active: boolean;
}

function numericParts(formatter: Intl.DateTimeFormat, date: Date): Record<string, number> {
  return Object.fromEntries(formatter.formatToParts(date)
    .filter(part => part.type !== "literal")
    .map(part => [part.type, Number(part.value)]));
}

function parisMidnight(year: number, month: number, day: number): Date {
  const utcMidnight = Date.UTC(year, month - 1, day);
  const local = numericParts(parisTimeFormatter, new Date(utcMidnight));
  const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return new Date(utcMidnight - (localAsUtc - utcMidnight));
}

/**
 * Convention Tower commune inspirée du rythme scolaire à Paris, pas un calendrier officiel.
 * Les dates propres à un lycée ne sont pas déductibles du profil d'un membre.
 */
export function getTowerSchoolSeason(now = new Date()): TowerSchoolSeason {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Date de saison invalide");
  const parts = numericParts(partsFormatter, now);
  const year = parts.year;
  const month = parts.month;
  const schoolYearStart = month >= 9 ? year : year - 1;
  const active = month >= 9 || month <= 6;
  const term = month >= 9 ? 1 : month <= 3 ? 2 : 3;
  const start = term === 1
    ? parisMidnight(schoolYearStart, 9, 1)
    : term === 2
      ? parisMidnight(schoolYearStart + 1, 1, 1)
      : parisMidnight(schoolYearStart + 1, 4, 1);
  const end = term === 1
    ? parisMidnight(schoolYearStart + 1, 1, 1)
    : term === 2
      ? parisMidnight(schoolYearStart + 1, 4, 1)
      : parisMidnight(schoolYearStart + 1, 7, 1);
  return {
    name: "Trimestre " + term + " · " + schoolYearStart + "-" + (schoolYearStart + 1),
    startAt: start,
    endAt: end,
    active,
  };
}
