import { describe, expect, it } from "vitest";
import {
  finalizeVoiceIntervalAtCutoff,
  VOICE_PRESENCE_MAX_COLLECTION_MS,
  VOICE_PRESENCE_RETENTION_MS,
  voiceCollectionCutoffForInterval,
  voiceCollectionEarliestSessionDate,
  voiceCollectionRetentionSessionDate,
} from "./voice-presence-policy";
import { toWallClock } from "@/lib/wallclock";

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

  it("fixe la borne de collecte à 12 h après la date de la soirée (heure murale)", () => {
    expect(VOICE_PRESENCE_MAX_COLLECTION_MS).toBe(12 * 3_600_000);
    const wallNow = new Date("2026-10-24T20:00:00.000Z");
    expect(voiceCollectionEarliestSessionDate(wallNow)).toEqual(new Date("2026-10-24T08:00:00.000Z"));
    expect(voiceCollectionRetentionSessionDate(wallNow).getTime())
      .toBe(wallNow.getTime() - VOICE_PRESENCE_MAX_COLLECTION_MS - VOICE_PRESENCE_RETENTION_MS);
  });

  it.each([
    ["en été (CEST)", "2026-07-14T18:30:00.000Z", "2026-07-14T20:00:00.000Z"],
    ["en hiver (CET)", "2027-01-14T18:30:00.000Z", "2027-01-14T20:00:00.000Z"],
  ])("la fin de collecte d'un intervalle commencé %s tombe exactement 12 h après Session.date", (_label, startIso, sessionWallIso) => {
    const startedAt = Date.parse(startIso);
    const sessionDate = new Date(sessionWallIso); // heure murale : 20:00 à Paris
    const cutoff = voiceCollectionCutoffForInterval(sessionDate, startedAt);
    // En heure murale (Paris), la coupure est à 08:00 le lendemain, soit sessionDate + 12 h.
    expect(toWallClock(cutoff).getTime()).toBe(sessionDate.getTime() + VOICE_PRESENCE_MAX_COLLECTION_MS);
    const interval = finalizeVoiceIntervalAtCutoff({ startedAt, endedAt: startedAt + 20 * 3_600_000, cutoffAt: cutoff, partial: false });
    expect(interval?.partial).toBe(true);
    expect(toWallClock(interval!.endedAt).getTime()).toBe(sessionDate.getTime() + VOICE_PRESENCE_MAX_COLLECTION_MS);
  });
});
