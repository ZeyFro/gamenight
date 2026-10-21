import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Multi-communautés, PR4 — isolation des données par communauté, derrière
 * `COMMUNITY_ISOLATION_ENABLED` (éteint par défaut : les membres actifs de
 * `default` gardent le mode historique). Allumé : un utilisateur ne voit que les données des communautés
 * ACTIVE où il a un Membership ACTIVE ; `communityId = null` désigne la
 * communauté `default`. Fail-closed : sans aucune communauté, rien n'est visible.
 */

const { membershipFindMany, membershipFindFirst, communityFindUnique, userFindFirst } = vi.hoisted(() => ({
  membershipFindMany: vi.fn(),
  membershipFindFirst: vi.fn(),
  communityFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    membership: { findMany: membershipFindMany, findFirst: membershipFindFirst },
    community: { findUnique: communityFindUnique },
    user: { findFirst: userFindFirst },
  },
}));

import {
  canViewPote,
  communityIdFilter,
  communityMemberUserWhere,
  creationMemberUserWhere,
  getIsolationScope,
  isCommunityIsolationEnabled,
  isMemberOfCommunity,
  memberUserWhere,
  resolveActiveCommunityId,
} from "./community-isolation";

const m = (communityId: string, slug: string) => ({ communityId, community: { slug } });

