import { createECDH } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, deleteMany, sendNotification, warn } = vi.hoisted(() => ({ findMany: vi.fn(), deleteMany: vi.fn(), sendNotification: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { webPushSubscription: { findMany, deleteMany } } }));
vi.mock("@/lib/logger", () => ({ logger: { warn, error: vi.fn(), info: vi.fn() } }));
vi.mock("web-push", () => ({ default: { sendNotification } }));

import { sendUserWebPush } from "./web-push-delivery";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const PUBLIC = ecdh.getPublicKey().toString("base64url");
const PRIVATE = ecdh.getPrivateKey().toString("base64url");
const payload = { title: "Test", body: "Texte", url: "/profil" };

describe("livraison Web Push", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("WEB_PUSH_ENABLED", "true");
    vi.stubEnv("WEB_PUSH_VAPID_SUBJECT", "mailto:test@example.test");
    vi.stubEnv("WEB_PUSH_VAPID_PUBLIC_KEY", PUBLIC);
    vi.stubEnv("WEB_PUSH_VAPID_PRIVATE_KEY", PRIVATE);
    findMany.mockResolvedValue([{ id: "sub-1", endpoint: "https://fcm.googleapis.com/send/x", p256dh: "public-key", auth: "auth-key" }]);
    sendNotification.mockResolvedValue({ statusCode: 201 });
  });

  it("ne contacte aucun service si la fonction est éteinte, sans bruit dans le journal", async () => {
    vi.stubEnv("WEB_PUSH_ENABLED", "false");
    await sendUserWebPush("user-1", payload);
    expect(findMany).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("allumée mais mal configurée : journal compréhensible sans clé, aucun envoi, aucune exception", async () => {
    vi.stubEnv("WEB_PUSH_VAPID_PRIVATE_KEY", "private-secret-value");
    await expect(sendUserWebPush("user-1", payload)).resolves.toBeUndefined();
    expect(sendNotification).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("web-push", expect.stringContaining("WEB_PUSH_VAPID_PRIVATE_KEY"), expect.anything());
    expect(JSON.stringify(warn.mock.calls)).not.toContain("private-secret-value");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(PRIVATE);
  });

  it("envoie uniquement aux souscriptions de l'utilisateur et supprime celles révoquées", async () => {
    sendNotification.mockRejectedValueOnce({ statusCode: 410 });
    await sendUserWebPush("user-1", payload);
    expect(findMany).toHaveBeenCalledWith({ where: { userId: "user-1" }, select: { id: true, endpoint: true, p256dh: true, auth: true } });
    expect(sendNotification).toHaveBeenCalledOnce();
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: "sub-1", userId: "user-1" } });
  });

  it("supprime aussi sur 404 et conserve l'abonnement sur 429, 500, 503 ou erreur réseau", async () => {
    sendNotification.mockRejectedValueOnce({ statusCode: 404 });
    await sendUserWebPush("user-1", payload);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    deleteMany.mockClear();
    for (const failure of [{ statusCode: 429 }, { statusCode: 500 }, { statusCode: 503 }, new Error("ECONNRESET")]) {
      sendNotification.mockRejectedValueOnce(failure);
      await expect(sendUserWebPush("user-1", payload)).resolves.toBeUndefined();
    }
    expect(deleteMany).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it("un appareil en échec n'empêche pas les suivants", async () => {
    findMany.mockResolvedValue([
      { id: "a", endpoint: "https://fcm.googleapis.com/send/a", p256dh: "p", auth: "a" },
      { id: "b", endpoint: "https://fcm.googleapis.com/send/b", p256dh: "p", auth: "a" },
    ]);
    sendNotification.mockRejectedValueOnce({ statusCode: 500 });
    await sendUserWebPush("user-1", payload);
    expect(sendNotification).toHaveBeenCalledTimes(2);
  });
});
