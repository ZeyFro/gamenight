import { applyVoiceState, type VoiceInterval, type VoiceVisit } from "./discord-voice-presence";

type Packet = { op: number; d?: unknown; s?: number | null; t?: string | null };
type SocketEvent = { data?: unknown; code?: number };
type Socket = {
  addEventListener(type: "message" | "close" | "error", listener: (event: SocketEvent) => void): void;
  send(data: string): void;
  close(code?: number): void;
};
type FatalFailure = { kind: "gateway_discovery"; status: number } | { kind: "gateway_close"; closeCode: number };

class FatalGatewayDiscoveryError extends Error {
  constructor(readonly status: number) {
    super(`Discord Gateway lookup failed (${status})`);
  }
}

export type VoiceGatewayConfig = {
  token: string;
  guildId: string;
  channelIds: readonly string[];
};

export function voiceGatewayConfig(env: Record<string, string | undefined>): VoiceGatewayConfig | null {
  if (env.VOICE_PRESENCE_ENABLED !== "true") return null;
  const token = env.DISCORD_BOT_TOKEN?.trim();
  const guildId = env.VOICE_PRESENCE_GUILD_ID?.trim();
  const channelIds = env.VOICE_PRESENCE_CHANNEL_IDS?.split(",").map(id => id.trim()).filter(Boolean) ?? [];
  if (!token || !guildId || !channelIds.length || !/^\d+$/.test(guildId) || channelIds.some(id => !/^\d+$/.test(id))) {
    throw new Error("Voice Gateway configuration incomplete");
  }
  return { token, guildId, channelIds };
}

function gatewayUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "wss:" || (url.hostname !== "gateway.discord.gg" && !url.hostname.endsWith(".discord.gg"))) {
    throw new Error("Invalid Discord Gateway URL");
  }
  url.searchParams.set("v", "10");
  url.searchParams.set("encoding", "json");
  return url.href;
}

