import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";

/**
 * FAUX Gateway Discord pour les tests : serveur WebSocket (RFC 6455, texte
 * seulement) lié à 127.0.0.1, sans aucune connexion à Discord ni jeton réel.
 */
export type FakeGatewayReceived = { connection: number; op: number; d: unknown };
type VoiceState = { user_id: string; channel_id: string };
type Conn = { id: number; socket: Duplex; buffer: Buffer };

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function frame(opcode: number, payload: Buffer) {
  const length = payload.length;
  const header = length < 126
    ? Buffer.from([0x80 | opcode, length])
    : length < 65_536
      ? Buffer.from([0x80 | opcode, 126, length >> 8, length & 255])
      : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | opcode; h[1] = 127; h.writeBigUInt64BE(BigInt(length), 2); return h; })();
  return Buffer.concat([header, payload]);
}

export async function startFakeDiscordGateway(options: {
  guildId: string;
  /** Intervalle HELLO ; grand par défaut pour ne pas bruiter les tests. */
  heartbeatIntervalMs?: number;
}) {
  const received: FakeGatewayReceived[] = [];
  const connections = new Map<number, Conn>();
  const closedWith: Array<{ connection: number; code: number | null }> = [];
  let nextId = 0;
  let seq = 0;
  let sessionId = "fake-session-0";
  let snapshot: VoiceState[] = [];
  let resumeMode: "resume" | "invalid" = "resume";
  const heartbeatInterval = options.heartbeatIntervalMs ?? 45_000;

  const server: Server = createServer((_req, res) => { res.writeHead(426).end(); });

  const sendJson = (conn: Conn, packet: Record<string, unknown>) => {
    if (!conn.socket.destroyed) conn.socket.write(frame(1, Buffer.from(JSON.stringify(packet))));
  };
  const dispatch = (conn: Conn, t: string, d: unknown) => sendJson(conn, { op: 0, t, s: ++seq, d });
  const latest = () => [...connections.values()].at(-1);

  function onPacket(conn: Conn, packet: { op: number; d: unknown }) {
    received.push({ connection: conn.id, op: packet.op, d: packet.d });
    if (packet.op === 1) { sendJson(conn, { op: 11 }); return; }
    if (packet.op === 2) {
      sessionId = `fake-session-${conn.id}`;
      seq = 0;
      dispatch(conn, "READY", { session_id: sessionId, resume_gateway_url: "wss://resume.discord.gg" });
      dispatch(conn, "GUILD_CREATE", { id: options.guildId, voice_states: snapshot });
    } else if (packet.op === 6) {
      const resume = packet.d as { session_id?: string; seq?: number };
      if (resumeMode === "invalid" || resume.session_id !== sessionId) sendJson(conn, { op: 9, d: false });
      else dispatch(conn, "RESUMED", {});
    }
  }

  function onData(conn: Conn, chunk: Buffer) {
    conn.buffer = Buffer.concat([conn.buffer, chunk]);
    while (conn.buffer.length >= 2) {
      const b = conn.buffer;
      const opcode = b[0] & 0x0f;
      let length = b[1] & 0x7f;
      let offset = 2;
      if (length === 126) { if (b.length < 4) return; length = b.readUInt16BE(2); offset = 4; }
      else if (length === 127) { if (b.length < 10) return; length = Number(b.readBigUInt64BE(2)); offset = 10; }
      const masked = (b[1] & 0x80) !== 0;
      const total = offset + (masked ? 4 : 0) + length;
      if (b.length < total) return;
      const payload = Buffer.from(b.subarray(offset + (masked ? 4 : 0), total));
      if (masked) { const key = b.subarray(offset, offset + 4); for (let i = 0; i < payload.length; i++) payload[i] ^= key[i % 4]; }
      conn.buffer = b.subarray(total);
      if (opcode === 8) {
        closedWith.push({ connection: conn.id, code: payload.length >= 2 ? payload.readUInt16BE(0) : null });
        conn.socket.write(frame(8, payload.subarray(0, 2)));
        conn.socket.end();
        return;
      }
      if (opcode === 1) {
        try { onPacket(conn, JSON.parse(payload.toString("utf8"))); } catch { /* ignore */ }
      }
    }
  }

  server.on("upgrade", (req: IncomingMessage, socket: Duplex) => {
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string") { socket.destroy(); return; }
    const accept = createHash("sha1").update(key + GUID).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const conn: Conn = { id: ++nextId, socket, buffer: Buffer.alloc(0) };
    connections.set(conn.id, conn);
    socket.on("data", chunk => onData(conn, chunk as Buffer));
    socket.on("close", () => connections.delete(conn.id));
    socket.on("error", () => undefined);
    sendJson(conn, { op: 10, d: { heartbeat_interval: heartbeatInterval } });
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fake gateway failed to listen");

  return {
    url: `ws://127.0.0.1:${address.port}/`,
    received,
    closedWith,
    /** Nombre total de connexions acceptées depuis le démarrage. */
    get accepted() { return nextId; },
    get open() { return connections.size; },
    setSnapshot(states: VoiceState[]) { snapshot = states; },
    setResumeMode(mode: "resume" | "invalid") { resumeMode = mode; },
    voiceState(userId: string, channelId: string | null, guildId = options.guildId) {
      const conn = latest();
      if (!conn) throw new Error("No open fake gateway connection");
      dispatch(conn, "VOICE_STATE_UPDATE", { guild_id: guildId, user_id: userId, channel_id: channelId });
    },
    /** Coupure réseau brutale : aucun frame Close, la socket est détruite. */
    dropConnections() { for (const conn of connections.values()) conn.socket.destroy(); },
    /** Fermeture Discord avec un code (ex. 4004 jeton invalide). */
    closeWithCode(code: number) {
      for (const conn of connections.values()) {
        const payload = Buffer.alloc(2); payload.writeUInt16BE(code);
        conn.socket.write(frame(8, payload));
      }
    },
    async close() {
      for (const conn of connections.values()) conn.socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
