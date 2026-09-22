import { describe, expect, it } from "vitest";
import { HISTORY_VISIBILITY_WINDOW_DAYS, isWithinHistoryWindow } from "@/lib/history-visibility";

describe("isWithinHistoryWindow", () => {
  it("expose une fenêtre de 7 jours (référence pour tout appelant)", () => {
    expect(HISTORY_VISIBILITY_WINDOW_DAYS).toBe(7);
  });

  it("juste en dessous de la fenêtre (7 jours moins 1ms) : encore dedans", () => {
    const now = new Date("2026-09-22T10:00:00.000Z");
    const referenceDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000 + 1);
    expect(isWithinHistoryWindow(referenceDate, now)).toBe(true);
  });

  it("exactement 7 jours pile : hors fenêtre (frontière stricte, en millisecondes pleines)", () => {
    const now = new Date("2026-09-22T10:00:00.000Z");
    const referenceDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(isWithinHistoryWindow(referenceDate, now)).toBe(false);
  });

  it("référence future (horloge décalée, ne devrait jamais arriver en pratique) : toujours dedans, jamais un plantage", () => {
    const now = new Date("2026-09-22T10:00:00.000Z");
    const referenceDate = new Date("2026-09-23T10:00:00.000Z");
    expect(isWithinHistoryWindow(referenceDate, now)).toBe(true);
  });
});
