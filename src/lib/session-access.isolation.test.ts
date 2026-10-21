import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Isolation des soirées (PR4) : `accessibleSessionWhere` / `getSessionAccessRole`
 * ajoutent le filtre de communauté quand `COMMUNITY_ISOLATION_ENABLED=true` ;
 * flags éteints, seuls les membres ACTIVE de `default` gardent le périmètre historique, et
 * `inviteToSession` refuse un invité qui n'est pas membre de la communauté de
 * la soirée.
 */

const mocks = vi.hoisted(() => ({
  sessionFindFirst: vi.fn(),
  sessionFindUnique: vi.fn(),
  inviteUpsert: vi.fn(),
  userFindFirst: vi.fn(),
  membershipFindMany: vi.fn(),
  communityFindUnique: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findFirst: mocks.sessionFindFirst, findUnique: mocks.sessionFindUnique },
    sessionInvite: { upsert: mocks.inviteUpsert },
    user: { findFirst: mocks.userFindFirst },
    membership: { findMany: mocks.membershipFindMany },
    community: { findUnique: mocks.communityFindUnique },
  },
}));

import {
  accessibleSessionWhere,
  getSessionAccessRole,
  inviteToSession,
} from "./session-access";

const LEGACY = (userId: string) => ({
  OR: [{ createdById: userId }, { invites: { some: { userId, status: "ACTIVE" } } }],
});
const membership = (communityId: string, slug: string) => ({ communityId, community: { slug } });

