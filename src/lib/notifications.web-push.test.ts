import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, createMany, scopedPrismaForCommunity, sendUserWebPush, loggerError, loggerWarn, eligibleChannelUserIds } = vi.hoisted(() => {
  const create = vi.fn();
  const createMany = vi.fn();
  return {
    create,
    createMany,
    scopedPrismaForCommunity: vi.fn(() => ({ notification: { create, createMany } })),
    sendUserWebPush: vi.fn(),
    loggerError: vi.fn(),
    loggerWarn: vi.fn(),
    eligibleChannelUserIds: vi.fn(),
  };
});

vi.mock("@/lib/web-push-delivery", () => ({ sendUserWebPush }));
vi.mock("@/lib/community-scoped-client", () => ({ scopedPrismaForCommunity, getActiveScopedPrisma: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: loggerError, warn: loggerWarn } }));
vi.mock("@/lib/notification-channel-preferences", () => ({ getEligibleUserIdsForNotificationChannel: eligibleChannelUserIds }));

import { createNotification, createNotifications } from "./notifications";

describe("notification Web Push", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eligibleChannelUserIds.mockImplementation((userIds: string[]) => Promise.resolve(new Set(userIds)));
  });

  it("envoie après l’écriture in-app réussie, avec une URL relative", async () => {
    await createNotification({ userId: "user-1", communityId: "community-1", type: "BADGE", title: "Badge", message: "Gagné", relatedBadgeId: "badge-1" });
    expect(scopedPrismaForCommunity).toHaveBeenCalledWith("community-1");
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

  it("refuse une notification sans communauté explicite au lieu de chercher un parent global", async () => {
    await createNotification({
      userId: "user-1", communityId: undefined, type: "BADGE", title: "Badge", message: "Gagné",
    } as unknown as Parameters<typeof createNotification>[0]);

    expect(scopedPrismaForCommunity).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(sendUserWebPush).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledOnce();
  });

  it("keeps push when in-app is disabled for the personal category", async () => {
    eligibleChannelUserIds.mockImplementation((userIds: string[], _category: string, channel: string) =>
      Promise.resolve(new Set(channel === "WEB_PUSH" ? userIds : []))
    );

    await createNotifications([{
      userId: "user-1", communityId: "community-1", type: "REMINDER", title: "Rappel", message: "Ce soir",
      personalCategory: "SESSION",
    }]);

    expect(createMany).not.toHaveBeenCalled();
    expect(sendUserWebPush).toHaveBeenCalledOnce();
    expect(eligibleChannelUserIds).toHaveBeenCalledWith(["user-1"], "SESSION", "IN_APP");
    expect(eligibleChannelUserIds).toHaveBeenCalledWith(["user-1"], "SESSION", "WEB_PUSH");
  });

  it("keeps push independent when the in-app database write fails", async () => {
    createMany.mockRejectedValueOnce(new Error("database unavailable"));
    await createNotifications([{
      userId: "user-1", communityId: "community-1", type: "REMINDER", title: "Rappel", message: "Ce soir",
      personalCategory: "SESSION",
    }]);
    expect(createMany).toHaveBeenCalledOnce();
    expect(sendUserWebPush).toHaveBeenCalledOnce();
    expect(loggerError).toHaveBeenCalledOnce();
  });
});
