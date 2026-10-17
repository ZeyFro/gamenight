import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, deleteMany, sendNotification } = vi.hoisted(() => ({ findMany: vi.fn(), deleteMany: vi.fn(), sendNotification: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { webPushSubscription: { findMany, deleteMany } } }));
vi.mock("web-push", () => ({ default: { sendNotification } }));

import { sendUserWebPush } from "./web-push-delivery";

describe("livraison Web Push", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("WEB_PUSH_ENABLED", "true");
    vi.stubEnv("WEB_PUSH_VAPID_SUBJECT", "mailto:test@example.test");
    vi.stubEnv("WEB_PUSH_VAPID_PUBLIC_KEY", "public");
    vi.stubEnv("WEB_PUSH_VAPID_PRIVATE_KEY", "private");
    findMany.mockResolvedValue([{ id: "sub-1", endpoint: "https://fcm.googleapis.com/send/x", p256dh: "public-key", auth: "auth-key" }]);
    sendNotification.mockResolvedValue({ statusCode: 201 });
  });

  it("ne contacte aucun service si la configuration est absente ou désactivée", async () => {
    vi.stubEnv("WEB_PUSH_ENABLED", "false");
    await sendUserWebPush("user-1", { title: "Test", body: "Texte", url: "/profil" });
    expect(findMany).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("envoie uniquement aux souscriptions de l'utilisateur et supprime celles révoquées", async () => {
    sendNotification.mockRejectedValueOnce({ statusCode: 410 });
    await sendUserWebPush("user-1", { title: "Test", body: "Texte", url: "/profil" });
    expect(findMany).toHaveBeenCalledWith({ where: { userId: "user-1" }, select: { id: true, endpoint: true, p256dh: true, auth: true } });
    expect(sendNotification).toHaveBeenCalledOnce();
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: "sub-1", userId: "user-1" } });
  });
});
