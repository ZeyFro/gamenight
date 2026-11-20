import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: { game: { findUnique: vi.fn() } } }));
vi.mock("@/lib/community-isolation", () => ({ resolveActiveCommunityId: vi.fn() }));
vi.mock("@/lib/community-scoped-client", () => ({ scopedPrismaForCommunity: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotifications: vi.fn() }));

import { isNotificationCenterEnabled, notifyGamePingOptIns, setOwnGamePingOptIn } from "@/lib/game-ping-optin";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { scopedPrismaForCommunity } from "@/lib/community-scoped-client";
import { createNotifications } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("NOTIFICATION_CENTER_ENABLED", () => {
  it("OFF par défaut, actif seulement si exactement `true`", () => {
    expect(isNotificationCenterEnabled()).toBe(false);
    vi.stubEnv("NOTIFICATION_CENTER_ENABLED", "TRUE");
    expect(isNotificationCenterEnabled()).toBe(false);
    vi.stubEnv("NOTIFICATION_CENTER_ENABLED", "true");
    expect(isNotificationCenterEnabled()).toBe(true);
  });

  it("éteint : aucune écriture ni notification", async () => {
    expect(await setOwnGamePingOptIn("u1", "g1", true)).toBe("disabled");
    expect(await notifyGamePingOptIns({ communityId: "c1", gameId: "g1", title: "t", message: "m" })).toBe(0);
    expect(resolveActiveCommunityId).not.toHaveBeenCalled();
    expect(createNotifications).not.toHaveBeenCalled();
  });
});

describe("opt-in explicite", () => {
  it("sans communauté active : refus, rien d'écrit", async () => {
    vi.stubEnv("NOTIFICATION_CENTER_ENABLED", "true");
    vi.mocked(resolveActiveCommunityId).mockResolvedValue(null);
    expect(await setOwnGamePingOptIn("u1", "g1", true)).toBe("no_community");
    expect(scopedPrismaForCommunity).not.toHaveBeenCalled();
  });

  it("jeu inconnu : refus", async () => {
    vi.stubEnv("NOTIFICATION_CENTER_ENABLED", "true");
    vi.mocked(resolveActiveCommunityId).mockResolvedValue("c1");
    vi.mocked(scopedPrismaForCommunity).mockReturnValue({ gamePingOptIn: {} } as never);
    vi.mocked(prisma.game.findUnique).mockResolvedValue(null as never);
    expect(await setOwnGamePingOptIn("u1", "nope", true)).toBe("unknown_game");
  });

  it("plafond de jeux suivis", async () => {
    vi.stubEnv("NOTIFICATION_CENTER_ENABLED", "true");
    vi.mocked(resolveActiveCommunityId).mockResolvedValue("c1");
    vi.mocked(prisma.game.findUnique).mockResolvedValue({ id: "g1" } as never);
    vi.mocked(scopedPrismaForCommunity).mockReturnValue({ gamePingOptIn: { count: vi.fn().mockResolvedValue(50) } } as never);
    expect(await setOwnGamePingOptIn("u1", "g1", true)).toBe("too_many");
  });

  it("l'upsert ne porte que l'utilisateur authentifié et sa communauté", async () => {
    vi.stubEnv("NOTIFICATION_CENTER_ENABLED", "true");
    vi.mocked(resolveActiveCommunityId).mockResolvedValue("c1");
    vi.mocked(prisma.game.findUnique).mockResolvedValue({ id: "g1" } as never);
    const upsert = vi.fn();
    vi.mocked(scopedPrismaForCommunity).mockReturnValue({ gamePingOptIn: { count: vi.fn().mockResolvedValue(0), upsert } } as never);
    expect(await setOwnGamePingOptIn("u1", "g1", true)).toBe("ok");
    expect(upsert).toHaveBeenCalledWith({
      where: { userId_communityId_gameId: { userId: "u1", communityId: "c1", gameId: "g1" } },
      create: { userId: "u1", communityId: "c1", gameId: "g1" },
      update: {},
    });
  });
});

describe("notification des abonnés", () => {
  it("in-app uniquement, vers les abonnés actifs hors auteur", async () => {
    vi.stubEnv("NOTIFICATION_CENTER_ENABLED", "true");
    const findMany = vi.fn().mockResolvedValue([{ userId: "u2" }, { userId: "u3" }]);
    vi.mocked(scopedPrismaForCommunity).mockReturnValue({ gamePingOptIn: { findMany } } as never);
    const sent = await notifyGamePingOptIns({ communityId: "c1", gameId: "g1", title: "Deadlock", message: "Ça joue", excludeUserId: "u1" });
    expect(sent).toBe(2);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ userId: { not: "u1" }, user: { memberships: { some: { status: "ACTIVE" } } } });
    expect(vi.mocked(createNotifications).mock.calls[0][0].map((n) => n.userId)).toEqual(["u2", "u3"]);
  });
});
