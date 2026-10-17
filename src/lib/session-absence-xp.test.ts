import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), lock: vi.fn(), scoped: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/community-scoped-client", () => ({ scopedTransactionPrisma: mocks.scoped }));
vi.mock("@/lib/community-stats", () => ({ statsCommunityIdForSession: vi.fn(async () => "community-1") }));
vi.mock("@/lib/default-community", () => ({ getDefaultCommunityId: vi.fn(async () => "community-1") }));
vi.mock("@/lib/community-isolation", () => ({ isCommunityIsolationEnabled: vi.fn(() => false) }));
vi.mock("@/lib/member-stats", () => ({ lockCommunityProgress: mocks.lock }));

import { applySessionAbsencePenalty } from "@/lib/xp-actions";

describe("applySessionAbsencePenalty", () => {
  const tx = {
    $queryRaw: vi.fn(),
    communityMemberStats: {
      createMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    xpEvent: { create: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation((callback) => callback(tx));
    mocks.scoped.mockReturnValue(tx);
    mocks.lock.mockResolvedValue(true);
    tx.communityMemberStats.findUniqueOrThrow.mockResolvedValue({ xpTotal: 2 });
  });

  it("records a bounded negative event and never drops the balance below zero", async () => {
    await expect(applySessionAbsencePenalty("user-1", "community-1", "session-1", 5)).resolves.toBe(true);
    expect(tx.xpEvent.create).toHaveBeenCalledWith({
      data: { communityId: "community-1", userId: "user-1", reason: "SESSION_ABSENCE", sourceId: "session-1", amount: -2 },
    });
    expect(tx.communityMemberStats.update).toHaveBeenCalledWith(expect.objectContaining({ data: { xpTotal: { decrement: 2 } } }));
  });

  it("does not write an event when the member has no XP", async () => {
    tx.communityMemberStats.findUniqueOrThrow.mockResolvedValueOnce({ xpTotal: 0 });
    await expect(applySessionAbsencePenalty("user-1", "community-1", "session-1", 1)).resolves.toBe(false);
    expect(tx.xpEvent.create).not.toHaveBeenCalled();
    expect(tx.communityMemberStats.update).not.toHaveBeenCalled();
  });
});
