import { describe, expect, it } from "vitest";
import { applyVoiceState } from "./discord-voice-presence";

describe("voice presence state", () => {
  it("keeps the original join time across duplicate events and closes on leave", () => {
    const joined = applyVoiceState(new Map(), { memberKey: "fake-member", channelId: "voice-a", at: 1_000 });
    const repeated = applyVoiceState(joined.active, { memberKey: "fake-member", channelId: "voice-a", at: 2_000 });
    const left = applyVoiceState(repeated.active, { memberKey: "fake-member", channelId: null, at: 4_000 });

    expect(joined.closed).toBeNull();
    expect(repeated.closed).toBeNull();
    expect(left.closed).toEqual({ memberKey: "fake-member", channelId: "voice-a", startedAt: 1_000, endedAt: 4_000 });
    expect(left.active.size).toBe(0);
  });

  it("closes the old channel and starts a new interval on move", () => {
    const joined = applyVoiceState(new Map(), { memberKey: "fake-member", channelId: "voice-a", at: 1_000 });
    const moved = applyVoiceState(joined.active, { memberKey: "fake-member", channelId: "voice-b", at: 3_000 });

    expect(moved.closed).toEqual({ memberKey: "fake-member", channelId: "voice-a", startedAt: 1_000, endedAt: 3_000 });
    expect(moved.active.get("fake-member")).toEqual({ channelId: "voice-b", startedAt: 3_000 });
    expect(joined.active.get("fake-member")).toEqual({ channelId: "voice-a", startedAt: 1_000 });
  });

  it("ignores an unknown leave and a stale event", () => {
    const unknown = applyVoiceState(new Map(), { memberKey: "fake-member", channelId: null, at: 1_000 });
    const joined = applyVoiceState(unknown.active, { memberKey: "fake-member", channelId: "voice-a", at: 3_000 });
    const stale = applyVoiceState(joined.active, { memberKey: "fake-member", channelId: null, at: 2_000 });

    expect(unknown.closed).toBeNull();
    expect(stale.closed).toBeNull();
    expect(stale.active.get("fake-member")).toEqual({ channelId: "voice-a", startedAt: 3_000 });
  });

  it("rejects invalid event time", () => {
    expect(() => applyVoiceState(new Map(), { memberKey: "fake-member", channelId: "voice-a", at: Number.NaN })).toThrow("Invalid voice event time");
  });
});
