import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessionFindMany: vi.fn(),
  controlFindMany: vi.fn(),
  createSessionVoiceCollector: vi.fn(),
  claimLease: vi.fn(),
  validateLease: vi.fn(),
  finalizeCommand: vi.fn(),
  markGap: vi.fn(),
  markGapRecovered: vi.fn(),
  releaseLease: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {
  session: { findMany: mocks.sessionFindMany },
  sessionVoicePresenceControl: { findMany: mocks.controlFindMany, updateMany: vi.fn() },
} }));
vi.mock("./session-voice-collector", () => ({ createSessionVoiceCollector: mocks.createSessionVoiceCollector }));
vi.mock("./voice-presence-coordination", () => ({
  claimSessionVoicePresenceLease: mocks.claimLease,
  validateSessionVoicePresenceLease: mocks.validateLease,
  finalizeSessionVoicePresenceCommand: mocks.finalizeCommand,
  markSessionVoicePresenceGap: mocks.markGap,
  markSessionVoicePresenceGapRecovered: mocks.markGapRecovered,
  releaseSessionVoicePresenceLease: mocks.releaseLease,
}));

import { startVoicePresenceWorkerRuntime } from "./voice-presence-worker-runtime";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DISCORD_BOT_GUILD_ID = "";
  mocks.controlFindMany.mockResolvedValue([]);
  mocks.claimLease.mockResolvedValue({ claimed: true, generation: 1, gapDetected: false });
  mocks.validateLease.mockResolvedValue(true);
  mocks.finalizeCommand.mockResolvedValue(true);
  mocks.releaseLease.mockResolvedValue([]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("voice presence worker runtime (synthetic Prisma and Gateway only)", () => {
  it("leaves shutdown signals to the host so in-flight HTTP can finish before the worker stops", async () => {
    const state = (globalThis as typeof globalThis & {
      __gamenightVoicePresenceWorkerState: { hostOwnsSignals?: boolean };
    }).__gamenightVoicePresenceWorkerState;
    state.hostOwnsSignals = true;
    mocks.sessionFindMany.mockResolvedValue([]);
    const processLike = { once: vi.fn(), removeListener: vi.fn() };
    const runtime = await startVoicePresenceWorkerRuntime(
      { token: "synthetic-token", pollIntervalMs: 15_000 },
      { processLike, onFatal: vi.fn() },
    );
    try {
      expect(processLike.once).not.toHaveBeenCalled();
    } finally {
      await runtime.stop();
      state.hostOwnsSignals = false;
    }
  });

  it("waits for the same pending flush when shutdown and the host both stop the runtime", async () => {
    mocks.sessionFindMany.mockResolvedValue([{
      id: "session-active",
      voicePresenceConsents: [{ id: "consent-1" }],
      community: { slug: "community-a", discordGuildId: "123456789012345678", channelConfigs: [{ discordChannelId: "456789012345678901" }] },
    }]);
    let resolveFlush!: () => void;
    const collector = { start: vi.fn(), stop: vi.fn(() => new Promise<void>(resolve => { resolveFlush = resolve; })) };
    mocks.createSessionVoiceCollector.mockReturnValue(collector);
    const processLike = { once: vi.fn(), removeListener: vi.fn() };
    const runtime = await startVoicePresenceWorkerRuntime(
      { token: "synthetic-token", pollIntervalMs: 15_000 },
      { processLike, onFatal: vi.fn() },
    );
    const shutdown = processLike.once.mock.calls.find(([signal]) => signal === "SIGTERM")![1];
    const hostStop = (globalThis as typeof globalThis & {
      __gamenightVoicePresenceWorkerState?: { stop?: () => Promise<void> };
    }).__gamenightVoicePresenceWorkerState?.stop;
    expect(hostStop).toBe(runtime.stop);
    shutdown();
    let stopped = false;
    const stopping = hostStop!().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    resolveFlush();
    await stopping;
    expect(collector.stop).toHaveBeenCalledOnce();
  });

  it("drains queued gap and recovery writes before releasing the lease on orderly shutdown", async () => {
    mocks.sessionFindMany.mockResolvedValue([{
      id: "session-gap-shutdown",
      voicePresenceConsents: [{ id: "consent-1" }],
      community: { slug: "community-a", discordGuildId: "123456789012345678", channelConfigs: [{ discordChannelId: "456789012345678901" }] },
    }]);
    let callbacks!: { onGap: (reason: "resume_failed" | "transport_closed" | "shutdown" | "fatal_close" | "guild_unavailable" | "guild_removed") => void; onGapRecovered: (at: number) => void };
    const order: string[] = [];
    let resolveFirstGap!: () => void;
    let resolveRecovery!: () => void;
    let resolveShutdownGap!: () => void;
    const firstGap = new Promise<void>(resolve => { resolveFirstGap = resolve; });
    const recovery = new Promise<void>(resolve => { resolveRecovery = resolve; });
    const shutdownGap = new Promise<void>(resolve => { resolveShutdownGap = resolve; });
    let gapWrites = 0;
    mocks.markGap.mockReset().mockImplementation(() => {
      gapWrites += 1;
      return gapWrites === 1 ? firstGap : shutdownGap.then(() => { order.push("shutdown-gap-done"); });
    });
    mocks.markGapRecovered.mockReset().mockImplementation(() => recovery.then(() => { order.push("recovery-done"); }));
    mocks.releaseLease.mockImplementation(async () => { order.push("release"); return []; });
    const collector = {
      start: vi.fn(),
      stop: vi.fn(() => { callbacks.onGap("shutdown"); }),
    };
    mocks.createSessionVoiceCollector.mockImplementation((_env, options) => {
      callbacks = options;
      return collector;
    });
    const runtime = await startVoicePresenceWorkerRuntime(
      { token: "synthetic-token", pollIntervalMs: 15_000 },
      { processLike: { once: vi.fn(), removeListener: vi.fn() }, onFatal: vi.fn() },
    );

    callbacks.onGap("transport_closed");
    callbacks.onGapRecovered(1_800_000_000_000);
    const stopping = runtime.stop();
    await vi.waitFor(() => expect(mocks.markGap).toHaveBeenCalledOnce());
    expect(mocks.markGapRecovered).not.toHaveBeenCalled();
    expect(mocks.releaseLease).not.toHaveBeenCalled();

    resolveFirstGap();
    await vi.waitFor(() => expect(mocks.markGapRecovered).toHaveBeenCalledOnce());
    expect(mocks.releaseLease).not.toHaveBeenCalled();

    resolveRecovery();
    await vi.waitFor(() => expect(mocks.markGap).toHaveBeenCalledTimes(2));
    expect(mocks.releaseLease).not.toHaveBeenCalled();

    resolveShutdownGap();
    await stopping;
    expect(order).toEqual(["recovery-done", "shutdown-gap-done", "release"]);
    expect(collector.stop).toHaveBeenCalledOnce();
  });

  it("drains queued gap writes before releasing and purging a cancelled session", async () => {
    mocks.sessionFindMany
      .mockResolvedValueOnce([{
        id: "session-gap-purge",
        voicePresenceConsents: [{ id: "consent-1" }],
        community: { slug: "community-a", discordGuildId: "123456789012345678", channelConfigs: [{ discordChannelId: "456789012345678901" }] },
      }])
      .mockResolvedValueOnce([]);
    let callbacks!: { onGap: (reason: "resume_failed" | "transport_closed" | "shutdown" | "fatal_close" | "guild_unavailable" | "guild_removed") => void };
    let resolveGap!: () => void;
    const gapWrite = new Promise<void>(resolve => { resolveGap = resolve; });
    const order: string[] = [];
    mocks.markGap.mockReset().mockReturnValue(gapWrite.then(() => { order.push("gap-done"); }));
    mocks.releaseLease.mockImplementation(async () => { order.push("release"); return []; });
    mocks.finalizeCommand.mockImplementation(async () => { order.push("purge"); return true; });
    mocks.createSessionVoiceCollector.mockImplementation((_env, options) => {
      callbacks = options;
      return { start: vi.fn(), stop: vi.fn() };
    });
    const runtime = await startVoicePresenceWorkerRuntime(
      { token: "synthetic-token", pollIntervalMs: 15_000 },
      { processLike: { once: vi.fn(), removeListener: vi.fn() }, onFatal: vi.fn() },
    );
    callbacks.onGap("guild_removed");
    await vi.waitFor(() => expect(mocks.markGap).toHaveBeenCalledOnce());
    mocks.controlFindMany.mockResolvedValue([{
      sessionId: "session-gap-purge",
      status: "PURGE_REQUESTED",
      stopAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
      generation: 2,
    }]);

    const refreshing = runtime.refresh();
    await vi.waitFor(() => expect(mocks.sessionFindMany).toHaveBeenCalledTimes(2));
    expect(mocks.releaseLease).not.toHaveBeenCalled();
    expect(mocks.finalizeCommand).not.toHaveBeenCalled();

    resolveGap();
    await refreshing;
    expect(order).toEqual(["gap-done", "release", "purge"]);
    expect(mocks.finalizeCommand).toHaveBeenCalledWith("session-gap-purge");
    await runtime.stop();
  });

  it.each([
    ["2026-07-21T18:00:00Z", "2026-07-21T20:00:00Z"],
    ["2026-12-21T19:00:00Z", "2026-12-21T20:00:00Z"],
  ])("discovers due sessions at Paris wall-clock time for %s", async (instant, dueAt) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(instant));
    mocks.sessionFindMany.mockResolvedValue([]);
    const runtime = await startVoicePresenceWorkerRuntime(
      { token: "synthetic-token", pollIntervalMs: 15_000 },
      { processLike: { once: vi.fn(), removeListener: vi.fn() }, onFatal: vi.fn() },
    );

    await runtime.stop();
    expect(mocks.sessionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ date: { lte: new Date(dueAt) } }),
    }));
  });

  it("starts collectors for started scheduled sessions with active configured voice channels", async () => {
    mocks.sessionFindMany.mockResolvedValue([{
      id: "session-active",
      voicePresenceConsents: [{ id: "consent-1" }],
      community: {
        slug: "community-a",
        discordGuildId: "123456789012345678",
        channelConfigs: [
          { discordChannelId: "456789012345678901" },
          { discordChannelId: "567890123456789012" },
        ],
      },
    }]);
    const collector = { start: vi.fn(), stop: vi.fn() };
    mocks.createSessionVoiceCollector.mockReturnValue(collector);
    const processLike = { once: vi.fn(), removeListener: vi.fn() };
    const runtime = await startVoicePresenceWorkerRuntime(
      { token: "synthetic-token", pollIntervalMs: 15_000 },
      { processLike, onFatal: vi.fn() },
    );

    expect(mocks.sessionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: "SCHEDULED",
        date: { lte: expect.any(Date) },
        community: expect.objectContaining({ is: expect.objectContaining({
          status: "ACTIVE",
          channelConfigs: { some: { category: "VOICE", enabled: true } },
        }) }),
      }),
    }));
    expect(mocks.createSessionVoiceCollector).toHaveBeenCalledWith(expect.objectContaining({
      VOICE_PRESENCE_ENABLED: "true",
      VOICE_PRESENCE_SESSION_ID: "session-active",
      VOICE_PRESENCE_GUILD_ID: "123456789012345678",
      VOICE_PRESENCE_CHANNEL_IDS: "456789012345678901,567890123456789012",
    }), expect.objectContaining({
      onFatal: expect.any(Function),
      onGapRecovered: expect.any(Function),
      onPersistenceError: expect.any(Function),
    }));
    const collectorCallbacks = mocks.createSessionVoiceCollector.mock.calls[0][1];
    let resolveGapWrite!: () => void;
    mocks.markGap.mockImplementation(() => new Promise<void>(resolve => { resolveGapWrite = resolve; }));
    collectorCallbacks.onGap("transport_closed");
    collectorCallbacks.onGapRecovered(1_800_000_000_000);
    await vi.waitFor(() => expect(mocks.markGap).toHaveBeenCalledOnce());
    expect(mocks.markGapRecovered).not.toHaveBeenCalled();
    resolveGapWrite();
    await vi.waitFor(() => expect(mocks.markGapRecovered).toHaveBeenCalledOnce());
    expect(mocks.markGap).toHaveBeenCalledWith("session-active", expect.any(String), 1, expect.any(Date));
    expect(mocks.markGapRecovered).toHaveBeenCalledWith(
      "session-active",
      expect.any(String),
      1,
      new Date(1_800_000_000_000),
    );
    expect(collector.start).toHaveBeenCalledOnce();

    await runtime.stop();
    expect(collector.stop).toHaveBeenCalledOnce();
    expect(processLike.once).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
  });

  it("uses the configured default guild only for the default community", async () => {
    process.env.DISCORD_BOT_GUILD_ID = "123456789012345678";
    mocks.sessionFindMany.mockResolvedValue([{
      id: "default-session",
      voicePresenceConsents: [{ id: "consent-1" }],
      community: {
        slug: "default",
        discordGuildId: null,
        channelConfigs: [{ discordChannelId: "456789012345678901" }],
      },
    }]);
    const collector = { start: vi.fn(), stop: vi.fn() };
    mocks.createSessionVoiceCollector.mockReturnValue(collector);
    const runtime = await startVoicePresenceWorkerRuntime(
      { token: "synthetic-token", pollIntervalMs: 15_000 },
      { processLike: { once: vi.fn(), removeListener: vi.fn() }, onFatal: vi.fn() },
    );

    await runtime.stop();
    expect(mocks.createSessionVoiceCollector).toHaveBeenCalledWith(expect.objectContaining({
      VOICE_PRESENCE_GUILD_ID: "123456789012345678",
      DISCORD_BOT_GUILD_ID: "123456789012345678",
    }), expect.any(Object));
  });

  it("does not claim a lease or create a collector before individual opt-in", async () => {
    mocks.sessionFindMany.mockResolvedValue([{
      id: "session-no-consent",
      voicePresenceConsents: [],
      community: { slug: "community-a", discordGuildId: "123456789012345678", channelConfigs: [{ discordChannelId: "456789012345678901" }] },
    }]);
    const runtime = await startVoicePresenceWorkerRuntime(
      { token: "synthetic-token", pollIntervalMs: 15_000 },
      { processLike: { once: vi.fn(), removeListener: vi.fn() }, onFatal: vi.fn() },
    );

    await runtime.stop();
    expect(mocks.claimLease).not.toHaveBeenCalled();
    expect(mocks.createSessionVoiceCollector).not.toHaveBeenCalled();
  });

  it("revalidates a claimed target after discovery and before constructing its Gateway collector", async () => {
    mocks.sessionFindMany.mockResolvedValue([{
      id: "session-revoked-before-start",
      voicePresenceConsents: [{ id: "consent-1" }],
      community: { slug: "community-a", discordGuildId: "123456789012345678", channelConfigs: [{ discordChannelId: "456789012345678901" }] },
    }]);
    // Simulates withdrawal committing after loadTargets/claim and before the
    // runtime's final authorization check.
    mocks.validateLease.mockResolvedValue(false);
    const runtime = await startVoicePresenceWorkerRuntime(
      { token: "synthetic-token", pollIntervalMs: 15_000 },
      { processLike: { once: vi.fn(), removeListener: vi.fn() }, onFatal: vi.fn() },
    );

    try {
      expect(mocks.claimLease).toHaveBeenCalledOnce();
      expect(mocks.validateLease).toHaveBeenCalledWith("session-revoked-before-start", expect.any(String), 1, expect.any(Date));
      expect(mocks.claimLease.mock.invocationCallOrder[0]).toBeLessThan(mocks.validateLease.mock.invocationCallOrder[0]);
      expect(mocks.createSessionVoiceCollector).not.toHaveBeenCalled();
    } finally {
      await runtime.stop();
    }
  });

  it("surfaces startup failure without forwarding database error details to Next logs", async () => {
    mocks.sessionFindMany.mockRejectedValue(new Error("synthetic database URL detail"));
    const onFatal = vi.fn();

    await expect(startVoicePresenceWorkerRuntime(
      { token: "synthetic-token", pollIntervalMs: 15_000 },
      { processLike: { once: vi.fn(), removeListener: vi.fn() }, onFatal },
    )).rejects.toThrow("Voice presence worker failed to start");

    expect(onFatal).toHaveBeenCalledWith(expect.objectContaining({ kind: "discovery" }));
  });
});
