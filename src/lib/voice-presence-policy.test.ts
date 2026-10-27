import { describe, expect, it } from "vitest";
import { finalizeVoiceIntervalAtCutoff } from "./voice-presence-policy";

describe("voice presence retention and cutoff policy", () => {
  it("caps an in-flight interval at the durable session cutoff and marks it partial", () => {
    const startedAt = Date.parse("2026-10-22T19:00:00.000Z");
    const result = finalizeVoiceIntervalAtCutoff({
      startedAt,
      endedAt: startedAt + 20 * 60_000,
      cutoffAt: new Date(startedAt + 10 * 60_000),
      partial: false,
    });

    expect(result).toEqual({
      startedAt: new Date(startedAt),
      endedAt: new Date(startedAt + 10 * 60_000),
      durationSeconds: 600,
      partial: true,
      expiresAt: new Date(startedAt + 10 * 60_000 + 30 * 24 * 60 * 60_000),
    });
  });

  it("does not invent a duration when no positive interval was observed before the cutoff", () => {
    const cutoffAt = new Date("2026-10-22T19:10:00.000Z");
    expect(finalizeVoiceIntervalAtCutoff({
      startedAt: cutoffAt.getTime(),
      endedAt: cutoffAt.getTime() + 1_000,
      cutoffAt,
      partial: true,
    })).toBeNull();
  });

  it("retains a completed interval for 30 days from its effective end", () => {
    const startedAt = Date.parse("2026-10-22T19:00:00.000Z");
    const endedAt = startedAt + 90_000;
    expect(finalizeVoiceIntervalAtCutoff({ startedAt, endedAt, partial: false })).toMatchObject({
      durationSeconds: 90,
      partial: false,
      expiresAt: new Date(endedAt + 30 * 24 * 60 * 60_000),
    });
  });
});
