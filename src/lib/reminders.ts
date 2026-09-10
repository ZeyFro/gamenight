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
 */
export function computeTimingsDue(
  session: Pick<Session, "date" | "reminderTimings" | "remindersSent">,
  now: Date
): number[] {
  const minutesUntil = (session.date.getTime() - now.getTime()) / 60_000;
  const remindersSent = parseRemindersSent(session.remindersSent);
  return session.reminderTimings.filter(
    (minutes) => minutesUntil <= minutes && !remindersSent.includes(String(minutes))
  );
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
