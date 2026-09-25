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

/**
 * Timings (minutes avant la session) encore dus et pas déjà envoyés.
 * `now` doit être une valeur horloge murale (`wallClockNow()`, jamais
 * `new Date()`) — cette fonction ne fait qu'une soustraction en
 * millisecondes entre deux `Date` déjà dans la même représentation, elle
 * ne lit jamais l'heure réelle et n'a donc elle-même aucune notion de
 * fuseau/DST à gérer (voir le test "changement d'heure" dans
 * `reminders.test.ts` pour le détail de ce raisonnement).
 *
 * Fix bug remonté (rappels 12h/2h/45min/30min tous postés à la même
 * minute) : quand une soirée est décidée tard (ou que le cron externe a
 * raté des passages), PLUSIEURS seuils peuvent devenir dus EN MÊME TEMPS
 * au même passage — l'ancien comportement les renvoyait tous d'un coup,
 * envoyés en rafale par le handler. Un seul seuil de rattrapage est
 * désormais renvoyé par appel, les autres restant dus pour le(s)
 * passage(s) suivant(s) du cron (toutes les 15 min) — ils s'étalent donc
 * naturellement dans le temps au lieu d'arriver groupés.
 *
 * Le seuil renvoyé en premier est le PLUS PETIT (le plus proche de
 * l'échéance), jamais le plus grand : la route appelante filtre déjà les
 * sessions sur `date > now` (voir `route.ts`), donc une soirée dont le
 * retard de rattrapage dépasse sa propre date sort simplement du lot au
 * passage suivant — un seuil non envoyé à temps est silencieusement
 * manqué (limite déjà acceptée et documentée dans `route.ts`, inchangée
 * par ce fix). Mieux vaut alors avoir tenté "dans 30 min !" (le plus
 * actionnable, le plus susceptible d'arriver avant la soirée) que
 * d'avoir épuisé le temps restant sur "dans 12h !" (déjà mensonger dès
 * qu'il part en retard, quelle que soit la rapidité du rattrapage).
 * Exception volontaire : une fois la soirée elle-même commencée
 * (`minutesUntil <= 0` — n'arrive plus en pratique vu le filtre
 * `date > now`, mais reste un cas géré explicitement par cette fonction
 * pure), on ne fait plus attendre le prochain passage — tous les seuils
 * encore dus sont vidés d'un coup, pour ne jamais en perdre un par
 * excès de prudence.
 */
export function computeTimingsDue(
  session: Pick<Session, "date" | "reminderTimings" | "remindersSent">,
  now: Date
): number[] {
  const minutesUntil = (session.date.getTime() - now.getTime()) / 60_000;
  const remindersSent = parseRemindersSent(session.remindersSent);
  const due = session.reminderTimings
    .filter((minutes) => minutesUntil <= minutes && !remindersSent.includes(String(minutes)))
    .sort((a, b) => a - b);

  if (due.length <= 1 || minutesUntil <= 0) return due;
  return [due[0]];
}

export interface ReminderSendOutcome {
  minutes: number;
  ok: boolean;
}

/**
 * Nouveau `remindersSent` à partir de l'existant + des résultats du run
 * courant — fix bug remonté : seuls les timings dont l'envoi a RÉUSSI sont
 * ajoutés (un échec reste absent, donc réessayable au prochain passage,
 * cf. `computeTimingsDue` qui ne re-proposera plus un timing déjà présent
 * ici). `Set` plutôt qu'un simple `push` : préserve tel quel tout ce qui
 * était déjà enregistré et déduplique automatiquement (un timing déjà
 * présent, ou marqué réussi deux fois par erreur dans le même run, n'a
 * qu'une seule entrée en sortie).
 */
export function applyReminderResults(
  remindersSent: string[],
  outcomes: ReminderSendOutcome[]
): string[] {
  const next = new Set(remindersSent);
  for (const outcome of outcomes) {
    if (outcome.ok) next.add(String(outcome.minutes));
  }
  return Array.from(next);
}