describe("session-access — isolation par communauté", () => {
  beforeEach(() => {
    mocks.sessionFindFirst.mockReset().mockResolvedValue({ createdById: "u1" });
    mocks.sessionFindUnique.mockReset().mockResolvedValue({ createdById: "owner", communityId: "c-b" });
    mocks.inviteUpsert.mockReset().mockResolvedValue({ id: "inv" });
    mocks.userFindFirst.mockReset().mockResolvedValue({ id: "guest" });
    mocks.membershipFindMany.mockReset().mockResolvedValue([membership("c-b", "serveur-b")]);
    mocks.communityFindUnique.mockReset().mockResolvedValue({ id: "c-def" });
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("accessibleSessionWhere", () => {
    it("sans portée : forme historique inchangée", () => {
      expect(accessibleSessionWhere("u1")).toEqual(LEGACY("u1"));
      expect(accessibleSessionWhere("u1", null)).toEqual(LEGACY("u1"));
    });

    it("avec portée : accès (créateur/invité) ET communauté, via AND non vide", () => {
      const where = accessibleSessionWhere("u1", { communityIds: ["c-b"], includesDefault: false });
      expect(where).toEqual({
        AND: [LEGACY("u1"), { OR: [{ communityId: { in: ["c-b"] } }] }],
      });
    });

    it("créateur ou invité d'une soirée d'une AUTRE communauté : exclu par le filtre de communauté", () => {
      const where = accessibleSessionWhere("u1", { communityIds: ["c-b"], includesDefault: false });
      // Le filtre de communauté est une condition AND : l'accès créateur/invité ne suffit jamais seul.
      expect(where.AND).toHaveLength(2);
      expect(where).not.toHaveProperty("OR");
    });

    it("aucune communauté : ne correspond à rien (in: [])", () => {
      const where = accessibleSessionWhere("u1", { communityIds: [], includesDefault: false });
      expect(where.AND).toContainEqual({ OR: [{ communityId: { in: [] } }] });
    });
  });

  describe("getSessionAccessRole", () => {
    it("isolation éteinte : un membre B seulement ne peut pas lire les soirées default", async () => {
      mocks.sessionFindFirst.mockResolvedValue(null);
      await getSessionAccessRole("u1", "s1");
      expect(mocks.sessionFindFirst).toHaveBeenCalledWith({
        where: { id: "s1", AND: [LEGACY("u1"), { OR: [{ communityId: { in: ["c-b"] } }] }] },
        select: { createdById: true },
      });
      expect(mocks.membershipFindMany).toHaveBeenCalledOnce();
    });

    it("isolation éteinte : un membre B-only conserve l'accès explicite aux soirées B", async () => {
      await expect(getSessionAccessRole("u1", "s-b")).resolves.toBe("creator");
      expect(mocks.sessionFindFirst).toHaveBeenCalledWith({
        where: { id: "s-b", AND: [LEGACY("u1"), { OR: [{ communityId: { in: ["c-b"] } }] }] },
        select: { createdById: true },
      });
    });

    it("isolation éteinte : un membre default garde l'accès historique", async () => {
      mocks.membershipFindMany.mockResolvedValue([membership("c-def", "default")]);
      await expect(getSessionAccessRole("u1", "s1")).resolves.toBe("creator");
      expect(mocks.sessionFindFirst).toHaveBeenCalledWith({
        where: {
          id: "s1",
          AND: [LEGACY("u1"), { OR: [{ communityId: { in: ["c-def"] } }, { communityId: null }] }],
        },
        select: { createdById: true },
      });
    });

    it("isolation allumée : la requête porte le filtre de communauté de l'utilisateur", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
      await getSessionAccessRole("u1", "s1");
      expect(mocks.sessionFindFirst).toHaveBeenCalledWith({
        where: { id: "s1", AND: [LEGACY("u1"), { OR: [{ communityId: { in: ["c-b"] } }] }] },
        select: { createdById: true },
      });
    });

    it("soirée d'une autre communauté (aucune ligne retournée) : aucun accès, indistinct d'une soirée inexistante", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
      mocks.sessionFindFirst.mockResolvedValue(null);
      await expect(getSessionAccessRole("u1", "s-autre")).resolves.toBeNull();
    });

    it("la communauté `default` donne accès aux lignes historiques (communityId null)", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
      mocks.membershipFindMany.mockResolvedValue([membership("c-def", "default")]);
      await getSessionAccessRole("u1", "s1");
      const where = mocks.sessionFindFirst.mock.calls[0][0].where;
      expect(where.AND[1]).toEqual({ OR: [{ communityId: { in: ["c-def"] } }, { communityId: null }] });
    });
  });

  describe("inviteToSession", () => {
    it("isolation éteinte : un invité doit toujours appartenir à la communauté de la soirée", async () => {
      await inviteToSession("s1", "owner", "guest");
      expect(mocks.userFindFirst).toHaveBeenCalledWith({
        where: { id: "guest", memberships: { some: { communityId: "c-b", status: "ACTIVE", community: { status: "ACTIVE" } } } },
        select: { id: true },
      });
      expect(mocks.inviteUpsert).toHaveBeenCalledOnce();
    });

    it("isolation éteinte : un invité sans adhésion ACTIVE n'obtient aucune invitation", async () => {
      mocks.userFindFirst.mockResolvedValue(null);
      await expect(inviteToSession("s1", "owner", "outsider")).resolves.toBeNull();
      expect(mocks.inviteUpsert).not.toHaveBeenCalled();
    });

    it("isolation allumée : l'invité doit être membre ACTIVE de la communauté de la SOIRÉE", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
      await inviteToSession("s1", "owner", "guest");
      expect(mocks.userFindFirst).toHaveBeenCalledWith({
        where: { id: "guest", memberships: { some: { communityId: "c-b", status: "ACTIVE", community: { status: "ACTIVE" } } } },
        select: { id: true },
      });
      expect(mocks.inviteUpsert).toHaveBeenCalledOnce();
    });

    it("invité d'une autre communauté : refusé, aucune invitation créée", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
      mocks.userFindFirst.mockResolvedValue(null);
      await expect(inviteToSession("s1", "owner", "intrus")).resolves.toBeNull();
      expect(mocks.inviteUpsert).not.toHaveBeenCalled();
    });

    it("soirée historique (communityId null) : l'invité doit être membre de la communauté `default`", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
      mocks.sessionFindUnique.mockResolvedValue({ createdById: "owner", communityId: null });
      await inviteToSession("s1", "owner", "guest");
      expect(mocks.userFindFirst).toHaveBeenCalledWith({
        where: { id: "guest", memberships: { some: { communityId: "c-def", status: "ACTIVE", community: { status: "ACTIVE" } } } },
        select: { id: true },
      });
    });

    it("créateur invité à sa propre soirée : toujours refusé avant toute autre lecture", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
      await expect(inviteToSession("s1", "owner", "owner")).resolves.toBeNull();
      expect(mocks.userFindFirst).not.toHaveBeenCalled();
    });
  });
});
