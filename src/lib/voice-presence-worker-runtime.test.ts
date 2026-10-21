import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessionFindMany: vi.fn(),
  createSessionVoiceCollector: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { session: { findMany: mocks.sessionFindMany } } }));
vi.mock("./session-voice-collector", () => ({ createSessionVoiceCollector: mocks.createSessionVoiceCollector }));

import { startVoicePresenceWorkerRuntime } from "./voice-presence-worker-runtime";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DISCORD_BOT_GUILD_ID = "";
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("voice presence worker runtime (synthetic Prisma and Gateway only)", () => {
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
      onPersistenceError: expect.any(Function),
    }));
    expect(collector.start).toHaveBeenCalledOnce();

    await runtime.stop();
    expect(collector.stop).toHaveBeenCalledOnce();
    expect(processLike.once).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
  });

  it("uses the configured default guild only for the default community", async () => {
    process.env.DISCORD_BOT_GUILD_ID = "123456789012345678";
    mocks.sessionFindMany.mockResolvedValue([{
      id: "default-session",
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
