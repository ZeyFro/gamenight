/**
 * L'app ne fait AUCUNE conversion de fuseau horaire : les dates/heures
 * saisies par les utilisateurs (dispos, date de session) sont stockées et
 * relues telles quelles, en utilisant les getters/setters UTC comme simple
 * représentation "horloge murale" cohérente — pas comme un vrai UTC.
 * Hypothèse : tout le groupe est dans le même fuseau horaire (cas normal
 * pour une soirée entre potes). Ça évite une classe de bugs de décalage
 * horaire liés au fuseau du serveur (Vercel tourne en UTC) sans dépendre
 * d'une librairie de fuseaux horaires.
 */

/** Parse "YYYY-MM-DD" + "HH:mm" (inputs <input type="date"> / <input type="time">). */
export function parseDateAndTime(dateStr: string, timeStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [h, mi] = timeStr.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, h, mi));
}

/** Parse "YYYY-MM-DD" (input <input type="date">) en date pure (minuit). */
export function parseDateOnly(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Formate en "YYYY-MM-DD" pour re-remplir un <input type="date">. */
export function toDateInputValue(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Formate en "HH:mm" pour re-remplir un <input type="time">. */
export function toTimeInputValue(date: Date): string {
  const h = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  return `${h}:${mi}`;
}

export function formatDateTimeFr(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatDateFr(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

export function sameUtcDate(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

const GROUP_TIME_ZONE = "Europe/Paris";

const NOW_PARTS_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: GROUP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/**
 * "Maintenant" pour comparer aux dates de session/dispo stockées. Fix
 * (bug prod remonté fin août 2026, cycle de vie des soirées) : les dates
 * saisies sont stockées comme horloge murale SANS conversion (cf.
 * commentaire en tête de fichier) — elles représentent l'heure de
 * `GROUP_TIME_ZONE`, pas un vrai instant UTC. Avant ce fix, `wallClockNow`
 * renvoyait `new Date()` (l'heure UTC réelle du serveur Vercel), ce qui
 * décalait TOUTES les comparaisons "maintenant vs date de soirée" de 1-2h
 * (CET/CEST) — une soirée à 23h30 heure de Paris n'était considérée due
 * qu'à 23h30 UTC réel, soit 01h30 le lendemain à Paris.
 *
 * Ici, "maintenant" est recalculé comme horloge murale : on lit l'heure
 * réelle actuelle telle qu'affichée à Paris (`Intl.DateTimeFormat`, DST
 * géré automatiquement par la donnée IANA), puis on la reconstruit avec
 * les mêmes conventions `Date.UTC` que le stockage — cohérent avec
 * `parseDateAndTime`/`parseDateOnly` de bout en bout. Un seul point de
 * correction : `isVotingOpen`, `closeSessionIfDue`,
 * `resolveSessionSchedule`, `todayDateOnly` en héritent tous sans être
 * modifiés. Les `new Date()` bruts restants (cron, pré-filtres de page)
 * doivent explicitement être remplacés par `wallClockNow()` — sinon ils
 * redeviennent une source de désaccord avec les comparaisons internes
 * désormais corrigées.
 */
export function wallClockNow(): Date {
  const parts = NOW_PARTS_FORMATTER.formatToParts(new Date());
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(
    Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"))
  );
}

/** Aujourd'hui à minuit (même convention horloge-murale/UTC). */
export function todayDateOnly(): Date {
  const now = wallClockNow();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}

/** Durée absolue en français, unité la plus lisible ("3 h", "45 min", "2 j"). */
export function formatDurationFr(ms: number): string {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const totalHours = Math.round(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours} h`;
  const days = Math.round(totalHours / 24);
  return `${days} j`;
}

export const DAY_LABELS_MON_FIRST = [
  { dayOfWeek: 1, label: "Lundi" },
  { dayOfWeek: 2, label: "Mardi" },
  { dayOfWeek: 3, label: "Mercredi" },
  { dayOfWeek: 4, label: "Jeudi" },
  { dayOfWeek: 5, label: "Vendredi" },
  { dayOfWeek: 6, label: "Samedi" },
  { dayOfWeek: 0, label: "Dimanche" },
] as const;
