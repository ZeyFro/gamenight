import { afterEach, describe, expect, it, vi } from "vitest";
import { createVoiceGatewayCollector, installVoiceCollectorShutdownHandlers, voiceGatewayConfig } from "./discord-voice-gateway";

class FakeSocket {
  listeners = new Map<string, (event: { data?: unknown; code?: number }) => void>();
  sent: Array<{ op: number; d: unknown }> = [];
  closeCode: number | undefined;
  addEventListener(type: string, listener: (event: { data?: unknown; code?: number }) => void) { this.listeners.set(type, listener); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close(code?: number) { this.closeCode = code; this.listeners.get("close")?.({ code }); }
  emit(op: number, d: unknown, s: number | null = null, t: string | null = null) {
    this.listeners.get("message")?.({ data: JSON.stringify({ op, d, s, t }) });
  }
}

const config = { token: "synthetic-token", guildId: "123", channelIds: ["456"] };
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Discord voice Gateway collector (fake transport only)", () => {
  it("stays disabled without an explicit flag and validates its allowlist", () => {
    expect(voiceGatewayConfig({ DISCORD_BOT_TOKEN: "x" })).toBeNull();
    expect(() => voiceGatewayConfig({ VOICE_PRESENCE_ENABLED: "true", DISCORD_BOT_TOKEN: "x", VOICE_PRESENCE_GUILD_ID: "123" })).toThrow();
    expect(voiceGatewayConfig({ VOICE_PRESENCE_ENABLED: "true", DISCORD_BOT_TOKEN: "x", VOICE_PRESENCE_GUILD_ID: "123", VOICE_PRESENCE_CHANNEL_IDS: "456" })).toEqual({ token: "x", guildId: "123", channelIds: ["456"] });
  });

