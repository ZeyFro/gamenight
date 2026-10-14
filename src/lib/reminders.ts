import type { Session } from "@prisma/client";

/**
 * Logique de décision pure du cron `reminders` (fix bugs remontés : rappel
 * marqué "envoyé" même en cas d'échec Discord, et horloge serveur brute
 * (`new Date()`) au lieu de l'horloge murale de Paris utilisée partout
 * ailleurs pour comparer aux dates de session — voir `wallclock.ts`).
 * Extraite du handler (`src/app/api/cron/reminders/route.ts`) pour rester
 * testable sans mock Prisma/Discord (aucun des deux n'existe dans ce
 * projet, même limite que `sessions.ts`/`isVotingOpen`, PR "vote
 * inter-session").
 */

export function parseRemindersSent(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

// Métadonnée dans le JSON existant : les seuils restent des chaînes numériques.
// Une génération distincte permet aussi de replanifier A → B → A sans réutiliser
// les anciennes clés de livraison. Aucun changement de schéma nécessaire.
export const REMINDER_SCHEDULE_PREFIX = "schedule:";

export function reminderScheduleKey(value: unknown): string {
  return parseRemindersSent(value).find(v => v.startsWith(REMINDER_SCHEDULE_PREFIX))?.slice(REMINDER_SCHEDULE_PREFIX.length) ?? "";
}

export function reminderOccurrence(minutes: number, remindersSent: unknown): string {
  const generation = reminderScheduleKey(remindersSent);
  return generation ? `${minutes}:${generation}` : String(minutes);
}

export function reminderSchedulePayload(session: Pick<Session, "date" | "remindersSent">) {
  return { reminderDate: session.date.toISOString(), reminderGeneration: reminderScheduleKey(session.remindersSent) };
}

export function isReminderForSchedule(payload: unknown, session: Pick<Session, "date" | "remindersSent">): boolean {
  // Les anciennes livraisons sans métadonnées restent valides uniquement tant
  // que le créneau n'a jamais été modifié depuis l'installation du correctif.
  if (payload == null) return reminderScheduleKey(session.remindersSent) === "";
  if (typeof payload !== "object" || Array.isArray(payload)) return false;
  const stored = payload as Record<string, unknown>;
  const current = reminderSchedulePayload(session);
  return stored.reminderDate === current.reminderDate && stored.reminderGeneration === current.reminderGeneration;
}

/**
 * Résultat de `computeTimingsDue` pour un passage du cron.
 *
 * - `toSend` : au plus UN seuil à traiter réellement ce passage — le plus
 *   PROCHE de l'échéance parmi ceux dus et pas déjà résolus (jamais le
 *   plus ancien). `actualMinutesRemaining` est le temps RÉEL restant
 *   (arrondi), calculé ICI, à afficher dans le message plutôt que le
 *   seuil configuré lui-même — un seuil "12h" atteint en retard (soirée
 *   décidée tard, ou cron qui a raté des passages) ne doit jamais annoncer
 *   "dans 12h !" alors qu'il n'en reste réellement que 40.
 * - `toResolveWithoutSending` : seuils plus anciens, dépassés par le même
 *   retard (ou par le début de la soirée) — à marquer résolus SANS aucun
 *   envoi, pour qu'ils ne soient plus jamais retentés (leur contenu serait
 *   de toute façon obsolète).
 */
export interface TimingsDueResult {
  toSend: { minutes: number; actualMinutesRemaining: number } | null;
  toResolveWithoutSending: number[];
}

const EMPTY_RESULT: TimingsDueResult = { toSend: null, toResolveWithoutSending: [] };

/**
 * Décide quoi faire des rappels d'UNE session pour CE passage du cron.
 * `now` doit être une valeur horloge murale (`wallClockNow()`, jamais
 * `new Date()`) — cette fonction ne fait qu'une soustraction en
 * millisecondes entre deux `Date` déjà dans la même représentation, elle
 * ne lit jamais l'heure réelle et n'a donc elle-même aucune notion de
 * fuseau/DST à gérer (voir le test "changement d'heure" dans
 * `reminders.test.ts` pour le détail de ce raisonnement).
 *
 * Fix bug remonté (rappels 12h/2h/45min/30min tous postés à la même
 * minute, avec en plus un contenu mensonger — "dans 12h !" alors que la
 * soirée commence dans 20 minutes) : quand une soirée est décidée tard
 * (ou que le cron externe a raté des passages), PLUSIEURS seuils peuvent
 * devenir dus EN MÊME TEMPS au même passage. L'ancien comportement les
 * renvoyait tous, chacun avec le libellé de SON propre seuil configuré —
 * désormais, au plus UN est réellement envoyé par passage (le plus proche
 * de l'échéance, donc le plus pertinent), avec le temps RÉEL restant
 * plutôt que le libellé du seuil, et tous les seuils plus anciens que lui
 * sont marqués résolus sans être envoyés (`toResolveWithoutSending`) —
 * ils ne repasseront donc jamais par ce chemin. Les seuils PAS ENCORE dus
 * continuent d'arriver normalement à leur propre échéance, un par un, au
 * passage du cron qui les atteint (aucun changement pour le cas courant
 * où le cron tourne sans retard).
 *
 * Exception volontaire : une fois la soirée elle-même commencée
 * (`minutesUntil <= 0` — la route appelante filtre déjà les sessions sur
 * `date > now`, donc ce cas n'arrive plus en pratique par ce chemin, mais
 * reste géré explicitement ici pour rester correct en tant que fonction
 * pure, testable indépendamment de ce filtre), plus AUCUN rappel n'est
 * envoyé — annoncer un compte à rebours pour une soirée déjà en cours n'a
 * plus de sens. Tous les seuils encore dus sont alors silencieusement
 * résolus sans envoi, plutôt que vidés en rafale comme avant ce fix.
 */
export function computeTimingsDue(
  session: Pick<Session, "date" | "reminderTimings" | "remindersSent"> & { createdAt?: Date },
  now: Date
): TimingsDueResult {
  const minutesUntil = (session.date.getTime() - now.getTime()) / 60_000;
  const remindersSent = parseRemindersSent(session.remindersSent);
  const due = session.reminderTimings
    .filter((minutes) => minutesUntil <= minutes && !remindersSent.includes(String(minutes)))
    .sort((a, b) => a - b);

  if (due.length === 0) return EMPTY_RESULT;
  if (minutesUntil <= 0) return { toSend: null, toResolveWithoutSending: due };

  // Un seuil dont l'échéance (date − seuil) précède la CRÉATION de la soirée n'a
  // jamais pu être « à temps » : « 15h avant » pour une soirée créée 10h avant.
  // Résolu sans envoi, sans alerte — sinon un « dans 10h ! » partirait juste
  // après l'annonce. `createdAt` doit être en horloge murale, comme `date` et
  // `now` (`toWallClock`) ; absent = pas de filtre (appelants historiques).
  const createdAtMs = session.createdAt?.getTime();
  const isElapsedAtCreation = (minutes: number) =>
    createdAtMs !== undefined && session.date.getTime() - minutes * 60_000 < createdAtMs;
  const live = due.filter((minutes) => !isElapsedAtCreation(minutes));
  const elapsedAtCreation = due.filter(isElapsedAtCreation);

  if (live.length === 0) return { toSend: null, toResolveWithoutSending: elapsedAtCreation };
  const [closest, ...stale] = live;
  return {
    toSend: { minutes: closest, actualMinutesRemaining: Math.round(minutesUntil) },
    toResolveWithoutSending: [...stale, ...elapsedAtCreation],
  };
}

export interface ReminderSendOutcome {
  minutes: number;
  ok: boolean;
}

/**
 * Nouveau `remindersSent` à partir de l'existant + des résultats du run
 * courant — fix bug remonté : seuls les timings dont l'envoi a RÉUSSI sont
 * ajoutés depuis `outcomes` (un échec reste absent, donc réessayable au
 * prochain passage, cf. `computeTimingsDue` qui ne re-proposera plus un
 * timing déjà présent ici). `staleToMark` (seuils dépassés à consommer
 * SANS envoi, voir `computeTimingsDue`) est en revanche ajouté
 * INCONDITIONNELLEMENT — il n'y a pas d'action associée dont le succès
 * dépendrait. `Set` plutôt qu'un simple `push` : préserve tel quel tout
 * ce qui était déjà enregistré et déduplique automatiquement.
 */
export function applyReminderResults(
  remindersSent: string[],
  outcomes: ReminderSendOutcome[],
  staleToMark: number[] = []
): string[] {
  const next = new Set(remindersSent);
  for (const outcome of outcomes) {
    if (outcome.ok) next.add(String(outcome.minutes));
  }
  for (const minutes of staleToMark) next.add(String(minutes));
  return Array.from(next);
}
