import { beforeEach, describe, expect, it, vi } from "vitest";

const { claimNextDelivery } = vi.hoisted(() => ({ claimNextDelivery: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/notification-delivery", () => ({
  claimNextDelivery,
  finalizeDeliveryFailure: vi.fn(), finalizeDeliverySuccess: vi.fn(),
  hasSufficientLeaseRemaining: vi.fn(), MIN_CALL_MARGIN_MS: 5000,
  recoverExpiredReservations: vi.fn(), hasDeliveryWork: vi.fn(),
}));
vi.mock("@/lib/discord-rest", () => ({
  addThreadMember: vi.fn(), addThreadMemberVerified: vi.fn(), archiveThread: vi.fn(),
  deleteChannelMessage: vi.fn(), deleteThreadPermanently: vi.fn(), editChannelMessage: vi.fn(),
  removeThreadMemberVerified: vi.fn(), sendChannelMessage: vi.fn(), sendChannelMessageVerified: vi.fn(),
  sendDirectMessage: vi.fn(), sendThreadMessage: vi.fn(), sendThreadMessageVerified: vi.fn(),
  sendRewardWebhook: vi.fn(), startPrivateThread: vi.fn(), startThreadFromMessage: vi.fn(),
}));

import { processNextDelivery } from "./notification-executor";

describe("notification executor Preview guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VERCEL_ENV", "preview");
  });

  it("does not claim work when called directly in Preview", async () => {
    await expect(processNextDelivery({ owner: "preview-test", resolver: { resolve: vi.fn() } })).resolves.toBeNull();
    expect(claimNextDelivery).not.toHaveBeenCalled();
  });
});
