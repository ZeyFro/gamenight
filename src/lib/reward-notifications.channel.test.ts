import { beforeEach, describe, expect, it, vi } from "vitest";

const { eventCreateMany, notificationCreate, deliveryCreate, communityFindUnique, eligibleIds } = vi.hoisted(() => ({
  eventCreateMany: vi.fn(),
  notificationCreate: vi.fn(),
  deliveryCreate: vi.fn(),
  communityFindUnique: vi.fn(),
  eligibleIds: vi.fn(),
}));

vi.mock("@/lib/community-scoped-client", () => ({
  scopedTransactionPrisma: vi.fn(() => ({
    notificationEvent: { createMany: eventCreateMany },
    notification: { create: notificationCreate },
  })),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { notificationDelivery: { findFirst: vi.fn() } } }));
vi.mock("@/lib/notification-channel-preferences", () => ({
  getEligibleUserIdsForNotificationChannel: eligibleIds,
}));
vi.mock("@/lib/community-announce", () => ({ immediateDefaultRewardResolver: {} }));
vi.mock("@/lib/notification-executor", () => ({ processNextDelivery: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { persistRewardNotice } from "./reward-notifications";

const tx = {
  community: { findUniqueOrThrow: communityFindUnique },
  notificationDelivery: { create: deliveryCreate },
} as never;
const credit = { id: "credit-1", communityId: "community-1", userId: "player-1" };
const notice = {
  type: "PRONOSTIC" as const,
  title: "Récompense",
  message: "Bravo",
  relatedSessionId: "session-1",
  embed: { title: "Système", color: 0x123456 },
};

describe("persistRewardNotice channel preference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventCreateMany.mockResolvedValue({ count: 1 });
    notificationCreate.mockResolvedValue(undefined);
    deliveryCreate.mockResolvedValue(undefined);
    communityFindUnique.mockResolvedValue({ slug: "default" });
    eligibleIds.mockResolvedValue(new Set([credit.userId]));
    vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "false");
  });

  it("keeps the community announcement when the personal in-app reward is disabled", async () => {
    eligibleIds.mockResolvedValue(new Set());
    await persistRewardNotice(tx, credit, notice);
    expect(eligibleIds).toHaveBeenCalledWith([credit.userId], "REWARD", "IN_APP", tx);
    expect(notificationCreate).not.toHaveBeenCalled();
    expect(deliveryCreate).toHaveBeenCalledOnce();
  });

  it("writes the personal reward row when in-app is enabled", async () => {
    await persistRewardNotice(tx, credit, notice);
    expect(notificationCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      id: "xp-reward:credit-1", userId: credit.userId, type: "PRONOSTIC",
    }) });
  });

  it("keeps duplicate reward persistence idempotent", async () => {
    eventCreateMany.mockResolvedValue({ count: 0 });
    await persistRewardNotice(tx, credit, notice);
    expect(eligibleIds).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
    expect(deliveryCreate).not.toHaveBeenCalled();
  });
});
