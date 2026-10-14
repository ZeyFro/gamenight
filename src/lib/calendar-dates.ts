/**
 * Helpers de date + navigation du calendrier (PR refonte /calendrier),
 * séparés de `src/lib/calendar.ts` : ce fichier est pur (aucun accès
 * Prisma) donc importable aussi bien depuis la page serveur que depuis
 * les composants client `MiniMonthCalendar`/`DayTimeline` — `calendar.ts`
 * importe `@/lib/prisma`, donc un composant client qui l'importerait
 * ferait planter le bundle (code Node-only envoyé au navigateur).
 */

export function addDays(date: Date, days: number): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days)
  );
}

/** Lundi 00:00 (UTC-horloge-murale) de la semaine contenant `date`. */
export function getWeekStart(date: Date): Date {
  const dayOfWeek = date.getUTCDay(); // 0 = dimanche
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday)
  );
}

/**
 * Grille de mois "pleine" (semaines complètes, lundi-dimanche) pour le
 * mini-calendrier : premier jour = lundi de la semaine du 1er du mois,
 * dernier jour = dimanche de la semaine du dernier jour du mois.
 */
export function getMonthGridRange(date: Date): { start: Date; end: Date } {
  const firstOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const lastOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return {
    start: getWeekStart(firstOfMonth),
    end: getWeekStart(lastOfMonth),
  };
}

export interface HourSlot {
  hour: number;
  availableUserIds: string[];
}

export interface BestSlot {
  date: Date;
  hour: number;
  count: number;
  userIds: string[];
}

/**
 * Extrait du "meilleur créneau commun" (le plus grand nombre de dispos
 * simultanées) hors de `getCalendarData` (`src/lib/calendar.ts`, qui
 * importe `@/lib/prisma`) — même raison que le reste de ce fichier : rendre
 * la logique testable sans DB (chantier "Tests automatisés", Sprint 1).
 * Prend les heures déjà calculées (`availableUserIds` déjà résolu via
 * `isAvailableAt`) plutôt que de recalculer quoi que ce soit — pure
 * fonction de parcours/max, aucune règle de disponibilité ici.
 *
 * `null` si aucun jour n'a de créneau avec au moins 1 dispo (comportement
 * inchangé : un `count` de 0 n'est jamais un "meilleur créneau" affichable).
 */
export function findBestSlot(days: { date: Date; hours: HourSlot[] }[]): BestSlot | null {
  let best: BestSlot | null = null;

  for (const day of days) {
    for (const { hour, availableUserIds } of day.hours) {
      if (!best || availableUserIds.length > best.count) {
        best = { date: day.date, hour, count: availableUserIds.length, userIds: availableUserIds };
      }
    }
  }

  return best && best.count > 0 ? best : null;
}

export type CalendarMode = "collectif" | "individuel";

/**
 * Construit une URL `/calendrier` — utilisé côté serveur (page) ET côté
 * client (mini-mois, timeline) pour que les deux calculent exactement les
 * mêmes liens sans dupliquer la logique.
 */
export function buildCalendarHref(params: {
  /** "YYYY-MM-DD" — omis pour revenir à aujourd'hui (pas de param = défaut serveur). */
  date?: string;
  mode: CalendarMode;
  pote?: string;
  potes?: string;
  vue?: "mois" | "semaine";
}): string {
  const search = new URLSearchParams();
  if (params.date) search.set("date", params.date);
  if (params.mode !== "collectif") search.set("mode", params.mode);
  if (params.mode === "individuel" && params.pote) search.set("pote", params.pote);
  if (params.mode === "collectif" && params.potes) search.set("potes", params.potes);
  if (params.vue === "semaine") search.set("vue", "semaine");
  const qs = search.toString();
  return `/calendrier${qs ? `?${qs}` : ""}`;
}
