const HOUR_MS = 60 * 60 * 1000;
const parisDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
});

function timestamp(date: Date): number {
  const value = date.getTime();
  if (!Number.isFinite(value)) throw new RangeError("Date de défi invalide");
  return value;
}

export function getTowerParisDayKey(date: Date): string {
  timestamp(date);
  return parisDayFormatter.format(date);
}

// Les délais sont des durées réelles, distinctes de l'horloge murale des soirées.
export function canClaimSoloChallenge(lastAssignedAt: Date | null, now: Date): boolean {
  const current = timestamp(now);
  return lastAssignedAt === null || current - timestamp(lastAssignedAt) >= 12 * HOUR_MS;
}

export function canSubmitChallengeProof(assignedAt: Date, now: Date): boolean {
  const elapsed = timestamp(now) - timestamp(assignedAt);
  return elapsed >= 0 && elapsed < 48 * HOUR_MS;
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
