import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Multi-communautés, PR5 — sélecteur de serveur (`community-picker.ts`).
 * Règle centrale : `User.activeCommunityId` n'est qu'une PRÉFÉRENCE d'affichage,
 * revalidée contre les Membership ACTIVE (communauté ACTIVE) à chaque usage ;
 * ce n'est JAMAIS une autorisation (l'accès reste décidé par
 * `community-access.ts`). Postgres réel requis.
 *
 * Nécessite `TEST_DATABASE_URL` — suite SKIPPÉE si absente.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const { currentUserMock, NOT_FOUND } = vi.hoisted(() => ({
  currentUserMock: vi.fn(),
  NOT_FOUND: "NEXT_HTTP_ERROR_FALLBACK;404",
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser: currentUserMock }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error(NOT_FOUND);
  },
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) {
    return { prisma: {} as unknown };
  }
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn(
    "[community-picker.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE. " +
      "Le sélecteur de serveur N'EST PAS validé par cette exécution."
  );
}

type CStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "LEFT" | "ARCHIVED";
type MStatus = "ACTIVE" | "LEFT" | "REMOVED";

describe.skipIf(!TEST_DATABASE_URL)("community-picker (Postgres isolée)", () => {
  let db: import("@prisma/client").PrismaClient;
  let picker: typeof import("./community-picker");
  let isolation: typeof import("./community-isolation");
  let access: typeof import("./community-access");

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    picker = await import("./community-picker");
    isolation = await import("./community-isolation");
    access = await import("./community-access");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    await db.$executeRawUnsafe(`TRUNCATE "Membership", "CommunityChannelConfig", "Community", "User" CASCADE`);
  });

  let n = 0;
  async function newUser() {
    n += 1;
    return db.user.create({ data: { discordId: `u${n}`, discordName: `u${n}` } });
  }
  async function newCommunity(opts: { status?: CStatus; slug?: string } = {}) {
    n += 1;
    return db.community.create({
      data: { slug: opts.slug ?? `c${n}`, name: `Serveur ${n}`, status: opts.status ?? "ACTIVE" },
    });
  }
  async function join(userId: string, communityId: string, status: MStatus = "ACTIVE", joinedAt?: Date) {
    return db.membership.create({ data: { userId, communityId, status, ...(joinedAt ? { joinedAt } : {}) } });
  }
  async function stored(userId: string) {
    const row = await db.$queryRawUnsafe<Array<{ activeCommunityId: string | null }>>(
      `SELECT "activeCommunityId" FROM "User" WHERE id = $1`,
      userId
    );
    return row[0].activeCommunityId;
  }
  async function setStored(userId: string, communityId: string | null) {
    await db.$executeRawUnsafe(`UPDATE "User" SET "activeCommunityId" = $1 WHERE id = $2`, communityId, userId);
  }

  describe("drapeau éteint", () => {
    it("état `disabled`, aucune lecture, aucune redirection", async () => {
      vi.stubEnv("COMMUNITY_PICKER_ENABLED", "");
      const user = await newUser();
      expect(await picker.getActiveCommunityState(user.id)).toEqual({ kind: "disabled" });
      await expect(picker.requireCommunityChosen(user.id, "/sessions")).resolves.toBeUndefined();
    });

    it("le choix enregistré est ignoré par resolveActiveCommunityId (comportement historique)", async () => {
      vi.stubEnv("COMMUNITY_PICKER_ENABLED", "");
      const user = await newUser();
      const def = await newCommunity({ slug: "default" });
      const other = await newCommunity();
      await join(user.id, other.id, "ACTIVE", new Date("2026-01-01"));
      await join(user.id, def.id, "ACTIVE", new Date("2026-02-01"));
      await setStored(user.id, other.id);
      // Règle provisoire PR4 : la communauté par défaut d'abord.
      expect(await isolation.resolveActiveCommunityId(user.id)).toBe(def.id);
    });
  });

  describe("état", () => {
    it("0 serveur → `none`", async () => {
      const user = await newUser();
      expect(await picker.getActiveCommunityState(user.id)).toEqual({ kind: "none" });
    });

    it("1 serveur → `single` (sans rien enregistrer)", async () => {
      const user = await newUser();
      const c = await newCommunity();
      await join(user.id, c.id);
      expect(await picker.getActiveCommunityState(user.id)).toEqual({ kind: "single", communityId: c.id });
      expect(await stored(user.id)).toBeNull();
    });

    it("plusieurs serveurs sans choix → `needs-choice`", async () => {
      const user = await newUser();
      const a = await newCommunity();
      const b = await newCommunity();
      await join(user.id, a.id);
      await join(user.id, b.id);
      const state = await picker.getActiveCommunityState(user.id);
      expect(state.kind).toBe("needs-choice");
    });

    it("plusieurs serveurs avec un choix valide → `chosen`", async () => {
      const user = await newUser();
      const a = await newCommunity();
      const b = await newCommunity();
      await join(user.id, a.id);
      await join(user.id, b.id);
      await setStored(user.id, b.id);
      expect(await picker.getActiveCommunityState(user.id)).toEqual({ kind: "chosen", communityId: b.id });
    });

    it("les serveurs non ACTIFS (membre parti, retiré, communauté suspendue) ne comptent pas", async () => {
      const user = await newUser();
      const ok = await newCommunity();
      const left = await newCommunity();
      const removed = await newCommunity();
      const suspended = await newCommunity({ status: "SUSPENDED" });
      const pending = await newCommunity({ status: "PENDING" });
      await join(user.id, ok.id);
      await join(user.id, left.id, "LEFT");
      await join(user.id, removed.id, "REMOVED");
      await join(user.id, suspended.id);
      await join(user.id, pending.id);
      expect(await picker.getActiveCommunityState(user.id)).toEqual({ kind: "single", communityId: ok.id });
    });
  });

  describe("revalidation du choix (jamais une autorisation)", () => {
    it.each([
      ["membre parti", async (userId: string, communityId: string) => {
        await db.membership.update({ where: { communityId_userId: { communityId, userId } }, data: { status: "LEFT" } });
      }],
      ["membre retiré", async (userId: string, communityId: string) => {
        await db.membership.update({ where: { communityId_userId: { communityId, userId } }, data: { status: "REMOVED" } });
      }],
      ["communauté suspendue", async (_u: string, communityId: string) => {
        await db.community.update({ where: { id: communityId }, data: { status: "SUSPENDED" } });
      }],
      ["communauté quittée par le bot", async (_u: string, communityId: string) => {
        await db.community.update({ where: { id: communityId }, data: { status: "LEFT" } });
      }],
    ])("choix périmé (%s) → ignoré à l'usage suivant", async (_label, invalidate) => {
      const user = await newUser();
      const a = await newCommunity();
      const b = await newCommunity();
      const c = await newCommunity();
      await join(user.id, a.id);
      await join(user.id, b.id);
      await join(user.id, c.id);
      await setStored(user.id, b.id);
      expect((await picker.getActiveCommunityState(user.id)).kind).toBe("chosen");

      await invalidate(user.id, b.id);
      const state = await picker.getActiveCommunityState(user.id);
      expect(state.kind).toBe("needs-choice");
      // La résolution ne renvoie jamais le serveur périmé.
      expect(await isolation.resolveActiveCommunityId(user.id)).not.toBe(b.id);
    });

    it("choix pointant sur un serveur dont l'utilisateur n'a jamais été membre → ignoré", async () => {
      const user = await newUser();
      const mine = await newCommunity();
      const foreign = await newCommunity();
      await join(user.id, mine.id);
      await setStored(user.id, foreign.id);
      expect(await picker.getActiveCommunityState(user.id)).toEqual({ kind: "single", communityId: mine.id });
      expect(await isolation.resolveActiveCommunityId(user.id)).toBe(mine.id);
    });

    it("choix inexistant (id supprimé) → ignoré, sans erreur", async () => {
      const user = await newUser();
      const a = await newCommunity();
      const b = await newCommunity();
      await join(user.id, a.id);
      await join(user.id, b.id);
      await setStored(user.id, "id-qui-n-existe-pas");
      expect((await picker.getActiveCommunityState(user.id)).kind).toBe("needs-choice");
    });

    it("le choix ne donne AUCUN accès : requireMembership reste 404 pour un serveur quitté", async () => {
      const user = await newUser();
      const gone = await newCommunity();
      await join(user.id, gone.id, "LEFT");
      await setStored(user.id, gone.id);
      currentUserMock.mockResolvedValue(user);
      await expect(access.requireMembership(gone.id)).rejects.toThrow(NOT_FOUND);
    });

    it("resolveActiveCommunityId suit le choix valide (au lieu de la communauté par défaut)", async () => {
      const user = await newUser();
      const def = await newCommunity({ slug: "default" });
      const other = await newCommunity();
      await join(user.id, def.id, "ACTIVE", new Date("2026-01-01"));
      await join(user.id, other.id, "ACTIVE", new Date("2026-02-01"));
      await setStored(user.id, other.id);
      expect(await isolation.resolveActiveCommunityId(user.id)).toBe(other.id);
    });

    it("sélecteur ON sans choix valide : aucun repli ; OFF garde default d'abord", async () => {
      const user = await newUser();
      const def = await newCommunity({ slug: "default" });
      const other = await newCommunity();
      await join(user.id, other.id, "ACTIVE", new Date("2026-01-01"));
      await join(user.id, def.id, "ACTIVE", new Date("2026-02-01"));
      expect(await isolation.resolveActiveCommunityId(user.id)).toBeNull();
      vi.stubEnv("COMMUNITY_PICKER_ENABLED", "false");
      expect(await isolation.resolveActiveCommunityId(user.id)).toBe(def.id);
    });
  });

  describe("setActiveCommunity", () => {
    it("enregistre le choix d'un serveur dont l'utilisateur est membre ACTIF", async () => {
      const user = await newUser();
      const a = await newCommunity();
      const b = await newCommunity();
      await join(user.id, a.id);
      await join(user.id, b.id);
      expect(await picker.setActiveCommunity(user.id, b.id)).toBe(true);
      expect(await stored(user.id)).toBe(b.id);
    });

    it.each([
      ["serveur inconnu", async () => "id-inconnu"],
      ["jamais membre", async () => (await newCommunity()).id],
      ["membre parti", async (userId: string) => {
        const c = await newCommunity();
        await join(userId, c.id, "LEFT");
        return c.id;
      }],
      ["membre retiré", async (userId: string) => {
        const c = await newCommunity();
        await join(userId, c.id, "REMOVED");
        return c.id;
      }],
      ["communauté suspendue", async (userId: string) => {
        const c = await newCommunity({ status: "SUSPENDED" });
        await join(userId, c.id);
        return c.id;
      }],
      ["communauté en attente d'activation", async (userId: string) => {
        const c = await newCommunity({ status: "PENDING" });
        await join(userId, c.id);
        return c.id;
      }],
    ])("refuse sans rien écrire : %s", async (_label, makeTarget) => {
      const user = await newUser();
      const mine = await newCommunity();
      await join(user.id, mine.id);
      await setStored(user.id, mine.id);
      const target = await makeTarget(user.id);
      expect(await picker.setActiveCommunity(user.id, target)).toBe(false);
      expect(await stored(user.id)).toBe(mine.id);
    });
  });

  describe("requireCommunityChosen (porte)", () => {
    it("0 serveur → redirige vers /serveurs", async () => {
      const user = await newUser();
      await expect(picker.requireCommunityChosen(user.id, "/sessions")).rejects.toThrow("REDIRECT:/serveurs");
    });

    it("1 serveur → laisse passer", async () => {
      const user = await newUser();
      const c = await newCommunity();
      await join(user.id, c.id);
      await expect(picker.requireCommunityChosen(user.id, "/sessions")).resolves.toBeUndefined();
    });

    it("plusieurs serveurs sans choix → /serveurs avec le chemin de retour encodé", async () => {
      const user = await newUser();
      await join(user.id, (await newCommunity()).id);
      await join(user.id, (await newCommunity()).id);
      await expect(picker.requireCommunityChosen(user.id, "/classement?periode=week")).rejects.toThrow(
        `REDIRECT:/serveurs?next=${encodeURIComponent("/classement?periode=week")}`
      );
    });

    it("plusieurs serveurs avec un choix valide → laisse passer", async () => {
      const user = await newUser();
      const a = await newCommunity();
      const b = await newCommunity();
      await join(user.id, a.id);
      await join(user.id, b.id);
      await setStored(user.id, a.id);
      await expect(picker.requireCommunityChosen(user.id, "/tournois")).resolves.toBeUndefined();
    });
  });

  describe("listPickableCommunities", () => {
    it("liste uniquement les serveurs ACTIFS de l'utilisateur, du plus ancien au plus récent", async () => {
      const user = await newUser();
      const other = await newUser();
      const second = await newCommunity();
      const first = await newCommunity();
      const left = await newCommunity();
      const foreign = await newCommunity();
      await join(user.id, second.id, "ACTIVE", new Date("2026-03-01"));
      await join(user.id, first.id, "ACTIVE", new Date("2026-01-01"));
      await join(user.id, left.id, "LEFT");
      await join(other.id, foreign.id);
      const list = await picker.listPickableCommunities(user.id);
      expect(list.map((c) => c.id)).toEqual([first.id, second.id]);
      expect(Object.keys(list[0]).sort()).toEqual(["id", "name", "slug"]);
    });
  });
});
