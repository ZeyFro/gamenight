import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Classement par communauté (PR4) : seuls les membres ACTIVE de la communauté
 * demandée apparaissent, et les agrégats d'XP ne portent que sur eux. Sans
 * option (isolation éteinte), requêtes strictement inchangées.
 *
 * Limite assumée : l'XP elle-même n'est pas rattachée à une communauté
 * (`XpEvent` n'a pas de `communityId`) — le classement d'une communauté classe
 * ses membres sur leur XP personnelle.
 */

const { userFindMany, xpGroupBy, statsFindMany, gameStatsFindMany } = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  xpGroupBy: vi.fn(),
  statsFindMany: vi.fn(),
  gameStatsFindMany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findMany: userFindMany }, community: { findUnique: vi.fn(async () => ({ status: "ACTIVE" })) } },
}));
vi.mock("@/lib/default-community", () => ({ getDefaultCommunityId: vi.fn(async () => "default-id") }));
vi.mock("@/lib/community-scoped-client", () => ({ scopedPrismaForCommunityId: vi.fn(async () => ({
  xpEvent: { groupBy: xpGroupBy }, communityMemberStats: { findMany: statsFindMany }, groupGameStat: { findMany: gameStatsFindMany },
})) }));

import { getFunLeaderboards, getScoreboard } from "./scoreboard";

const user = (id: string, xpTotal = 0) => ({
  id,
  discordName: id,
  discordAvatar: null,
  color: "#fff",
  xpTotal,
});

describe("getScoreboard — communauté", () => {
  beforeEach(() => {
    userFindMany.mockReset().mockResolvedValue([user("a", 50), user("b", 10)]);
    xpGroupBy.mockReset().mockResolvedValue([]);
    statsFindMany.mockReset().mockResolvedValue([{ userId: "a", xpTotal: 50 }, { userId: "b", xpTotal: 10 }]);
    gameStatsFindMany.mockReset().mockResolvedValue([]);
  });

  it("sans option : roster historique mais progression dans default", async () => {
    await getScoreboard("global");
    expect(userFindMany.mock.calls[0][0]).not.toHaveProperty("where");
    for (const call of xpGroupBy.mock.calls) {
      expect(call[0].where.communityId).toBe("default-id");
    }
  });

  it("communautés `undefined` explicite : identique à sans option", async () => {
    await getScoreboard("week", { communityId: undefined });
    expect(userFindMany.mock.calls[0][0]).not.toHaveProperty("where");
  });

  it("avec une communauté : seuls ses membres ACTIVE sont classés", async () => {
    await getScoreboard("global", { communityId: "c-b" });
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { memberships: { some: { communityId: "c-b", status: "ACTIVE", community: { status: "ACTIVE" } } } },
      })
    );
  });

  it("les agrégats d'XP (période, soirées jouées, delta 7 jours) sont limités à ces membres", async () => {
    await getScoreboard("global", { communityId: "c-b" });
    expect(xpGroupBy).toHaveBeenCalled();
    for (const call of xpGroupBy.mock.calls) {
      expect(call[0].where.userId).toEqual({ in: ["a", "b"] });
      expect(call[0].where.communityId).toBe("c-b");
    }
  });

  it("période mensuelle : la restriction aux membres s'ajoute au filtre de date", async () => {
    await getScoreboard("month", { communityId: "c-b" });
    for (const call of xpGroupBy.mock.calls) {
      expect(call[0].where).toMatchObject({ userId: { in: ["a", "b"] }, createdAt: expect.anything() });
    }
  });

  it("conserve les achats historiques qui réduisaient la progression, sans compter les dépenses récentes", async () => {
    await getScoreboard("week");
    const periodXpQuery = xpGroupBy.mock.calls.find(([args]) => args.where.reason?.not);
    expect(periodXpQuery?.[0].where.reason).toEqual({ not: "SHOP_BALANCE_PURCHASE" });
  });

  it("communauté nulle (aucune communauté) : classement vide, aucune requête", async () => {
    await expect(getScoreboard("global", { communityId: null })).resolves.toEqual([]);
    expect(userFindMany).not.toHaveBeenCalled();
    expect(xpGroupBy).not.toHaveBeenCalled();
  });

  it("communauté sans membre : classement vide, agrégats limités à une liste vide", async () => {
    userFindMany.mockResolvedValue([]);
    await expect(getScoreboard("global", { communityId: "c-vide" })).resolves.toEqual([]);
    for (const call of xpGroupBy.mock.calls) {
      expect(call[0].where.userId).toEqual({ in: [] });
    }
  });

  it("classe par XP décroissant au sein de la communauté", async () => {
    const entries = await getScoreboard("global", { communityId: "c-b" });
    expect(entries.map((e) => e.userId)).toEqual(["a", "b"]);
  });
});

describe("getFunLeaderboards — isolation communautaire", () => {
  beforeEach(() => {
    userFindMany.mockReset().mockResolvedValue([user("a"), user("b")]);
    statsFindMany.mockReset().mockResolvedValue([]);
    gameStatsFindMany.mockReset().mockResolvedValue([]);
  });

  it("sans communauté, renvoie les trois classements vides sans lecture", async () => {
    await expect(getFunLeaderboards({ communityId: null })).resolves.toEqual({
      gamesByPlayTime: [],
      gamesByPlayCount: [],
      playersByStreak: [],
    });
    expect(userFindMany).not.toHaveBeenCalled();
    expect(gameStatsFindMany).not.toHaveBeenCalled();
  });

  it("restreint heures et séries aux données de la communauté sélectionnée", async () => {
    gameStatsFindMany
      .mockResolvedValueOnce([{ gameId: "g1", totalPlayMinutes: 180, game: { name: "Catan", coverUrl: null } }])
      .mockResolvedValueOnce([{ gameId: "g2", playCount: 4, game: { name: "Mario Kart", coverUrl: null } }]);
    statsFindMany.mockResolvedValue([{ userId: "a", streakCount: 12, user: { discordName: "Alice", discordAvatar: null, color: "#fff" } }]);

    await expect(getFunLeaderboards({ communityId: "c-b" })).resolves.toEqual({
      gamesByPlayTime: [{ gameId: "g1", name: "Catan", coverUrl: null, totalPlayMinutes: 180 }],
      gamesByPlayCount: [{ gameId: "g2", name: "Mario Kart", playCount: 4 }],
      playersByStreak: [{ userId: "a", discordName: "Alice", discordAvatar: null, color: "#fff", streakCount: 12 }],
    });
    expect(gameStatsFindMany.mock.calls[0][0]).toMatchObject({ where: { communityId: "c-b", totalPlayMinutes: { gt: 0 } }, orderBy: { totalPlayMinutes: "desc" } });
    expect(gameStatsFindMany.mock.calls[1][0]).toMatchObject({ where: { communityId: "c-b", playCount: { gt: 0 } }, orderBy: [{ playCount: "desc" }, { gameId: "asc" }] });
    expect(statsFindMany.mock.calls[0][0].where).toMatchObject({ communityId: "c-b", userId: { in: ["a", "b"] }, streakCount: { gt: 0 } });
    expect(userFindMany.mock.calls[0][0].where.memberships.some).toMatchObject({ communityId: "c-b", status: "ACTIVE" });
  });
});
