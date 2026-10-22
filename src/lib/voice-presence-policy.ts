const VOICE_PRESENCE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

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
