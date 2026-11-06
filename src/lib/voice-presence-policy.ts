import { toWallClock } from "@/lib/wallclock";

export const VOICE_PRESENCE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

/**
 * Borne dure de la collecte (décision propriétaire D7) : jamais plus de 12 h après `Session.date`, même si le cron
 * `close-sessions` est absent et que la soirée reste `SCHEDULED`. `Session.date` est une heure murale (voir wallclock.ts) :
 * toute comparaison à cette borne se fait en heure murale, jamais contre un instant réel.
 */
export const VOICE_PRESENCE_MAX_COLLECTION_MS = 12 * 60 * 60 * 1_000;

/** Plus ancienne `Session.date` (heure murale) encore collectable à l'instant mural `wallNow` : `date >= wallNow - 12 h`. */
export function voiceCollectionEarliestSessionDate(wallNow: Date) {
  return new Date(wallNow.getTime() - VOICE_PRESENCE_MAX_COLLECTION_MS);
}

/**
 * Date de soirée (heure murale) à partir de laquelle un enregistrement de collecte n'est plus conservé que par la rétention :
 * borne de 12 h + 30 jours. Sert à purger les accords/lacunes d'une soirée restée `SCHEDULED` sans clôture.
 */
export function voiceCollectionRetentionSessionDate(wallNow: Date) {
  return new Date(wallNow.getTime() - VOICE_PRESENCE_MAX_COLLECTION_MS - VOICE_PRESENCE_RETENTION_MS);
}

/**
 * Instant réel où la borne de 12 h tombe pour un intervalle commencé à `startedAt` (instant réel) dans la soirée `sessionDate`.
 * La différence est calculée en heure murale puis ajoutée à l'instant réel de début : exact hors changement d'heure
 * pendant l'intervalle (au pire un écart d'une heure sur une fin d'intervalle qui chevauche la bascule, toujours borné par 12 h + 1 h).
 */
export function voiceCollectionCutoffForInterval(sessionDate: Date, startedAt: number) {
  const wallStartedAt = toWallClock(new Date(startedAt)).getTime();
  return new Date(startedAt + sessionDate.getTime() + VOICE_PRESENCE_MAX_COLLECTION_MS - wallStartedAt);
}

export function finalizeVoiceIntervalAtCutoff(input: {
  startedAt: number;
  endedAt: number;
  cutoffAt?: Date | null;
  partial: boolean;
}) {
  if (!Number.isFinite(input.startedAt) || !Number.isFinite(input.endedAt)) return null;
  const endedAt = input.cutoffAt
    ? Math.min(input.endedAt, input.cutoffAt.getTime())
    : input.endedAt;
  const durationSeconds = Math.floor((endedAt - input.startedAt) / 1_000);
  if (durationSeconds < 1) return null;

  return {
    startedAt: new Date(input.startedAt),
    endedAt: new Date(endedAt),
    durationSeconds,
    partial: input.partial || endedAt < input.endedAt,
    expiresAt: new Date(endedAt + VOICE_PRESENCE_RETENTION_MS),
  };
}
