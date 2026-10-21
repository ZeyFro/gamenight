import { beforeEach, describe, expect, it, vi } from "vitest";

const { getActiveScopedPrisma, scopedPrisma, notificationFindMany, sessionFindMany } = vi.hoisted(() => ({
  getActiveScopedPrisma: vi.fn(),
  scopedPrisma: vi.fn(),
  notificationFindMany: vi.fn(),
  sessionFindMany: vi.fn(),
}));

vi.mock("@/lib/community-scoped-client", () => ({ getActiveScopedPrisma, scopedPrisma }));
vi.mock("@/lib/web-push-delivery", () => ({ sendUserWebPush: vi.fn() }));

import { groupNotifications } from "./notifications";

describe("groupNotifications — portée fail-closed", () => {
  beforeEach(() => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    getActiveScopedPrisma.mockReset();
    scopedPrisma.mockReset();
    notificationFindMany.mockReset();
    sessionFindMany.mockReset();
  });

  it("refuse la portée globale quand aucun viewer n'est fourni, isolation OFF comprise", async () => {
    await expect(groupNotifications([])).resolves.toEqual([]);
    expect(getActiveScopedPrisma).not.toHaveBeenCalled();
    expect(scopedPrisma).not.toHaveBeenCalled();
  });

  it("isolation OFF : un viewer fourni filtre toujours ses propres notifications", async () => {
    notificationFindMany.mockResolvedValue([]);
    sessionFindMany.mockResolvedValue([]);
    getActiveScopedPrisma.mockResolvedValue({
      notification: { findMany: notificationFindMany },
      session: { findMany: sessionFindMany },
    });
    const item = {
      id: "n1", type: "BADGE", title: "Badge", message: "Gagné", read: false,
      createdAt: new Date(), relatedSessionId: null, relatedBadgeId: null, relatedGameId: null,
    } as Parameters<typeof groupNotifications>[0][number];

    await expect(groupNotifications([item], "user-1")).resolves.toEqual([]);
    expect(getActiveScopedPrisma).toHaveBeenCalledWith("user-1");
    expect(notificationFindMany).toHaveBeenCalledWith({
      where: { userId: "user-1", id: { in: ["n1"] } }, select: { id: true },
    });
    expect(scopedPrisma).not.toHaveBeenCalled();
  });
});
