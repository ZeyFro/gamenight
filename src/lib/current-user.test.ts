import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  userFindUnique: vi.fn(),
  writeCommunityIdForUser: vi.fn(),
  getMemberStats: vi.fn(),
  touchStreak: vi.fn(),
  checkTemporalBadges: vi.fn(),
  getActiveCommunityState: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.userFindUnique } } }));
vi.mock("@/lib/community-stats", () => ({ writeCommunityIdForUser: mocks.writeCommunityIdForUser }));
vi.mock("@/lib/community-picker", () => ({ getActiveCommunityState: mocks.getActiveCommunityState }));
vi.mock("@/lib/member-stats", () => ({
  ZERO_MEMBER_STATS: { xpTotal: 0, streakCount: 0, streakLastActiveAt: null, bestStreakCount: 0, tournamentsParticipatedCount: 0 },
  getMemberStats: mocks.getMemberStats,
  projectUserProgress: (user: object, stats: object) => ({ ...user, ...stats }),
}));
vi.mock("@/lib/xp-actions", () => ({ touchStreak: mocks.touchStreak }));
vi.mock("@/lib/badges", () => ({ checkTemporalBadges: mocks.checkTemporalBadges }));

import { getCurrentUser } from "./current-user";

describe("getCurrentUser — adhésion fraîche", () => {
  const user = { id: "u1", discordId: "user-1", role: "USER", createdAt: new Date(0) };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { discordId: "user-1", sessionCreatedAt: Date.now() } });
    mocks.userFindUnique.mockResolvedValue(user);
    mocks.writeCommunityIdForUser.mockResolvedValue(null);
    mocks.getActiveCommunityState.mockResolvedValue({ kind: "none" });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("revalide un ancien JWT sans communauté ACTIVE (après LEFT/REMOVED) avant toute stats", async () => {
    mocks.auth.mockResolvedValue({ user: { discordId: "user-1", sessionCreatedAt: Date.now() - 30 * 24 * 60 * 60 * 1000 } });
    await expect(getCurrentUser()).resolves.toBeNull();
    expect(mocks.writeCommunityIdForUser).toHaveBeenCalledWith("u1");
    expect(mocks.getMemberStats).not.toHaveBeenCalled();
    expect(mocks.touchStreak).not.toHaveBeenCalled();
  });

  it("un ADMIN_DISCORD_IDS sans membership conserve l'accès plateforme avec stats à zéro", async () => {
    vi.stubEnv("ADMIN_DISCORD_IDS", "user-1");
    const admin = await getCurrentUser({ allowPlatformAdminWithoutMembership: true });
    expect(admin).toMatchObject({ id: "u1", role: "USER", xpTotal: 0, streakCount: 0 });
    expect(mocks.getMemberStats).not.toHaveBeenCalled();
    expect(mocks.touchStreak).not.toHaveBeenCalled();
  });

  it("un User.role=ADMIN sans membership conserve le même accès plateforme sans stats collectives", async () => {
    mocks.userFindUnique.mockResolvedValue({ ...user, role: "ADMIN" });
    const admin = await getCurrentUser({ allowPlatformAdminWithoutMembership: true });
    expect(admin).toMatchObject({ id: "u1", role: "ADMIN", xpTotal: 0, streakCount: 0 });
    expect(mocks.getMemberStats).not.toHaveBeenCalled();
    expect(mocks.touchStreak).not.toHaveBeenCalled();
  });

  it("l'option admin ne donne pas de bypass à un utilisateur ordinaire", async () => {
    vi.stubEnv("ADMIN_DISCORD_IDS", "another-user");
    await expect(getCurrentUser({ allowPlatformAdminWithoutMembership: true })).resolves.toBeNull();
  });

  it("la sélection autorisée conserve l'identité d'un membre de deux serveurs sans lire ni écrire de stats", async () => {
    mocks.getActiveCommunityState.mockResolvedValue({ kind: "needs-choice", communityIds: ["a", "b"] });
    const result = await getCurrentUser({ allowCommunitySelection: true });
    expect(result).toMatchObject({ id: "u1", xpTotal: 0 });
    expect(mocks.getMemberStats).not.toHaveBeenCalled();
    expect(mocks.touchStreak).not.toHaveBeenCalled();
  });

  it("sans option, un choix manquant n'accorde aucun accès collectif", async () => {
    mocks.getActiveCommunityState.mockResolvedValue({ kind: "needs-choice", communityIds: ["a", "b"] });
    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it.each(["none", "disabled"])("la sélection n'autorise pas l'état %s", async (kind) => {
    mocks.getActiveCommunityState.mockResolvedValue({ kind });
    await expect(getCurrentUser({ allowCommunitySelection: true })).resolves.toBeNull();
    expect(mocks.touchStreak).not.toHaveBeenCalled();
  });

  it("la sélection ne contourne pas une reconnexion forcée", async () => {
    mocks.userFindUnique.mockResolvedValue({ ...user, forceReloginAt: new Date(Date.now() + 1000) });
    mocks.getActiveCommunityState.mockResolvedValue({ kind: "needs-choice", communityIds: ["a", "b"] });
    await expect(getCurrentUser({ allowCommunitySelection: true })).resolves.toBeNull();
    expect(mocks.getActiveCommunityState).not.toHaveBeenCalled();
  });
});
