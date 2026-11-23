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

/** Calendrier décidé le 17/11/2026 (docs/DECISIONS_TOWER.md). Fins EXCLUSIVES, minuit Europe/Paris.
 * - S1 : 1er décembre → 1er avril (S1 · 2026-2027 = 1er déc. 2026 → 31 mars 2027 inclus) ;
 * - S2 : 1er avril → 1er juillet (S2 · année) ; Été : 1er juillet → 1er septembre (Été · année) ;
 * - S3 : 1er septembre → 1er décembre (S3 · année).
 * Les quatre périodes couvrent toute l'année : il n'y a plus d'intersaison, `active` vaut toujours true
 * (champ conservé pour les consommateurs). Le calendrier s'applique de la même façon avant le lancement.
 */
export function getTowerSchoolSeason(now = new Date()): TowerSchoolSeason {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Date de saison invalide");
  const { year, month } = parts(parisDay, now);
  if (month === 12) return season(`S1 · ${year}-${year + 1}`, [year, 12, 1], [year + 1, 4, 1], true);
  if (month <= 3) return season(`S1 · ${year - 1}-${year}`, [year - 1, 12, 1], [year, 4, 1], true);
  if (month <= 6) return season(`S2 · ${year}`, [year, 4, 1], [year, 7, 1], true);
  if (month <= 8) return season(`Été · ${year}`, [year, 7, 1], [year, 9, 1], true);
  return season(`S3 · ${year}`, [year, 9, 1], [year, 12, 1], true);
}

export function daysLeftInTowerSeason(now = new Date()): number {
  const { endAt } = getTowerSchoolSeason(now);
  return Math.max(0, Math.ceil((endAt.getTime() - now.getTime()) / 86400000));
}

/**
 * Progression dans la saison Tower courante, jours comptés en JOURS CIVILS Europe/Paris (jamais par division de millisecondes :
 * le changement d'heure raccourcit ou allonge une journée). `day` va de 1 à `totalDays` ; `daysLeft` inclut aujourd'hui
 * (1 le dernier jour). C'est l'UNIQUE saison affichée aux joueurs (accueil, /saisons, /tower) : audit du 23/11/2026, l'accueil
 * montrait « Saison 2 — Jour 23/30 » (saison mensuelle d'XP) pendant que /tower montrait « S3 · 2026 ».
 */
export function getTowerSeasonProgress(now = new Date()): { name: string; day: number; totalDays: number; daysLeft: number } {
  const current = getTowerSchoolSeason(now);
  const today = parts(parisDay, now);
  const start = parts(parisDay, current.startAt);
  const end = parts(parisDay, current.endAt);
  const dayMs = 86_400_000;
  const civil = (p: Record<string, number>) => Date.UTC(p.year, p.month - 1, p.day);
  const totalDays = Math.round((civil(end) - civil(start)) / dayMs);
  const day = Math.round((civil(today) - civil(start)) / dayMs) + 1;
  return { name: current.name, day, totalDays, daysLeft: totalDays - day + 1 };
}
