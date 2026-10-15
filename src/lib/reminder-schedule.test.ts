import { describe, expect, it } from "vitest";
import { applyReminderResults, computeTimingsDue, isReminderForSchedule, reminderOccurrence, reminderScheduleKey, reminderSchedulePayload } from "./reminders";

const date = new Date("2026-11-01T20:00:00.000Z");
const schedule = (generation = "") => ({ date, remindersSent: generation ? [`schedule:${generation}`] : [] });

describe("génération des rappels après replanification", () => {
  it("conserve les anciennes clés tant que la date n'est pas modifiée", () => {
    expect(reminderScheduleKey([])).toBe("");
    expect(reminderOccurrence(60, [])).toBe("60");
    expect(isReminderForSchedule(null, schedule())).toBe(true);
  });

  it("sépare les livraisons de deux replanifications, même pour la même date", () => {
    expect(reminderOccurrence(60, schedule("a").remindersSent)).toBe("60:a");
    expect(reminderOccurrence(60, schedule("b").remindersSent)).toBe("60:b");
    expect(isReminderForSchedule(reminderSchedulePayload(schedule("a")), schedule("b"))).toBe(false);
  });

  it("refuse une livraison d'une ancienne date ou sans métadonnées après modification", () => {
    const payload = reminderSchedulePayload(schedule("a"));
    expect(isReminderForSchedule(payload, { ...schedule("a"), date: new Date(date.getTime() + 60_000) })).toBe(false);
    expect(isReminderForSchedule(null, schedule("a"))).toBe(false);
    expect(isReminderForSchedule(payload, schedule("a"))).toBe(true);
  });

  it.each([{}, [], "invalide", 42])("refuse des métadonnées invalides : %j", payload => {
    expect(isReminderForSchedule(payload, schedule())).toBe(false);
  });

  it("préserve la génération pendant la fusion et ne la traite jamais comme un seuil envoyé", () => {
    const remindersSent = applyReminderResults(["schedule:a"], [{ minutes: 60, ok: true }]);
    expect(remindersSent).toEqual(["schedule:a", "60"]);
    expect(reminderScheduleKey(remindersSent)).toBe("a");
    expect(computeTimingsDue({ date, reminderTimings: [60], remindersSent: ["schedule:a"] }, new Date(date.getTime() - 60 * 60_000)).toSend?.minutes).toBe(60);
    expect(computeTimingsDue({ date, reminderTimings: [60], remindersSent }, new Date(date.getTime() - 60 * 60_000)).toSend).toBeNull();
  });
});
