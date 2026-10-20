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
    const collector = createVoiceGatewayCollector(config, {
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      fetchGatewayUrl: async () => "wss://gateway.discord.gg",
      onInterval, onGap, onFatal: vi.fn(),
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
    const collector = createVoiceGatewayCollector(config, {
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      fetchGatewayUrl: async () => "wss://gateway.discord.gg",
      onInterval, onGap, onFatal: vi.fn(),
    });
    await collector.start();
    sockets[0].emit(10, { heartbeat_interval: 45_000 });
    sockets[0].emit(0, { session_id: "test-session", resume_gateway_url: "wss://resume.discord.gg" }, 1, "READY");
    sockets[0].emit(0, { guild_id: "123", user_id: "synthetic-member", channel_id: "456" }, 2, "VOICE_STATE_UPDATE");
    sockets[0].close(1006);
    vi.advanceTimersByTime(1_000);
    expect(sockets).toHaveLength(2);
    sockets[1].emit(10, { heartbeat_interval: 45_000 });
    expect(sockets[1].sent[0]).toEqual({ op: 6, d: { token: "synthetic-token", session_id: "test-session", seq: 2 } });
    sockets[1].emit(0, {}, 3, "RESUMED");
    vi.setSystemTime(4_000);
    sockets[1].emit(0, { guild_id: "123", user_id: "synthetic-member", channel_id: null }, 4, "VOICE_STATE_UPDATE");
    expect(onInterval).toHaveBeenCalledWith({ memberKey: "synthetic-member", channelId: "456", startedAt: 1_000, endedAt: 4_000 });
    sockets[1].emit(9, false);
    expect(onGap).toHaveBeenCalledWith("resume_failed");
    vi.advanceTimersByTime(1_000);
    sockets[2].emit(10, { heartbeat_interval: 45_000 });
    expect(sockets[2].sent[0].op).toBe(2);
    collector.stop();
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
});
