export type TemporaryVoiceCleanupDecision = 'keep' | 'delete';

export interface TemporaryVoiceCleanupInput {
  room: {
    kind: 'temporary' | 'persistent';
    managed: boolean;
    revision: string;
  };
  occupancy: {
    revision: string;
    members: number;
    observedAtMs: number;
    emptySinceMs: number | null;
  } | null;
  nowMs: number;
  graceMs: number;
  maxObservationAgeMs: number;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function decideTemporaryVoiceCleanup(
  input: TemporaryVoiceCleanupInput
): TemporaryVoiceCleanupDecision {
  const { room, occupancy, nowMs, graceMs, maxObservationAgeMs } = input;

  if (room.kind !== 'temporary' || !room.managed) {
    return 'keep';
  }

  if (typeof room.revision !== 'string' || room.revision.length === 0) {
    return 'keep';
  }

  if (occupancy === null) {
    return 'keep';
  }

  if (typeof occupancy.revision !== 'string' || occupancy.revision !== room.revision) {
    return 'keep';
  }

  if (!isSafeInteger(occupancy.members) || occupancy.members !== 0) {
    return 'keep';
  }

  if (!isSafeInteger(nowMs) || nowMs < 0) {
    return 'keep';
  }

  if (!isPositiveFiniteNumber(graceMs)) {
    return 'keep';
  }

  if (!isPositiveFiniteNumber(maxObservationAgeMs)) {
    return 'keep';
  }

  if (!isSafeInteger(occupancy.observedAtMs) || occupancy.observedAtMs < 0) {
    return 'keep';
  }

  if (occupancy.emptySinceMs === null) {
    return 'keep';
  }

  if (!isSafeInteger(occupancy.emptySinceMs) || occupancy.emptySinceMs < 0) {
    return 'keep';
  }

  if (occupancy.emptySinceMs > occupancy.observedAtMs) {
    return 'keep';
  }

  if (occupancy.observedAtMs > nowMs) {
    return 'keep';
  }

  if (nowMs - occupancy.observedAtMs > maxObservationAgeMs) {
    return 'keep';
  }

  if (nowMs - occupancy.emptySinceMs < graceMs) {
    return 'keep';
  }

  return 'delete';
}
