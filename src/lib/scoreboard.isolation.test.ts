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

const { userFindMany, xpGroupBy, statsFindMany } = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  xpGroupBy: vi.fn(),
  statsFindMany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findMany: userFindMany }, community: { findUnique: vi.fn(async () => ({ status: "ACTIVE" })) } },
}));
vi.mock("@/lib/default-community", () => ({ getDefaultCommunityId: vi.fn(async () => "default-id") }));
vi.mock("@/lib/community-scoped-client", () => ({ scopedPrismaForCommunityId: vi.fn(async () => ({
  xpEvent: { groupBy: xpGroupBy }, communityMemberStats: { findMany: statsFindMany },
})) }));

import { getScoreboard } from "./scoreboard";

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