describe("community-isolation", () => {
  beforeEach(() => {
    membershipFindMany.mockReset().mockResolvedValue([]);
    membershipFindFirst.mockReset().mockResolvedValue(null);
    communityFindUnique.mockReset().mockResolvedValue({ id: "c-def" });
    userFindFirst.mockReset().mockResolvedValue({ id: "p1" });
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("interrupteur", () => {
    it.each(["", "false", "TRUE", "1"])("valeur %j : éteint (seule `true` exacte active)", (v) => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", v);
      expect(isCommunityIsolationEnabled()).toBe(false);
    });

    it("absent : éteint", () => {
      vi.unstubAllEnvs();
      expect(isCommunityIsolationEnabled()).toBe(false);
    });
  });

  describe("getIsolationScope", () => {
    it("éteint : un membre de default garde le mode historique", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "");
      membershipFindMany.mockResolvedValue([m("c-def", "default")]);
      await expect(getIsolationScope("u1")).resolves.toBeNull();
      expect(membershipFindMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { userId: "u1", status: "ACTIVE", community: { status: "ACTIVE" } },
      }));
    });

    it("éteint : un membre de B seulement reçoit le scope B, jamais default", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "");
      membershipFindMany.mockResolvedValue([m("c-b", "serveur-b")]);
      await expect(getIsolationScope("u1")).resolves.toEqual({ communityIds: ["c-b"], includesDefault: false });
      expect(membershipFindMany).toHaveBeenCalledOnce();
    });

    it("éteint : sans membership, portée vide", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "");
      await expect(getIsolationScope("u1")).resolves.toEqual({ communityIds: [], includesDefault: false });
    });

    it("n'utilise que les Memberships ACTIVE de communautés ACTIVE de CET utilisateur", async () => {
      await getIsolationScope("u1");
      expect(membershipFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "u1", status: "ACTIVE", community: { status: "ACTIVE" } },
        })
      );
    });

    it("liste les communautés et indique si `default` en fait partie", async () => {
      membershipFindMany.mockResolvedValue([m("c-b", "serveur-b"), m("c-def", "default")]);
      await expect(getIsolationScope("u1")).resolves.toEqual({
        communityIds: ["c-b", "c-def"],
        includesDefault: true,
      });
    });

    it("sans la communauté par défaut : includesDefault=false", async () => {
      membershipFindMany.mockResolvedValue([m("c-b", "serveur-b")]);
      await expect(getIsolationScope("u1")).resolves.toEqual({ communityIds: ["c-b"], includesDefault: false });
    });

    it("aucune communauté : portée vide (et non null : l'isolation reste active)", async () => {
      await expect(getIsolationScope("u1")).resolves.toEqual({ communityIds: [], includesDefault: false });
    });
  });

  describe("communityIdFilter (lignes Session / Tournament)", () => {
    it("pas de portée (isolation éteinte) : aucun filtre", () => {
      expect(communityIdFilter(null)).toEqual({});
    });

    it("communautés non `default` : uniquement leurs lignes, JAMAIS les lignes `null`", () => {
      expect(communityIdFilter({ communityIds: ["c-b"], includesDefault: false })).toEqual({
        OR: [{ communityId: { in: ["c-b"] } }],
      });
    });

    it("avec `default` : ajoute les lignes historiques `communityId = null`", () => {
      expect(communityIdFilter({ communityIds: ["c-def", "c-b"], includesDefault: true })).toEqual({
        OR: [{ communityId: { in: ["c-def", "c-b"] } }, { communityId: null }],
      });
    });

    it("aucune communauté : un OR NON VIDE qui ne correspond à rien (un OR vide ou un AND vide laisserait tout passer ou rien selon l'opérateur)", () => {
      const filter = communityIdFilter({ communityIds: [], includesDefault: false });
      expect(filter).toEqual({ OR: [{ communityId: { in: [] } }] });
    });
  });

  describe("memberUserWhere (potes visibles)", () => {
    it("éteint : aucun filtre", () => {
      expect(memberUserWhere(null)).toEqual({});
    });

    it("membres ACTIVE d'au moins une des communautés de l'utilisateur", () => {
      expect(memberUserWhere({ communityIds: ["c-b", "c-def"], includesDefault: true })).toEqual({
        memberships: { some: { communityId: { in: ["c-b", "c-def"] }, status: "ACTIVE" } },
      });
    });

    it("aucune communauté : aucun pote (in: [])", () => {
      expect(memberUserWhere({ communityIds: [], includesDefault: false })).toEqual({
        memberships: { some: { communityId: { in: [] }, status: "ACTIVE" } },
      });
    });
  });

  describe("communityMemberUserWhere (membres d'UNE communauté, pour les invités)", () => {
    it("éteint : vérifie toujours les membres ACTIVE de la communauté cible", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "");
      await expect(communityMemberUserWhere("c-b")).resolves.toEqual({
        memberships: { some: { communityId: "c-b", status: "ACTIVE", community: { status: "ACTIVE" } } },
      });
      expect(communityFindUnique).not.toHaveBeenCalled();
    });

    it("communauté donnée : ses membres ACTIVE", async () => {
      await expect(communityMemberUserWhere("c-b")).resolves.toEqual({
        memberships: { some: { communityId: "c-b", status: "ACTIVE", community: { status: "ACTIVE" } } },
      });
    });

    it("null (= `default`) : résout l'id de la communauté par défaut", async () => {
      await expect(communityMemberUserWhere(null)).resolves.toEqual({
        memberships: { some: { communityId: "c-def", status: "ACTIVE", community: { status: "ACTIVE" } } },
      });
      expect(communityFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { slug: "default" } }));
    });

    it("null et communauté par défaut absente : personne (fail-closed)", async () => {
      communityFindUnique.mockResolvedValue(null);
      await expect(communityMemberUserWhere(null)).resolves.toEqual({ id: { in: [] } });
    });
  });

  describe("canViewPote (fiche d'un pote, à vérifier dans CHAQUE page /potes/[id]/*)", () => {
    it("éteint sans aucune adhésion : invisible", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "");
      userFindFirst.mockResolvedValue(null);
      await expect(canViewPote("u1", "p1")).resolves.toBe(false);
      expect(userFindFirst).toHaveBeenCalledWith({
        where: { id: "p1", memberships: { some: { communityId: { in: [] }, status: "ACTIVE" } } },
        select: { id: true },
      });
    });

    it("éteint : un membre B voit seulement les potes de B", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "");
      membershipFindMany.mockResolvedValue([m("c-b", "serveur-b")]);
      await expect(canViewPote("u1", "p1")).resolves.toBe(true);
      expect(userFindFirst).toHaveBeenCalledWith({
        where: { id: "p1", memberships: { some: { communityId: { in: ["c-b"] }, status: "ACTIVE" } } },
        select: { id: true },
      });
    });

    it("éteint avec adhésion default : comportement historique visible", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "");
      membershipFindMany.mockResolvedValue([m("c-def", "default")]);
      membershipFindFirst.mockResolvedValue({ communityId: "c-def" });
      await expect(canViewPote("u1", "p1")).resolves.toBe(true);
      expect(userFindFirst).not.toHaveBeenCalled();
    });

    it("soi-même : toujours visible", async () => {
      await expect(canViewPote("u1", "u1")).resolves.toBe(true);
      expect(userFindFirst).not.toHaveBeenCalled();
    });

    it("pote membre d'une de MES communautés : visible", async () => {
      membershipFindMany.mockResolvedValue([m("c-b", "serveur-b")]);
      await expect(canViewPote("u1", "p1")).resolves.toBe(true);
      expect(userFindFirst).toHaveBeenCalledWith({
        where: { id: "p1", memberships: { some: { communityId: { in: ["c-b"] }, status: "ACTIVE" } } },
        select: { id: true },
      });
    });

    it("pote d'une autre communauté : invisible (indistinct d'un pote inexistant)", async () => {
      membershipFindMany.mockResolvedValue([m("c-b", "serveur-b")]);
      userFindFirst.mockResolvedValue(null);
      await expect(canViewPote("u1", "intrus")).resolves.toBe(false);
    });

    it("sans aucune communauté : invisible", async () => {
      userFindFirst.mockResolvedValue(null);
      await expect(canViewPote("u1", "p1")).resolves.toBe(false);
      expect(userFindFirst).toHaveBeenCalledWith({
        where: { id: "p1", memberships: { some: { communityId: { in: [] }, status: "ACTIVE" } } },
        select: { id: true },
      });
    });
  });

  describe("creationMemberUserWhere (potes proposables à la création)", () => {
    it("éteint : membre default, filtre sur les membres de default", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "");
      membershipFindMany.mockResolvedValue([m("c-def", "default")]);
      membershipFindFirst.mockResolvedValue({ communityId: "c-def" });
      await expect(creationMemberUserWhere("u1")).resolves.toEqual({
        memberships: { some: { communityId: "c-def", status: "ACTIVE" } },
      });
    });

    it("éteint : membre B seulement, les propositions restent dans le roster B", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "");
      membershipFindMany.mockResolvedValue([m("c-b", "serveur-b")]);
      await expect(creationMemberUserWhere("u1")).resolves.toEqual({
        memberships: { some: { communityId: "c-b", status: "ACTIVE" } },
      });
    });

    it("éteint : aucun membre ne reçoit le roster default", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "");
      await expect(creationMemberUserWhere("u1")).resolves.toEqual({ id: { in: [] } });
    });

    it("les membres de la communauté active du créateur", async () => {
      membershipFindMany.mockResolvedValue([m("c-b", "serveur-b")]);
      await expect(creationMemberUserWhere("u1")).resolves.toEqual({
        memberships: { some: { communityId: "c-b", status: "ACTIVE" } },
      });
    });

    it("créateur sans communauté : personne (jamais le roster de `default`)", async () => {
      await expect(creationMemberUserWhere("u1")).resolves.toEqual({ id: { in: [] } });
    });
  });

  describe("resolveActiveCommunityId", () => {
    it("aucune : null", async () => {
      await expect(resolveActiveCommunityId("u1")).resolves.toBeNull();
    });

    it("la communauté par défaut si elle en fait partie, sinon la plus ancienne", async () => {
      membershipFindMany.mockResolvedValue([m("c-b", "serveur-b"), m("c-def", "default")]);
      await expect(resolveActiveCommunityId("u1")).resolves.toBe("c-def");
      membershipFindMany.mockResolvedValue([m("c-b", "serveur-b"), m("c-c", "serveur-c")]);
      await expect(resolveActiveCommunityId("u1")).resolves.toBe("c-b");
    });

    it("isolation éteinte : un membre B-only reste sur B", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "");
      membershipFindMany.mockResolvedValue([m("c-b", "serveur-b")]);
      await expect(resolveActiveCommunityId("u1")).resolves.toBe("c-b");
    });

    it("trie du plus ancien au plus récent", async () => {
      await resolveActiveCommunityId("u1");
      expect(membershipFindMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { joinedAt: "asc" } }));
    });
  });

  describe("isMemberOfCommunity", () => {
    it("éteint : vérifie encore l'appartenance ACTIVE à la communauté demandée", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "");
      membershipFindFirst.mockResolvedValue(null);
      await expect(isMemberOfCommunity("u1", "c-def")).resolves.toBe(false);
      expect(membershipFindFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { userId: "u1", communityId: "c-def", status: "ACTIVE", community: { status: "ACTIVE" } },
      }));
    });
  });
});
