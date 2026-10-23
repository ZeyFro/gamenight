import net from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const holder = vi.hoisted(() => ({ prisma: null as unknown }));

vi.mock("@/lib/prisma", () => ({ get prisma() { return holder.prisma; } }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: vi.fn() }));

// Un proxy TCP local entre le worker réel et Postgres : on peut couper les connexions en cours et refuser les nouvelles.
function createProxy(targetHost: string, targetPort: number) {
  const sockets = new Set<net.Socket>();
  let server: net.Server | null = null;
  let port = 0;
  const open = () => new Promise<void>(resolve => {
    server = net.createServer(client => {
      const upstream = net.connect(targetPort, targetHost);
      for (const s of [client, upstream]) { sockets.add(s); s.on("close", () => sockets.delete(s)); s.on("error", () => s.destroy()); }
      client.pipe(upstream); upstream.pipe(client);
    });
    server.listen(port, "127.0.0.1", () => { port = (server!.address() as net.AddressInfo).port; resolve(); });
  });
  const cut = () => new Promise<void>(resolve => {
    for (const s of sockets) s.destroy();
    server?.close(() => resolve());
    server = null;
  });
  return { open, cut, get port() { return port; } };
}

describe.skipIf(!TEST_DATABASE_URL)("worker vocal réel : base coupée en cours de route", () => {
  const target = new URL(TEST_DATABASE_URL ?? "postgresql://x@127.0.0.1:1/x");
  const proxy = createProxy(target.hostname, Number(target.port || 5432));
  let db: import("@prisma/client").PrismaClient;

  beforeAll(async () => {
    await proxy.open();
    const url = new URL(target); url.hostname = "127.0.0.1"; url.port = String(proxy.port);
    url.searchParams.set("connection_limit", "2"); url.searchParams.set("connect_timeout", "2");
    const { PrismaClient } = await import("@prisma/client");
    db = new PrismaClient({ datasourceUrl: url.toString() });
    holder.prisma = db;
  });
  afterAll(async () => { await proxy.cut(); await db?.$disconnect(); });

  it("signale la panne avec backoff, ne plante pas, se reconnecte et ne journalise aucun secret", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { startVoicePresenceWorkerRuntime } = await import("./voice-presence-worker-runtime");
    const onFatal = vi.fn();
    const runtime = await startVoicePresenceWorkerRuntime(
      { token: "synthetic-token-xyz", pollIntervalMs: 5_000 },
      { processLike: { once: vi.fn(), removeListener: vi.fn() }, onFatal },
    );
    await proxy.cut();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringMatching(/database unavailable \(attempt 1\/8\); next attempt in 5s/)), { timeout: 20_000, interval: 250 });
    await proxy.open();
    await vi.waitFor(() => expect(info).toHaveBeenCalledWith(expect.stringMatching(/database available again after \d+ failed attempt/)), { timeout: 60_000, interval: 250 });
    expect(onFatal).not.toHaveBeenCalled();
    const logged = JSON.stringify([...warn.mock.calls, ...info.mock.calls, ...error.mock.calls]);
    for (const secret of [target.password, "postgresql://", "synthetic-token-xyz"]) expect(logged).not.toContain(secret);
    await runtime.stop();
  }, 120_000);

  it("démarrage sur une adresse locale injoignable : échec immédiat et borné, sans boucle ni secret", async () => {
    const { PrismaClient } = await import("@prisma/client");
    const dead = new PrismaClient({ datasourceUrl: "postgresql://gn:hunter2@127.0.0.1:1/gamenight?connect_timeout=2" });
    holder.prisma = dead;
    vi.resetModules();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { startVoicePresenceWorkerRuntime } = await import("./voice-presence-worker-runtime");
    const onFatal = vi.fn();
    const startedAt = Date.now();
    await expect(startVoicePresenceWorkerRuntime(
      { token: "synthetic-token-xyz", pollIntervalMs: 5_000 },
      { processLike: { once: vi.fn(), removeListener: vi.fn() }, onFatal },
    )).rejects.toThrow("Voice presence worker failed to start");
    expect(Date.now() - startedAt).toBeLessThan(15_000);
    expect(onFatal).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: "discovery" }));
    const logged = JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
    expect(logged).not.toContain("hunter2");
    await dead.$disconnect();
    holder.prisma = db;
  }, 60_000);
});
