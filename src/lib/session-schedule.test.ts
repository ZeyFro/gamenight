import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveSessionSchedule } from "@/lib/session-schedule";

describe("resolveSessionSchedule", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // "Maintenant" = 2026-06-15T12:00 heure de Paris (été, CEST = UTC+2 ⇒
    // 10:00 UTC réel). `resolveSessionSchedule` compare via `wallClockNow()`.
    vi.setSystemTime(new Date("2026-06-15T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cas normal : deadline explicite valide, avant la session, sans ajustement", () => {
    const result = resolveSessionSchedule({
      dateStr: "2026-06-16",
      timeStr: "20:00",
      deadlineDateStr: "2026-06-16",
      deadlineTimeStr: "18:00",
      deadlineOffset: "6",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deadlineAdjusted).toBe(false);
    expect(result.date).toEqual(new Date(Date.UTC(2026, 5, 16, 20, 0)));
    expect(result.votingDeadline).toEqual(new Date(Date.UTC(2026, 5, 16, 18, 0)));
  });

  it("deadline calculée depuis deadlineOffset quand aucune deadline explicite n'est fournie", () => {
    const result = resolveSessionSchedule({
      dateStr: "2026-06-16",
      timeStr: "20:00",
      deadlineDateStr: "",
      deadlineTimeStr: "",
      deadlineOffset: "2",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.votingDeadline).toEqual(new Date(Date.UTC(2026, 5, 16, 18, 0)));
  });

  it("deadline déjà dans le passé → repoussée à maintenant + 30 min", () => {
    // Deadline calculée (session - 6h) tombe avant "maintenant" (12:00) :
    // session à 14:00 - 6h = 08:00, largement dans le passé.
    const result = resolveSessionSchedule({
      dateStr: "2026-06-15",
      timeStr: "14:00",
      deadlineDateStr: "",
      deadlineTimeStr: "",
      deadlineOffset: "6",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deadlineAdjusted).toBe(true);
    expect(result.votingDeadline).toEqual(new Date(Date.UTC(2026, 5, 15, 12, 30)));
  });

  it("deadline qui dépasserait l'heure de la session → recalée à 1 min avant", () => {
    const result = resolveSessionSchedule({
      dateStr: "2026-06-16",
      timeStr: "20:00",
      deadlineDateStr: "2026-06-16",
      deadlineTimeStr: "20:00",
      deadlineOffset: "6",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.deadlineAdjusted).toBe(true);
    expect(result.votingDeadline).toEqual(new Date(Date.UTC(2026, 5, 16, 19, 59)));
  });

  it("refuse une session trop proche (moins de 30 min avant maintenant)", () => {
    const result = resolveSessionSchedule({
      dateStr: "2026-06-15",
      timeStr: "12:10",
      deadlineDateStr: "",
      deadlineTimeStr: "",
      deadlineOffset: "6",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("session_trop_proche");
  });

  it("refuse une session déjà passée", () => {
    const result = resolveSessionSchedule({
      dateStr: "2026-06-15",
      timeStr: "09:00",
      deadlineDateStr: "",
      deadlineTimeStr: "",
      deadlineOffset: "6",
    });

    expect(result.ok).toBe(false);
  });
});
