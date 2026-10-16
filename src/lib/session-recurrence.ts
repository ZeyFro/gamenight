export type SessionRecurrence = "weekly" | "monthly";

export function recurringSessionDates(first: Date, recurrence: SessionRecurrence, count: number): Date[] {
  if (!Number.isInteger(count) || count < 2 || count > 12) throw new RangeError("count must be between 2 and 12");
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(first);
    if (recurrence === "weekly") {
      date.setUTCDate(date.getUTCDate() + index * 7);
    } else if (recurrence === "monthly") {
      const weekday = first.getUTCDay();
      const ordinal = Math.floor((first.getUTCDate() - 1) / 7);
      const monthStart = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + index, 1));
      const lastDay = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)).getUTCDate();
      const day = 1 + (weekday - monthStart.getUTCDay() + 7) % 7 + ordinal * 7;
      date.setUTCFullYear(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day > lastDay ? day - 7 : day);
    } else {
      throw new TypeError("invalid recurrence");
    }
    return date;
  });
}
