import { createECDH } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Postgres local 127.0.0.1 uniquement. Session et service push simulés : aucun envoi réel.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_DATABASE_URL ? describe : describe.skip;
if (!TEST_DATABASE_URL) console.warn("[push-subscription] TEST_DATABASE_URL absente : intégration push ignorée.");

const { session, sendNotification } = vi.hoisted(() => ({ session: vi.fn(), sendNotification: vi.fn() }));
vi.mock("@/lib/valid-session", () => ({ getValidSession: session }));
vi.mock("web-push", () => ({ default: { sendNotification } }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (TEST_DATABASE_URL && new URL(TEST_DATABASE_URL).hostname !== "127.0.0.1") throw new Error("Postgres local 127.0.0.1 uniquement");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const keys = { p256dh: "B".repeat(87), auth: "A".repeat(22) };
const endpoint = (id: string) => `https://fcm.googleapis.com/fcm/send/${id}`;
const request = (method: string, body: unknown) =>
  new Request("https://gamenight.test/api/push/subscription", { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

suite("abonnements Web Push (Postgres)", () => {
  let db: typeof import("@/lib/prisma").prisma;
  let route: typeof import("./route");
  let delivery: typeof import("@/lib/web-push-delivery");

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as typeof db;
    route = await import("./route");
    delivery = await import("@/lib/web-push-delivery");
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("WEB_PUSH_ENABLED", "true");
    vi.stubEnv("WEB_PUSH_VAPID_SUBJECT", "mailto:test@example.test");
    vi.stubEnv("WEB_PUSH_VAPID_PUBLIC_KEY", ecdh.getPublicKey().toString("base64url"));
    vi.stubEnv("WEB_PUSH_VAPID_PRIVATE_KEY", ecdh.getPrivateKey().toString("base64url"));
    await db.$executeRawUnsafe('TRUNCATE "User" CASCADE');
    await db.user.createMany({ data: [
      { id: "alice", discordId: "1", discordName: "Alice" },
      { id: "bob", discordId: "2", discordName: "Bob" },
    ] });
    session.mockResolvedValue({ user: { discordId: "1" } });
  });
  afterAll(async () => { vi.unstubAllEnvs(); await db.$disconnect(); });

  it("crée (201), met à jour sans doublon (200), puis supprime", async () => {
    expect((await route.POST(request("POST", { endpoint: endpoint("a"), keys }))).status).toBe(201);
    expect((await route.POST(request("POST", { endpoint: endpoint("a"), keys: { ...keys, auth: "C".repeat(22) } }))).status).toBe(200);
    const rows = await db.webPushSubscription.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: "alice", auth: "C".repeat(22) });
    expect((await route.DELETE(request("DELETE", { endpoint: endpoint("a") }))).status).toBe(200);
    expect(await db.webPushSubscription.count()).toBe(0);
  });

  it("refuse sans session, avec une destination ou des clés invalides", async () => {
    session.mockResolvedValue(null);
    expect((await route.POST(request("POST", { endpoint: endpoint("a"), keys }))).status).toBe(401);
    expect((await route.DELETE(request("DELETE", { endpoint: endpoint("a") }))).status).toBe(401);
    session.mockResolvedValue({ user: { discordId: "1" } });
    expect((await route.POST(request("POST", { endpoint: "https://evil.test/x", keys }))).status).toBe(400);
    expect((await route.POST(request("POST", { endpoint: endpoint("a"), keys: { p256dh: "x", auth: "y" } }))).status).toBe(400);
    expect(await db.webPushSubscription.count()).toBe(0);
  });

  it("refuse l'endpoint d'un autre utilisateur (409) et ne laisse pas un autre le supprimer", async () => {
    await route.POST(request("POST", { endpoint: endpoint("a"), keys }));
    session.mockResolvedValue({ user: { discordId: "2" } });
    expect((await route.POST(request("POST", { endpoint: endpoint("a"), keys: { ...keys, auth: "D".repeat(22) } }))).status).toBe(409);
    await route.DELETE(request("DELETE", { endpoint: endpoint("a") }));
    const row = await db.webPushSubscription.findUniqueOrThrow({ where: { endpoint: endpoint("a") } });
    expect(row).toMatchObject({ userId: "alice", auth: keys.auth });
  });

  it("limite à 5 appareils par utilisateur sans bloquer un autre compte", async () => {
    for (const id of ["1", "2", "3", "4", "5"]) expect((await route.POST(request("POST", { endpoint: endpoint(id), keys }))).status).toBe(201);
    expect((await route.POST(request("POST", { endpoint: endpoint("6"), keys }))).status).toBe(409);
    session.mockResolvedValue({ user: { discordId: "2" } });
    expect((await route.POST(request("POST", { endpoint: endpoint("6"), keys }))).status).toBe(201);
  });

  it("config absente ou invalide : 503 explicite, rien d'écrit, aucune clé dans la réponse", async () => {
    vi.stubEnv("WEB_PUSH_VAPID_PRIVATE_KEY", "private-secret-value");
    const response = await route.POST(request("POST", { endpoint: endpoint("a"), keys }));
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: "not_configured", reason: "invalid" });
    expect(text).not.toContain("private-secret-value");
    vi.stubEnv("WEB_PUSH_ENABLED", "false");
    expect(await (await route.POST(request("POST", { endpoint: endpoint("a"), keys }))).json()).toEqual({ error: "not_configured", reason: "disabled" });
    expect(await db.webPushSubscription.count()).toBe(0);
  });

  it("l'envoi ne touche que l'utilisateur visé : 410 supprime seulement cet appareil, 429/500 conservent", async () => {
    await db.webPushSubscription.createMany({ data: [
      { userId: "alice", endpoint: endpoint("a1"), ...{ p256dh: keys.p256dh, auth: keys.auth } },
      { userId: "alice", endpoint: endpoint("a2"), ...{ p256dh: keys.p256dh, auth: keys.auth } },
      { userId: "bob", endpoint: endpoint("b1"), ...{ p256dh: keys.p256dh, auth: keys.auth } },
    ] });
    sendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint === endpoint("a1")) throw { statusCode: 410 };
      if (sub.endpoint === endpoint("a2")) throw { statusCode: 429 };
    });
    await delivery.sendUserWebPush("alice", { title: "T", body: "B", url: "/" });
    expect(sendNotification.mock.calls.map(([sub]) => sub.endpoint).sort()).toEqual([endpoint("a1"), endpoint("a2")]);
    const left = (await db.webPushSubscription.findMany()).map((row) => row.endpoint).sort();
    expect(left).toEqual([endpoint("a2"), endpoint("b1")]);
  });
});