export function createVoiceGatewayCollector(config: VoiceGatewayConfig, options: {
  createSocket?: (url: string) => Socket;
  fetchGatewayUrl?: (token: string) => Promise<string>;
  onInterval: (interval: VoiceInterval) => void;
  onGap: (reason: "resume_failed" | "transport_closed" | "shutdown" | "fatal_close") => void;
  onFatal: (failure: FatalFailure) => void;
  now?: () => number;
}) {
  const channels = new Set(config.channelIds);
  const now = options.now ?? Date.now;
  let socket: Socket | null = null;
  let heartbeat: ReturnType<typeof setTimeout> | null = null;
  let reconnect: ReturnType<typeof setTimeout> | null = null;
  let awaitingAck = false;
  let heartbeatInterval = 0;
  let sequence: number | null = null;
  let session: { id: string; url: string } | null = null;
  let initialUrl = "";
  let active = new Map<string, VoiceVisit>();
  let guildState: "snapshot_pending" | "available" | "unavailable" | "removed" = "snapshot_pending";
  let replaying = false;
  let stopped = true;
  let retryMs = 1_000;
  let startGeneration = 0;
  const createSocket = options.createSocket ?? (url => new WebSocket(url) as unknown as Socket);

  function clearHeartbeat() {
    if (heartbeat) clearTimeout(heartbeat);
    heartbeat = null;
    awaitingAck = false;
  }

  function send(op: number, d: unknown) { socket?.send(JSON.stringify({ op, d })); }

  function closeActiveVisits(endedAt = now()) {
    const visits = [...active.entries()];
    active.clear();
    if (replaying) return;
    for (const [memberKey, visit] of visits) {
      if (endedAt > visit.startedAt) {
        options.onInterval({ memberKey, channelId: visit.channelId, startedAt: visit.startedAt, endedAt, partial: true });
      }
    }
  }

  function beat(interval: number) {
    if (stopped || !socket) return;
    if (awaitingAck) { socket.close(4000); return; }
    send(1, sequence);
    awaitingAck = true;
    heartbeat = setTimeout(() => beat(interval), interval);
  }

  function connect(url: string) {
    if (stopped) return;
    const next = createSocket(gatewayUrl(url));
    socket = next;
    next.addEventListener("message", event => {
      if (stopped || socket !== next) return;
      let packet: Packet;
      try { packet = JSON.parse(String(event.data)); } catch { return; }
      if (!packet || typeof packet.op !== "number") return;
      if (packet.op === 10) {
        const interval = (packet.d as { heartbeat_interval?: number })?.heartbeat_interval;
        if (!Number.isFinite(interval) || !interval || interval < 1_000) { next.close(4000); return; }
        heartbeatInterval = interval;
        clearHeartbeat();
        heartbeat = setTimeout(() => beat(interval), Math.floor(interval * Math.random()));
        if (session && sequence !== null) send(6, { token: config.token, session_id: session.id, seq: sequence });
        else send(2, { token: config.token, intents: 1 | 128, properties: { os: "linux", browser: "gamenight", device: "gamenight" } });
        return;
      }
      if (packet.op === 11) { awaitingAck = false; return; }
      if (packet.op === 1) {
        clearHeartbeat();
        send(1, sequence);
        awaitingAck = true;
        heartbeat = setTimeout(() => beat(heartbeatInterval), heartbeatInterval);
        return;
      }
      if (packet.op === 7 || packet.op === 9) {
        if (packet.op === 9 && packet.d !== true) {
          options.onGap("resume_failed");
          closeActiveVisits();
          replaying = false;
          guildState = "snapshot_pending";
          session = null; sequence = null;
        }
        next.close(4000);
        return;
      }
      if (packet.op !== 0 || typeof packet.s !== "number" || packet.s <= (sequence ?? -1)) return;
      sequence = packet.s;
      const data = packet.d as Record<string, unknown> | null;
      if (!data) return;
      if (packet.t === "READY" && typeof data.session_id === "string" && typeof data.resume_gateway_url === "string") {
        session = { id: data.session_id, url: gatewayUrl(data.resume_gateway_url) };
        replaying = false;
        guildState = "snapshot_pending";
        retryMs = 1_000;
      } else if (packet.t === "RESUMED") {
        const resumedAt = now();
        for (const [memberKey, visit] of active) {
          active.set(memberKey, { channelId: visit.channelId, startedAt: resumedAt, partial: true });
        }
        replaying = false;
        retryMs = 1_000;
      } else if (packet.t === "GUILD_DELETE" && data.id === config.guildId) {
        closeActiveVisits();
        guildState = data.unavailable === true ? "unavailable" : "removed";
      } else if (packet.t === "GUILD_CREATE" && data.id === config.guildId) {
        if (data.unavailable === true) {
          closeActiveVisits();
          guildState = "unavailable";
          return;
        }
        if (!Array.isArray(data.voice_states)) return;
        // A Guild Create snapshot has no join times, so it starts partial visits.
        const snapshotAt = now();
        closeActiveVisits(snapshotAt);
        for (const state of data.voice_states) {
          if (typeof state.user_id === "string" && typeof state.channel_id === "string" && channels.has(state.channel_id)) {
            active.set(state.user_id, { channelId: state.channel_id, startedAt: snapshotAt, partial: true });
          }
        }
        guildState = "available";
      } else if (packet.t === "VOICE_STATE_UPDATE" && guildState === "available" && data.guild_id === config.guildId && typeof data.user_id === "string") {
        if (data.channel_id !== null && typeof data.channel_id !== "string") return;
        const result = applyVoiceState(active, {
          memberKey: data.user_id,
          channelId: typeof data.channel_id === "string" && channels.has(data.channel_id) ? data.channel_id : null,
          at: now(),
        });
        active = result.active;
        if (result.closed && !replaying) options.onInterval(result.closed);
      }
    });
    next.addEventListener("error", () => { if (!stopped && socket === next) next.close(4000); });
    next.addEventListener("close", (event: { code?: number }) => {
      if (socket !== next) return;
      socket = null;
      clearHeartbeat();
      if (stopped) return;
      if ([4004, 4010, 4011, 4012, 4013, 4014].includes(event.code ?? 0)) {
        stopped = true;
        if (active.size) options.onGap("fatal_close");
        closeActiveVisits();
        options.onFatal({ kind: "gateway_close", closeCode: event.code ?? 0 });
        return;
      }
      if ([4007, 4009].includes(event.code ?? 0)) {
        options.onGap("resume_failed");
        closeActiveVisits();
        replaying = false;
        guildState = "snapshot_pending";
        session = null; sequence = null;
      }
      if (session && !replaying) {
        replaying = true;
        options.onGap("transport_closed");
      }
      reconnect = setTimeout(() => connect(session?.url ?? initialUrl), retryMs);
      retryMs = Math.min(retryMs * 2, 30_000);
    });
  }

  async function discoverGateway(generation: number, fetchUrl: (token: string) => Promise<string>) {
    try {
      const url = gatewayUrl(await fetchUrl(config.token));
      if (stopped || generation !== startGeneration) return;
      initialUrl = url;
      retryMs = 1_000;
      connect(initialUrl);
    } catch (error) {
      // Invalid credentials cannot recover by retrying the same token.
      if (error instanceof FatalGatewayDiscoveryError) {
        if (stopped || generation !== startGeneration) return;
        stopped = true;
        options.onFatal({ kind: "gateway_discovery", status: error.status });
        return;
      }
      if (stopped || generation !== startGeneration) return;
      reconnect = setTimeout(() => { void discoverGateway(generation, fetchUrl); }, retryMs);
      retryMs = Math.min(retryMs * 2, 30_000);
    }
  }

  return {
    async start() {
      if (!stopped) return;
      stopped = false;
      const generation = ++startGeneration;
      try {
        const fetchUrl = options.fetchGatewayUrl ?? (async token => {
          const response = await fetch("https://discord.com/api/v10/gateway/bot", { headers: { Authorization: `Bot ${token}` } });
          if ([401, 403].includes(response.status)) throw new FatalGatewayDiscoveryError(response.status);
          if (!response.ok) throw new Error(`Discord Gateway lookup failed (${response.status})`);
          return (await response.json() as { url: string }).url;
        });
        await discoverGateway(generation, fetchUrl);
      } catch (error) {
        if (generation === startGeneration) stopped = true;
        throw error;
      }
    },
    stop() {
      if (stopped) return;
      stopped = true;
      startGeneration++;
      if (heartbeat) clearTimeout(heartbeat);
      if (reconnect) clearTimeout(reconnect);
      const hasOpenVisits = active.size > 0;
      closeActiveVisits();
      if (hasOpenVisits) options.onGap("shutdown");
      socket?.close(1000);
      socket = null;
      session = null;
      sequence = null;
      guildState = "snapshot_pending";
      replaying = false;
    },
  };
}

export function installVoiceCollectorShutdownHandlers(collector: Pick<ReturnType<typeof createVoiceGatewayCollector>, "stop">, processLike: Pick<NodeJS.Process, "once" | "removeListener" | "exitCode"> = process) {
  const shutdown = () => { collector.stop(); };
  processLike.once("SIGINT", shutdown);
  processLike.once("SIGTERM", shutdown);
  return () => {
    processLike.removeListener("SIGINT", shutdown);
    processLike.removeListener("SIGTERM", shutdown);
  };
}
