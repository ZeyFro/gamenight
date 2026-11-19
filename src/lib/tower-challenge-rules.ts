const HOUR_MS = 60 * 60 * 1000;
const parisDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
});

function timestamp(date: Date): number {
  const value = date.getTime();
  if (!Number.isFinite(value)) throw new RangeError("Date de défi invalide");
  return value;
}

const parisHourFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" });

/** Heure de Paris (0–23) à laquelle le défi d'équipe du jour devient attribuable (décision du 17/11/2026). */
export const TOWER_TEAM_DAILY_HOUR = 18;

/**
 * Règle pure : l'attribution du défi d'équipe n'est permise qu'à partir de 18:00:00 Europe/Paris
 * (CET et CEST) et reste permise jusqu'à minuit Paris ; l'unicité par jour de Paris est garantie
 * ailleurs par la clé `team-<jour de Paris>`.
 */
export function isTowerTeamDailyDue(date: Date): boolean {
  timestamp(date);
  return Number(parisHourFormatter.format(date)) >= TOWER_TEAM_DAILY_HOUR;
}

export function getTowerParisDayKey(date: Date): string {
  timestamp(date);
  return parisDayFormatter.format(date);
}

export function challengeProofDeadline(assignedAt: Date): Date {
  return new Date(timestamp(assignedAt) + 48 * HOUR_MS);
}

// Les délais sont des durées réelles, distinctes de l'horloge murale des soirées.
export function canClaimSoloChallenge(lastAssignedAt: Date | null, now: Date): boolean {
  const current = timestamp(now);
  return lastAssignedAt === null || current - timestamp(lastAssignedAt) >= 12 * HOUR_MS;
}

export function msUntilSoloChallengeAvailable(lastAssignedAt: Date | null, now: Date): number {
  const current = timestamp(now);
  if (lastAssignedAt === null) return 0;
  const elapsed = current - timestamp(lastAssignedAt);
  return elapsed >= 12 * HOUR_MS ? 0 : 12 * HOUR_MS - elapsed;
}

export function canSubmitChallengeProof(assignedAt: Date, now: Date): boolean {
  const elapsed = timestamp(now) - timestamp(assignedAt);
  return elapsed >= 0 && elapsed < 48 * HOUR_MS;
}

export function isChallengeProofExpired(assignedAt: Date, now: Date): boolean {
  return timestamp(now) - timestamp(assignedAt) >= 48 * HOUR_MS;
}

// À appeler sous verrou transactionnel avec les réussites solo ET équipe du membre.
export function canReceiveChallengeReward(completedAt: readonly Date[], now: Date): boolean {
  const current = timestamp(now);
  const today = parisDayFormatter.format(now);
  let count = 0;
  for (const completed of completedAt) {
    if (timestamp(completed) > current) throw new RangeError("Réussite dans le futur");
    if (parisDayFormatter.format(completed) === today) count += 1;
  }
  return count < 2;
}

export function remainingChallengeRewardsToday(completedAt: readonly Date[], now: Date): number {
  const current = timestamp(now);
  const today = parisDayFormatter.format(now);
  let count = 0;
  for (const completed of completedAt) {
    if (timestamp(completed) > current) throw new RangeError("Réussite dans le futur");
    if (parisDayFormatter.format(completed) === today) count += 1;
  }
  return Math.max(0, 2 - count);
}
