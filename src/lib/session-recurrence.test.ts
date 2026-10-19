import { describe, expect, it } from "vitest";
import { isRecurringSeriesCancellationEnabled, recurringSessionDates } from "./session-recurrence";

describe("recurringSessionDates", () => {
  it("enables group cancellation only for the exact true flag", () => {
    expect(isRecurringSeriesCancellationEnabled({})).toBe(false);
    expect(isRecurringSeriesCancellationEnabled({ SESSION_SERIES_CANCEL_ENABLED: "TRUE" })).toBe(false);
    expect(isRecurringSeriesCancellationEnabled({ SESSION_SERIES_CANCEL_ENABLED: "true" })).toBe(true);
  });

  it("keeps weekly wall-clock time and weekday", () => {
    const dates = recurringSessionDates(new Date("2026-10-16T20:30:00Z"), "weekly", 4);
    expect(dates.map((date) => date.toISOString())).toEqual([
      "2026-10-16T20:30:00.000Z", "2026-10-23T20:30:00.000Z",
      "2026-10-30T20:30:00.000Z", "2026-11-06T20:30:00.000Z",
    ]);
  });

  it("keeps the weekday ordinal monthly and clamps a missing fifth weekday to the last one", () => {
    const firstSaturday = recurringSessionDates(new Date("2026-10-03T19:00:00Z"), "monthly", 4);
    expect(firstSaturday.map((date) => date.toISOString())).toEqual([
      "2026-10-03T19:00:00.000Z", "2026-11-07T19:00:00.000Z",
      "2026-12-05T19:00:00.000Z", "2027-01-02T19:00:00.000Z",
    ]);

    const fifthSaturday = recurringSessionDates(new Date("2026-10-31T19:00:00Z"), "monthly", 2);
    expect(fifthSaturday[1].toISOString()).toBe("2026-11-28T19:00:00.000Z");
  });

  it("rejects an invalid number of occurrences", () => {
    expect(() => recurringSessionDates(new Date(), "weekly", 13)).toThrow(RangeError);
  });
});
