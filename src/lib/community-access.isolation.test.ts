import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Isolation (PR4) — accès à un tournoi et communauté du classement. Éteint
 * (`COMMUNITY_ISOLATION_ENABLED` ≠ `true`) : seules les adhésions ACTIVES à
 * `default` gardent le périmètre historique.
 */

const mocks = vi.hoisted(() => ({
  tournamentFindFirst: vi.fn(),
  membershipFindMany: vi.fn(),
  membershipFindUnique: vi.fn(),
  getCurrentUser: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    tournament: { findFirst: mocks.tournamentFindFirst },
    membership: { findMany: mocks.membershipFindMany, findUnique: mocks.membershipFindUnique },
  },
}));

import { canAccessTournament, getScoreboardCommunityId } from "./community-access";

const m = (communityId: string, slug: string) => ({ communityId, community: { slug } });

describe("community-access — isolation (tournois, classement)", () => {
  beforeEach(() => {
    mocks.tournamentFindFirst.mockReset().mockResolvedValue({ id: "t1" });
    mocks.membershipFindMany.mockReset().mockResolvedValue([m("c-b", "serveur-b")]);
    mocks.membershipFindUnique.mockReset().mockResolvedValue(null);
    mocks.getCurrentUser.mockReset().mockResolvedValue({ id: "u1" });
    mocks.notFound.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("canAccessTournament", () => {
    it("isolation éteinte : membre B seulement, tournoi default refusé", async () => {
      mocks.tournamentFindFirst.mockResolvedValue(null);
      await expect(canAccessTournament("u1", "t1")).resolves.toBe(false);
      expect(mocks.membershipFindMany).toHaveBeenCalledOnce();
      expect(mocks.tournamentFindFirst).toHaveBeenCalledWith({
        where: { id: "t1", OR: [{ communityId: { in: ["c-b"] } }] },
        select: { id: true },
      });
    });

    it("isolation éteinte : le membre B conserve ses accès explicites à B", async () => {
      await expect(canAccessTournament("u1", "t-b")).resolves.toBe(true);
      expect(mocks.tournamentFindFirst).toHaveBeenCalledWith({
        where: { id: "t-b", OR: [{ communityId: { in: ["c-b"] } }] },
        select: { id: true },
      });
    });

    it("isolation éteinte : membre default, conserve null mais reste limité à ses communautés", async () => {
      mocks.membershipFindMany.mockResolvedValue([m("c-def", "default")]);
      mocks.tournamentFindFirst.mockResolvedValue(null);
      await expect(canAccessTournament("u1", "t1")).resolves.toBe(false);
      expect(mocks.tournamentFindFirst).toHaveBeenCalledWith({
        where: { id: "t1", OR: [{ communityId: { in: ["c-def"] } }, { communityId: null }] },
        select: { id: true },
      });
    });

    it("allumée : le tournoi doit appartenir à une communauté de l'utilisateur", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
      await expect(canAccessTournament("u1", "t1")).resolves.toBe(true);
      expect(mocks.tournamentFindFirst).toHaveBeenCalledWith({
        where: { id: "t1", OR: [{ communityId: { in: ["c-b"] } }] },
        select: { id: true },
      });
    });

    it("tournoi d'une autre communauté : faux (indistinct d'un tournoi inexistant)", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
      mocks.tournamentFindFirst.mockResolvedValue(null);
      await expect(canAccessTournament("u1", "t-autre")).resolves.toBe(false);
    });

    it("tournoi historique (communityId null) : accessible aux seuls membres de `default`", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
      mocks.membershipFindMany.mockResolvedValue([m("c-def", "default")]);
      await canAccessTournament("u1", "t1");
      expect(mocks.tournamentFindFirst.mock.calls[0][0].where.OR).toEqual([
        { communityId: { in: ["c-def"] } },
        { communityId: null },
      ]);
    });
  });

  describe("getScoreboardCommunityId", () => {
    it("isolation éteinte : membre B seulement, aucun classement par repli default", async () => {
      await expect(getScoreboardCommunityId("u1", "c-b")).resolves.toBe("c-b");
      expect(mocks.membershipFindMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { userId: "u1", status: "ACTIVE", community: { status: "ACTIVE" } },
      }));
    });

    it("isolation éteinte : le membre default voit le classement historique", async () => {
      mocks.membershipFindMany.mockResolvedValue([m("c-def", "default")]);
      await expect(getScoreboardCommunityId("u1", "c-b")).resolves.toBe("c-def");
    });

    it("allumée sans communauté demandée : la communauté active de l'utilisateur", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
      await expect(getScoreboardCommunityId("u1")).resolves.toBe("c-b");
    });

    it("allumée, utilisateur sans aucune communauté : null (classement vide)", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
      mocks.membershipFindMany.mockResolvedValue([]);
      await expect(getScoreboardCommunityId("u1")).resolves.toBeNull();
    });

    it("communauté demandée dont l'utilisateur est membre ACTIVE (requireMembership) : acceptée", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
      mocks.membershipFindUnique.mockResolvedValue({
        id: "m1",
        status: "ACTIVE",
        community: { id: "c-x", status: "ACTIVE" },
      });
      await expect(getScoreboardCommunityId("u1", "c-x")).resolves.toBe("c-x");
    });

    it("communauté demandée dont l'utilisateur n'est PAS membre : 404, jamais le classement d'une autre communauté", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
      mocks.membershipFindUnique.mockResolvedValue(null);
      await expect(getScoreboardCommunityId("u1", "c-autre")).rejects.toThrow("NEXT_NOT_FOUND");
    });

    it("membre LEFT/REMOVED ou communauté suspendue : 404", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
      mocks.membershipFindUnique.mockResolvedValue({
        id: "m1",
        status: "REMOVED",
        community: { id: "c-x", status: "ACTIVE" },
      });
      await expect(getScoreboardCommunityId("u1", "c-x")).rejects.toThrow("NEXT_NOT_FOUND");
      mocks.membershipFindUnique.mockResolvedValue({
        id: "m1",
        status: "ACTIVE",
        community: { id: "c-x", status: "SUSPENDED" },
      });
      await expect(getScoreboardCommunityId("u1", "c-x")).rejects.toThrow("NEXT_NOT_FOUND");
    });
  });
});