  it("identifies, handles a partial snapshot, moves/leaves, then shuts down", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const sockets: FakeSocket[] = [];
    const onInterval = vi.fn();
    const onGap = vi.fn();
    const onGapRecovered = vi.fn();
    const collector = createVoiceGatewayCollector(config, {
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      fetchGatewayUrl: async () => "wss://gateway.discord.gg",
      onInterval, onGap, onGapRecovered, onFatal: vi.fn(),
    });
    await collector.start();
    const socket = sockets[0];
    socket.emit(10, { heartbeat_interval: 45_000 });
    expect(socket.sent[0]).toMatchObject({ op: 2, d: { intents: 129 } });
    socket.emit(0, { session_id: "test-session", resume_gateway_url: "wss://resume.discord.gg" }, 1, "READY");
    socket.emit(0, { id: "123", voice_states: [{ user_id: "synthetic-member", channel_id: "456" }] }, 2, "GUILD_CREATE");
    vi.setSystemTime(4_000);
    socket.emit(0, { guild_id: "123", user_id: "synthetic-member", channel_id: null }, 3, "VOICE_STATE_UPDATE");
    expect(onInterval).toHaveBeenCalledWith({ memberKey: "synthetic-member", channelId: "456", startedAt: 1_000, endedAt: 4_000, partial: true });
    socket.emit(0, { guild_id: "999", user_id: "ignored", channel_id: "456" }, 4, "VOICE_STATE_UPDATE");
    collector.stop();
    expect(socket.closeCode).toBe(1000);
    expect(onGap).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(sockets).toHaveLength(1);
  });

  it("resumes replayed events, then marks an invalid session as a gap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const sockets: FakeSocket[] = [];
    const onInterval = vi.fn();
    const onGap = vi.fn();
    const onGapRecovered = vi.fn();
    const collector = createVoiceGatewayCollector(config, {
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      fetchGatewayUrl: async () => "wss://gateway.discord.gg",
      onInterval, onGap, onGapRecovered, onFatal: vi.fn(),
    });
    await collector.start();
    sockets[0].emit(10, { heartbeat_interval: 45_000 });
    sockets[0].emit(0, { session_id: "test-session", resume_gateway_url: "wss://resume.discord.gg" }, 1, "READY");
    sockets[0].emit(0, { id: "123", voice_states: [] }, 2, "GUILD_CREATE");
    sockets[0].emit(0, { guild_id: "123", user_id: "synthetic-member", channel_id: "456" }, 3, "VOICE_STATE_UPDATE");
    sockets[0].close(1006);
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);
    expect(onGap).toHaveBeenCalledWith("transport_closed");
    sockets[1].emit(10, { heartbeat_interval: 45_000 });
    expect(sockets[1].sent[0]).toEqual({ op: 6, d: { token: "synthetic-token", session_id: "test-session", seq: 3 } });
    sockets[1].emit(0, {}, 4, "RESUMED");
    expect(onGapRecovered).toHaveBeenCalledWith(2_000);
    vi.setSystemTime(4_000);
    sockets[1].emit(0, { guild_id: "123", user_id: "synthetic-member", channel_id: null }, 5, "VOICE_STATE_UPDATE");
    expect(onInterval).toHaveBeenCalledWith({ memberKey: "synthetic-member", channelId: "456", startedAt: 2_000, endedAt: 4_000, partial: true });
    sockets[1].emit(9, false);
    expect(onGap).toHaveBeenCalledWith("resume_failed");
    vi.advanceTimersByTime(1_000);
    sockets[2].emit(10, { heartbeat_interval: 45_000 });
    expect(sockets[2].sent[0].op).toBe(2);
    sockets[2].emit(0, { session_id: "test-session-2", resume_gateway_url: "wss://resume.discord.gg" }, 8, "READY");
    sockets[2].emit(0, { id: "123", voice_states: [] }, 9, "GUILD_CREATE");
    expect(onGapRecovered).toHaveBeenCalledWith(5_000);
    collector.stop();
  });

  it("does not count replay events or the Gateway disconnect gap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const sockets: FakeSocket[] = [];
    const onInterval = vi.fn();
    const onGap = vi.fn();
    const collector = createVoiceGatewayCollector(config, {
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      fetchGatewayUrl: async () => "wss://gateway.discord.gg",
      onInterval, onGap, onFatal: vi.fn(),
    });
    await collector.start();
    sockets[0].emit(0, { session_id: "test-session", resume_gateway_url: "wss://resume.discord.gg" }, 1, "READY");
    sockets[0].emit(0, { id: "123", voice_states: [] }, 2, "GUILD_CREATE");
    sockets[0].emit(0, { guild_id: "123", user_id: "stayed", channel_id: "456" }, 3, "VOICE_STATE_UPDATE");
    vi.setSystemTime(1_500);
    sockets[0].emit(0, { guild_id: "123", user_id: "left", channel_id: "456" }, 4, "VOICE_STATE_UPDATE");
    vi.setSystemTime(2_000);
    sockets[0].close(1006);

    await vi.advanceTimersByTimeAsync(1_000);
    sockets[1].emit(10, { heartbeat_interval: 45_000 });
    sockets[1].emit(0, { guild_id: "123", user_id: "stayed", channel_id: "456" }, 5, "VOICE_STATE_UPDATE");
    vi.setSystemTime(5_000);
    sockets[1].emit(0, { guild_id: "123", user_id: "left", channel_id: null }, 6, "VOICE_STATE_UPDATE");
    vi.setSystemTime(20_000);
    sockets[1].emit(0, {}, 7, "RESUMED");
    vi.setSystemTime(25_000);
    sockets[1].emit(0, { guild_id: "123", user_id: "stayed", channel_id: null }, 8, "VOICE_STATE_UPDATE");

    expect(onInterval).toHaveBeenCalledExactlyOnceWith({
      memberKey: "stayed", channelId: "456", startedAt: 20_000, endedAt: 25_000, partial: true,
    });
    expect(onGap).toHaveBeenCalledWith("transport_closed");
    collector.stop();
  });

  it("does not flush open visits through the disconnect gap on shutdown", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const sockets: FakeSocket[] = [];
    const onInterval = vi.fn();
    const onGap = vi.fn();
    const collector = createVoiceGatewayCollector(config, {
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      fetchGatewayUrl: async () => "wss://gateway.discord.gg",
      onInterval, onGap, onFatal: vi.fn(),
    });
    await collector.start();
    sockets[0].emit(0, { session_id: "test-session", resume_gateway_url: "wss://resume.discord.gg" }, 1, "READY");
    sockets[0].emit(0, { id: "123", voice_states: [] }, 2, "GUILD_CREATE");
    sockets[0].emit(0, { guild_id: "123", user_id: "member", channel_id: "456" }, 3, "VOICE_STATE_UPDATE");
    vi.setSystemTime(2_000);
    sockets[0].close(1006);
    vi.setSystemTime(5_000);

    collector.stop();

    expect(onInterval).not.toHaveBeenCalled();
    expect(onGap).toHaveBeenCalledWith("transport_closed");
    expect(onGap).toHaveBeenCalledWith("shutdown");
  });

  it("discards an invalid resumed session and starts a fresh snapshot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const sockets: FakeSocket[] = [];
    const onInterval = vi.fn();
    const collector = createVoiceGatewayCollector(config, {
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      fetchGatewayUrl: async () => "wss://gateway.discord.gg",
      onInterval, onGap: vi.fn(), onFatal: vi.fn(),
    });
    await collector.start();
    sockets[0].emit(10, { heartbeat_interval: 45_000 });
    sockets[0].emit(0, { session_id: "test-session", resume_gateway_url: "wss://resume.discord.gg" }, 1, "READY");
    sockets[0].emit(0, { id: "123", voice_states: [] }, 2, "GUILD_CREATE");
    sockets[0].emit(0, { guild_id: "123", user_id: "synthetic-member", channel_id: "456" }, 3, "VOICE_STATE_UPDATE");

    vi.setSystemTime(2_000);
    sockets[0].close(1006);
    await vi.advanceTimersByTimeAsync(1_000);
    sockets[1].emit(10, { heartbeat_interval: 45_000 });
    sockets[1].emit(9, false);
    expect(onInterval).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    sockets[2].emit(10, { heartbeat_interval: 45_000 });
    expect(sockets[2].sent[0].op).toBe(2);
    sockets[2].emit(0, { session_id: "fresh-session", resume_gateway_url: "wss://resume.discord.gg" }, 1, "READY");
    sockets[2].emit(0, { id: "123", voice_states: [{ user_id: "synthetic-member", channel_id: "456" }] }, 2, "GUILD_CREATE");
    vi.setSystemTime(6_000);
    sockets[2].emit(0, { guild_id: "123", user_id: "synthetic-member", channel_id: null }, 3, "VOICE_STATE_UPDATE");

    expect(onInterval).toHaveBeenCalledExactlyOnceWith({
      memberKey: "synthetic-member", channelId: "456", startedAt: 5_000, endedAt: 6_000, partial: true,
    });
    collector.stop();
  });

  it.each([4007, 4009])("flushes known visits as partial when the Gateway closes with %i", async closeCode => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const sockets: FakeSocket[] = [];
    const onInterval = vi.fn();
    const collector = createVoiceGatewayCollector(config, {
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      fetchGatewayUrl: async () => "wss://gateway.discord.gg",
      onInterval, onGap: vi.fn(), onFatal: vi.fn(),
    });
    await collector.start();
    sockets[0].emit(10, { heartbeat_interval: 45_000 });
    sockets[0].emit(0, { session_id: "test-session", resume_gateway_url: "wss://resume.discord.gg" }, 1, "READY");
    sockets[0].emit(0, { id: "123", voice_states: [] }, 2, "GUILD_CREATE");
    sockets[0].emit(0, { guild_id: "123", user_id: "synthetic-member", channel_id: "456" }, 3, "VOICE_STATE_UPDATE");
    vi.setSystemTime(2_500);

    sockets[0].close(closeCode);

    expect(onInterval).toHaveBeenCalledWith({
      memberKey: "synthetic-member", channelId: "456", startedAt: 1_000, endedAt: 2_500, partial: true,
    });
    collector.stop();
  });

  it("closes visits at a temporary guild outage and reconciles the recovery snapshot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const sockets: FakeSocket[] = [];
    const onInterval = vi.fn();
    const onGap = vi.fn();
    const onGapRecovered = vi.fn();
    const onFatal = vi.fn();
    const collector = createVoiceGatewayCollector(config, {
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      fetchGatewayUrl: async () => "wss://gateway.discord.gg",
      onInterval, onGap, onGapRecovered, onFatal,
    });
    await collector.start();
    sockets[0].emit(10, { heartbeat_interval: 45_000 });
    sockets[0].emit(0, { session_id: "test-session", resume_gateway_url: "wss://resume.discord.gg" }, 1, "READY");
    sockets[0].emit(0, { id: "123", voice_states: [
      { user_id: "left-during-outage", channel_id: "456" },
      { user_id: "stayed-in-voice", channel_id: "456" },
    ] }, 2, "GUILD_CREATE");

    vi.setSystemTime(3_000);
    sockets[0].emit(0, { id: "123", unavailable: true }, 3, "GUILD_DELETE");
    expect(onGap).toHaveBeenCalledWith("guild_unavailable");
    expect(onInterval).toHaveBeenCalledWith({
      memberKey: "left-during-outage", channelId: "456", startedAt: 1_000, endedAt: 3_000, partial: true,
    });
    sockets[0].emit(0, { id: "123", unavailable: true }, 4, "GUILD_CREATE");
    sockets[0].emit(0, { guild_id: "123", user_id: "left-during-outage", channel_id: null }, 5, "VOICE_STATE_UPDATE");

    vi.setSystemTime(5_000);
    sockets[0].emit(0, { id: "123", voice_states: [{ user_id: "stayed-in-voice", channel_id: "456" }] }, 6, "GUILD_CREATE");
    expect(onGapRecovered).toHaveBeenCalledWith(5_000);
    vi.setSystemTime(7_000);
    sockets[0].emit(0, { guild_id: "123", user_id: "left-during-outage", channel_id: null }, 7, "VOICE_STATE_UPDATE");
    sockets[0].emit(0, { guild_id: "123", user_id: "stayed-in-voice", channel_id: null }, 8, "VOICE_STATE_UPDATE");

    expect(onInterval).toHaveBeenCalledTimes(3);
    expect(onInterval.mock.calls.some(([visit]) => visit.startedAt < 5_000 && visit.endedAt > 3_000)).toBe(false);
    expect(onInterval).toHaveBeenNthCalledWith(3, {
      memberKey: "stayed-in-voice", channelId: "456", startedAt: 5_000, endedAt: 7_000, partial: true,
    });
    expect(onFatal).not.toHaveBeenCalled();
    collector.stop();
  });

  it("marks permanent guild removal as a gap without inventing recovery or duration", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const sockets: FakeSocket[] = [];
    const onInterval = vi.fn();
    const onGap = vi.fn();
    const onGapRecovered = vi.fn();
    const collector = createVoiceGatewayCollector(config, {
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      fetchGatewayUrl: async () => "wss://gateway.discord.gg",
      onInterval, onGap, onGapRecovered, onFatal: vi.fn(),
    });
    await collector.start();
    sockets[0].emit(10, { heartbeat_interval: 45_000 });
    sockets[0].emit(0, { session_id: "test-session", resume_gateway_url: "wss://resume.discord.gg" }, 1, "READY");
    sockets[0].emit(0, { id: "123", voice_states: [{ user_id: "departed-guild-member", channel_id: "456" }] }, 2, "GUILD_CREATE");
    onGapRecovered.mockClear();

    vi.setSystemTime(3_000);
    sockets[0].emit(0, { id: "123", unavailable: false }, 3, "GUILD_DELETE");
    expect(onGap).toHaveBeenCalledWith("guild_removed");
    expect(onGapRecovered).not.toHaveBeenCalled();
    expect(onInterval).toHaveBeenCalledExactlyOnceWith({
      memberKey: "departed-guild-member", channelId: "456", startedAt: 1_000, endedAt: 3_000, partial: true,
    });

    vi.setSystemTime(5_000);
    sockets[0].emit(0, { guild_id: "123", user_id: "departed-guild-member", channel_id: null }, 4, "VOICE_STATE_UPDATE");
    expect(onInterval).toHaveBeenCalledTimes(1);
    expect(onGapRecovered).not.toHaveBeenCalled();
    collector.stop();
  });

  it("flushes open visits as partial intervals on an orderly stop", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const sockets: FakeSocket[] = [];
    const onInterval = vi.fn();
    const collector = createVoiceGatewayCollector(config, {
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      fetchGatewayUrl: async () => "wss://gateway.discord.gg",
      onInterval, onGap: vi.fn(), onFatal: vi.fn(),
    });
    await collector.start();
    sockets[0].emit(10, { heartbeat_interval: 45_000 });
    sockets[0].emit(0, { session_id: "test-session", resume_gateway_url: "wss://resume.discord.gg" }, 1, "READY");
    sockets[0].emit(0, { id: "123", voice_states: [] }, 2, "GUILD_CREATE");
    sockets[0].emit(0, { guild_id: "123", user_id: "synthetic-member", channel_id: "456" }, 3, "VOICE_STATE_UPDATE");
    vi.setSystemTime(5_000);

    collector.stop();

    expect(onInterval).toHaveBeenCalledWith({
      memberKey: "synthetic-member",
      channelId: "456",
      startedAt: 1_000,
      endedAt: 5_000,
      partial: true,
    });
  });

  it("sends heartbeats, closes on a missing acknowledgement, and reconnects", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const sockets: FakeSocket[] = [];
    const collector = createVoiceGatewayCollector(config, {
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      fetchGatewayUrl: async () => "wss://gateway.discord.gg",
      onInterval: vi.fn(), onGap: vi.fn(), onFatal: vi.fn(),
    });
    await collector.start();
    sockets[0].emit(10, { heartbeat_interval: 1_000 });
    sockets[0].emit(1, null);
    expect(sockets[0].sent.some(packet => packet.op === 1)).toBe(true);
    sockets[0].emit(11, null);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets[0].sent.some(packet => packet.op === 1)).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets[0].closeCode).toBe(4000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(2);
    collector.stop();
  });

  it("stops and unregisters cleanly on SIGTERM", () => {
    const listeners = new Map<string, () => void>();
    const processLike = {
      once: (signal: string, listener: () => void) => { listeners.set(signal, listener); },
      removeListener: (signal: string) => { listeners.delete(signal); },
      exitCode: 0,
    } as unknown as Pick<NodeJS.Process, "once" | "removeListener" | "exitCode">;
    const collector = { stop: vi.fn() };
    const removeHandlers = installVoiceCollectorShutdownHandlers(collector, processLike);
    listeners.get("SIGTERM")?.();
    expect(collector.stop).toHaveBeenCalledOnce();
    removeHandlers();
    expect(listeners.size).toBe(0);
  });

  it("stops retrying after a fatal Gateway close code", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const sockets: FakeSocket[] = [];
    const onFatal = vi.fn();
    const onInterval = vi.fn();
    const collector = createVoiceGatewayCollector(config, {
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      fetchGatewayUrl: async () => "wss://gateway.discord.gg",
      onInterval, onGap: vi.fn(), onFatal,
    });
    await collector.start();
    sockets[0].emit(10, { heartbeat_interval: 45_000 });
    sockets[0].emit(0, { session_id: "test-session", resume_gateway_url: "wss://resume.discord.gg" }, 1, "READY");
    sockets[0].emit(0, { id: "123", voice_states: [] }, 2, "GUILD_CREATE");
    sockets[0].emit(0, { guild_id: "123", user_id: "synthetic-member", channel_id: "456" }, 3, "VOICE_STATE_UPDATE");
    vi.setSystemTime(2_500);
    sockets[0].close(4014);
    expect(onFatal).toHaveBeenCalledWith({ kind: "gateway_close", closeCode: 4014 });
    expect(onInterval).toHaveBeenCalledWith({
      memberKey: "synthetic-member", channelId: "456", startedAt: 1_000, endedAt: 2_500, partial: true,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets).toHaveLength(1);
  });

  it("retries Gateway discovery after a temporary HTTP failure", async () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValue(new Response(JSON.stringify({ url: "wss://gateway.discord.gg" }), { status: 200 }));
    const collector = createVoiceGatewayCollector(config, {
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      onInterval: vi.fn(), onGap: vi.fn(), onFatal: vi.fn(),
    });
    await collector.start();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(1);
    collector.stop();
  });

  it.each([401, 403])("does not retry Gateway discovery after HTTP %i", async status => {
    vi.useFakeTimers();
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status }));
    const onFatal = vi.fn();
    const createSocket = vi.fn(() => new FakeSocket());
    const collector = createVoiceGatewayCollector(config, {
      createSocket,
      onInterval: vi.fn(), onGap: vi.fn(), onFatal,
    });

    await collector.start();
    expect(onFatal).toHaveBeenCalledWith({ kind: "gateway_discovery", status });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledOnce();
    expect(createSocket).not.toHaveBeenCalled();
    collector.stop();
  });
});
