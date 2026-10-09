import { beforeEach, describe, expect, it, vi } from "vitest";
const { earned, ledger, awardXp, canProgress } = vi.hoisted(() => ({
  earned: vi.fn(), ledger: vi.fn(), awardXp: vi.fn(), canProgress: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { badge: { findMany: async () => [] } } }));
vi.mock("@/lib/community-scoped-client", () => ({ scopedPrismaForCommunityId: async () => ({
  userBadge: { findMany: earned }, xpEvent: { findMany: ledger, count: async () => 5 },
}) }));
vi.mock("@/lib/community-stats", () => ({ statsCommunityIdForSession: async (id: string) => id }));
vi.mock("@/lib/member-stats", () => ({ canProgressInCommunity: canProgress }));
vi.mock("@/lib/xp-actions", () => ({ awardXp }));
vi.mock("@/lib/discord-badge-unlocked", () => ({ announceBadgeUnlocked: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
import { checkSessionsCreatedBadges } from "./badges";
beforeEach(() => {
  vi.clearAllMocks(); canProgress.mockResolvedValue(true);
  earned.mockResolvedValue(["done", "missing"].map((badgeId) => ({ badgeId, badge: { xpReward: 10 } })));
  ledger.mockResolvedValue([{ sourceId: "done" }]);
});
describe("réparation des badges sans recréditer les gains existants", () => {
  it("répare seulement le crédit manquant du serveur courant", async () => {
    await checkSessionsCreatedBadges("user", "tower");
    expect(awardXp).toHaveBeenCalledExactlyOnceWith("user", "tower", "BADGE_UNLOCKED", "missing", 10);
    expect(ledger).toHaveBeenCalledWith({ where: { communityId: "tower", userId: "user", reason: "BADGE_UNLOCKED", sourceId: { in: ["done", "missing"] } }, select: { sourceId: true } });
  });
  it("100 badges déjà récompensés : une lecture groupée et aucune attribution XP", async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `badge-${i}`);
    earned.mockResolvedValue(ids.map((badgeId) => ({ badgeId, badge: { xpReward: 10 } })));
    ledger.mockResolvedValue(ids.map((sourceId) => ({ sourceId })));
    await checkSessionsCreatedBadges("user", "tower");
    expect(ledger).toHaveBeenCalledOnce(); expect(awardXp).not.toHaveBeenCalled();
  });
  it("une appartenance retirée ne déclenche ni réparation ni lecture du ledger", async () => {
    canProgress.mockResolvedValue(false);
    await checkSessionsCreatedBadges("user", "tower");
    expect(ledger).not.toHaveBeenCalled(); expect(awardXp).not.toHaveBeenCalled();
  });
});
