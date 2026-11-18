import { afterEach, describe, expect, it, vi } from "vitest";

const persist = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock("./session-voice-presence", async () => {
  return { storeSessionVoiceInterval: persist };
});

import { createSessionVoiceCollector } from "./session-voice-collector";

class FakeSocket {
  listeners = new Map<string, (event: { data?: unknown; code?: number }) => void>();
  addEventListener(type: string, listener: (event: { data?: unknown; code?: number }) => void) { this.listeners.set(type, listener); }
  send() {}
  close(code?: number) { this.listeners.get("close")?.({ code }); }
  emit(op: number, d: unknown, s: number, t: string) { this.listeners.get("message")?.({ data: JSON.stringify({ op, d, s, t }) }); }
}

afterEach(() => vi.restoreAllMocks());

describe("session voice collector bridge (fake Gateway only)", () => {
  it("connects each closed Gateway interval to the explicitly configured GameNight session", async () => {
    const env = {
      VOICE_PRESENCE_ENABLED: "true",
      DISCORD_BOT_TOKEN: "synthetic-token",
      VOICE_PRESENCE_GUILD_ID: "123456789012345678",
      VOICE_PRESENCE_CHANNEL_IDS: "456789012345678901",
      VOICE_PRESENCE_SESSION_ID: "session-test",
      VOICE_PRESENCE_WORKER_ID: "synthetic-worker",
      VOICE_PRESENCE_WORKER_GENERATION: "1",
    };
    const sockets: FakeSocket[] = [];
    let now = 1_000;
    const collector = createSessionVoiceCollector(env, {
      createSocket: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      fetchGatewayUrl: async () => "wss://gateway.discord.gg",
      onGap: vi.fn(), onFatal: vi.fn(), onPersistenceError: vi.fn(), now: () => now,
    });
    expect(collector).not.toBeNull();
    await collector!.start();
    sockets[0].emit(10, { heartbeat_interval: 45_000 }, 0, "");
    sockets[0].emit(0, { session_id: "gateway-session", resume_gateway_url: "wss://resume.discord.gg" }, 1, "READY");
    sockets[0].emit(0, { id: "123456789012345678", voice_states: [] }, 2, "GUILD_CREATE");
    sockets[0].emit(0, { guild_id: "123456789012345678", user_id: "789012345678901234", channel_id: "456789012345678901" }, 3, "VOICE_STATE_UPDATE");
    now = 61_000;
    sockets[0].emit(0, { guild_id: "123456789012345678", user_id: "789012345678901234", channel_id: null }, 4, "VOICE_STATE_UPDATE");
    expect(persist).toHaveBeenCalledWith(
      {
        guildId: "123456789012345678",
        defaultGuildId: "",
        channelIds: ["456789012345678901"],
        sessionId: "session-test",
        workerId: "synthetic-worker",
        generation: 1,
      },
      { memberKey: "789012345678901234", channelId: "456789012345678901", startedAt: 1_000, endedAt: 61_000 },
    );
    await collector!.stop();
  });

  it("requires a session association before enabling collection", () => {
    expect(() => createSessionVoiceCollector({
      VOICE_PRESENCE_ENABLED: "true",
      DISCORD_BOT_TOKEN: "synthetic-token",
      VOICE_PRESENCE_GUILD_ID: "123456789012345678",
      VOICE_PRESENCE_CHANNEL_IDS: "456789012345678901",
    }, { onGap: vi.fn(), onFatal: vi.fn(), onPersistenceError: vi.fn() })).toThrow("Voice presence session configuration incomplete");
  });

  it("waits for pending storage before stopping and reports failures", async () => {
    let rejectWrite!: (error: Error) => void;
    persist.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectWrite = reject; }));
    const onPersistenceError = vi.fn();
    const env = {
      VOICE_PRESENCE_ENABLED: "true", DISCORD_BOT_TOKEN: "synthetic-token",
      VOICE_PRESENCE_GUILD_ID: "123456789012345678", VOICE_PRESENCE_CHANNEL_IDS: "456789012345678901",
      VOICE_PRESENCE_SESSION_ID: "session-test",
      VOICE_PRESENCE_WORKER_ID: "synthetic-worker", VOICE_PRESENCE_WORKER_GENERATION: "1",
    };
    const socket = new FakeSocket();
    const collector = createSessionVoiceCollector(env, {
      createSocket: () => socket, fetchGatewayUrl: async () => "wss://gateway.discord.gg",
      onGap: vi.fn(), onFatal: vi.fn(), onPersistenceError,
    })!;
    await collector.start();
    socket.emit(10, { heartbeat_interval: 45_000 }, 0, "");
    socket.emit(0, { session_id: "gateway-session", resume_gateway_url: "wss://resume.discord.gg" }, 1, "READY");
    socket.emit(0, { id: "123456789012345678", voice_states: [] }, 2, "GUILD_CREATE");
    socket.emit(0, { guild_id: "123456789012345678", user_id: "789012345678901234", channel_id: "456789012345678901" }, 3, "VOICE_STATE_UPDATE");
    socket.emit(0, { guild_id: "123456789012345678", user_id: "789012345678901234", channel_id: null }, 4, "VOICE_STATE_UPDATE");
    let stopped = false;
    const stopping = collector.stop().then(() => { stopped = true; });
    await Promise.resolve();
    expect(stopped).toBe(false);
    rejectWrite(new Error("local synthetic storage failure"));
    await stopping;
    expect(onPersistenceError).toHaveBeenCalledOnce();
  });
});
