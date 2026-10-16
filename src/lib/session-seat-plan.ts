export type SeatStatus = "CONFIRMED" | "WAITLIST" | "DECLINED";
export interface SeatEntry { userId: string; status: SeatStatus; requestedAt: Date }

/** Le créateur garde ses rappels de gestion ; un invité en attente ou
 * désisté ne reçoit plus un rappel déjà en file avant son changement. */
export function isSeatReminderRecipient(capacity: number | null | undefined, creatorId: string, userId: string, confirmedIds: string[], hasSeatRsvps = capacity != null): boolean {
  return !hasSeatRsvps || creatorId === userId || confirmedIds.includes(userId);
}

export function isPromotionDmRecipient(status: string, capacity: number | null | undefined, userId: string, confirmedIds: string[]): boolean {
  return status === "SCHEDULED" && capacity != null && confirmedIds.includes(userId);
}

/** Les confirmés gardent leur place ; les autres avancent en FIFO.
 * Un ancien membre n'est jamais promu. Aucun décliné n'est réinscrit. */
export function planSessionSeats(rows: SeatEntry[], eligibleIds: Set<string>, capacity: number | null): Map<string, SeatStatus> {
  if (capacity === null) return new Map(rows.map(row => [row.userId, eligibleIds.has(row.userId) && row.status !== "DECLINED" ? "CONFIRMED" : "DECLINED"]));
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) throw new Error("Capacité invalide");
  const sorted = [...rows].sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime() || a.userId.localeCompare(b.userId));
  const result = new Map(rows.map(row => [row.userId, eligibleIds.has(row.userId) ? row.status : "DECLINED" as SeatStatus]));
  let remaining = capacity - sorted.filter(row => result.get(row.userId) === "CONFIRMED").length;
  if (remaining < 0) throw new Error("Des places confirmées seraient perdues");
  for (const row of sorted) {
    if (result.get(row.userId) !== "WAITLIST" || remaining === 0) continue;
    result.set(row.userId, "CONFIRMED"); remaining--;
  }
  return result;
}
