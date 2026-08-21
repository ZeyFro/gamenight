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

/**
 * "Maintenant" pour comparer à une Session.date. Limitation connue : c'est
 * l'heure UTC réelle du serveur (Vercel), alors que les dates saisies sont
 * stockées SANS conversion de fuseau (cf. commentaire en tête de fichier) —
 * la clôture auto d'une session sera donc décalée du fuseau réel du groupe
 * par rapport à UTC (1-2h en France). Acceptable pour ce MVP ; à revoir
 * avec une vraie gestion de fuseau si besoin (même sujet pour les rappels
 * F7).
 */
export function wallClockNow(): Date {
  return new Date();
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
