import { parseDateAndTime, wallClockNow } from "@/lib/wallclock";
import { VALIDATION_ERROR_KEY, VALIDATION_ERROR_MESSAGE } from "@/lib/validations";

// Fenêtre de vote minimale qu'on essaie toujours de garantir, et distance
// minimale entre "maintenant" et l'heure de la session en dessous de
// laquelle on refuse plutôt que de créer/modifier une soirée invotable.
const MIN_VOTING_BUFFER_MS = 30 * 60 * 1000;
const MIN_SESSION_LEAD_MS = 30 * 60 * 1000;

/**
 * Messages FR pour les erreurs renvoyées par `resolveSessionSchedule`,
 * réutilisés par /sessions (création) et /sessions/[id] (édition). Porte
 * aussi `VALIDATION_ERROR_KEY` (chantier "Validation entrées serveur") :
 * même `?error=...` redirigé par `createSession`/`editSessionAction`
 * quand `createSessionSchema`/`editSessionSchema` rejette la requête avant
 * même d'atteindre `resolveSessionSchedule`.
 */
export const SESSION_SCHEDULE_ERROR_MESSAGES: Record<string, string> = {
  duration_invalide: "La durée doit être comprise entre 1 minute et 24 heures.",
  session_trop_proche:
    "Cette session est trop proche (ou déjà passée) pour laisser un minimum de temps de vote (30 min). Choisis une heure un peu plus tardive.",
  [VALIDATION_ERROR_KEY]: VALIDATION_ERROR_MESSAGE,
};

export interface SessionScheduleInput {
  dateStr: string;
  timeStr: string;
  deadlineDateStr: string;
  deadlineTimeStr: string;
  deadlineOffset: string;
}

export type SessionScheduleResult =
  | { ok: true; date: Date; votingDeadline: Date; deadlineAdjusted: boolean }
  | { ok: false; error: "session_trop_proche" };

/**
 * Résout et valide date/heure de session + deadline de vote à partir des
 * champs bruts du formulaire (création OU édition — mêmes règles des deux
 * côtés, mutualisées ici pour ne pas dupliquer la logique) :
 * - deadline explicite si fournie, sinon calculée depuis `deadlineOffset`
 *   heures avant la session ;
 * - deadline déjà dans le passé → repoussée à "maintenant + 30 min" plutôt
 *   que de créer une session qui se clôture instantanément (bug historique
 *   corrigé, cf. `deadlineAdjusted`) ;
 * - deadline qui dépasserait l'heure de la session après cet ajustement →
 *   recalée à 1 min avant la session pour préserver l'invariant
 *   "deadline < session" ;
 * - si même après ajustement il ne reste aucune fenêtre de vote viable (la
 *   session elle-même est trop proche ou déjà passée), on refuse plutôt que
 *   de créer/modifier une soirée invotable.
 */
export function resolveSessionSchedule(
  input: SessionScheduleInput
): SessionScheduleResult {
  const date = parseDateAndTime(input.dateStr, input.timeStr);
  const now = wallClockNow();

  let votingDeadline: Date;
  if (input.deadlineDateStr && input.deadlineTimeStr) {
    votingDeadline = parseDateAndTime(input.deadlineDateStr, input.deadlineTimeStr);
  } else {
    const offsetHours = Number(input.deadlineOffset || "6") || 6;
    votingDeadline = new Date(date.getTime() - offsetHours * 60 * 60 * 1000);
  }

  let deadlineAdjusted = false;
  if (votingDeadline.getTime() <= now.getTime()) {
    votingDeadline = new Date(now.getTime() + MIN_VOTING_BUFFER_MS);
    deadlineAdjusted = true;
  }

  if (votingDeadline.getTime() >= date.getTime()) {
    votingDeadline = new Date(date.getTime() - 60_000);
    deadlineAdjusted = true;
  }

  if (
    date.getTime() - now.getTime() < MIN_SESSION_LEAD_MS ||
    votingDeadline.getTime() <= now.getTime()
  ) {
    return { ok: false, error: "session_trop_proche" };
  }

  return { ok: true, date, votingDeadline, deadlineAdjusted };
}
