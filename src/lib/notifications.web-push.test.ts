import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, createMany, sendUserWebPush, loggerError, loggerWarn } = vi.hoisted(() => ({
  create: vi.fn(),
  createMany: vi.fn(),
  sendUserWebPush: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock("@/lib/web-push-delivery", () => ({ sendUserWebPush }));
vi.mock("@/lib/community-scoped-client", () => ({ scopedPrisma: () => ({ notification: { create, createMany } }), getActiveScopedPrisma: vi.fn() }));
vi.mock("@/lib/default-community", () => ({ getDefaultCommunityId: vi.fn(async () => "community-1") }));
vi.mock("@/lib/community-isolation", () => ({ isCommunityIsolationEnabled: () => false }));
vi.mock("@/lib/logger", () => ({ logger: { error: loggerError, warn: loggerWarn } }));

import { createNotification, createNotifications } from "./notifications";

describe("notification Web Push", () => {
  beforeEach(() => vi.clearAllMocks());

  it("envoie après l’écriture in-app réussie, avec une URL relative", async () => {
    await createNotification({ userId: "user-1", communityId: "community-1", type: "BADGE", title: "Badge", message: "Gagné", relatedBadgeId: "badge-1" });
    expect(sendUserWebPush).toHaveBeenCalledWith("user-1", { title: "Badge", body: "Gagné", url: "/profil/badges" });
  });

  it("ne bloque pas l’action in-app si la livraison push échoue", async () => {
    sendUserWebPush.mockRejectedValueOnce(new Error("push unavailable"));
    await expect(createNotification({ userId: "user-1", communityId: "community-1", type: "BADGE", title: "Badge", message: "Gagné" })).resolves.toBeUndefined();
    expect(loggerWarn).toHaveBeenCalledOnce();
  });

  it("pousse les notifications groupées après leur insertion", async () => {
    await createNotifications([
      { userId: "user-1", communityId: "community-1", type: "BADGE", title: "Badge", message: "Gagné", relatedBadgeId: "badge-1" },
      { userId: "user-2", communityId: "community-1", type: "BADGE", title: "Niveau", message: "Montée" },
    ]);
    expect(createMany).toHaveBeenCalledOnce();
    expect(sendUserWebPush).toHaveBeenNthCalledWith(1, "user-1", { title: "Badge", body: "Gagné", url: "/profil/badges" });
    expect(sendUserWebPush).toHaveBeenNthCalledWith(2, "user-2", { title: "Niveau", body: "Montée", url: "/" });
  });
});
