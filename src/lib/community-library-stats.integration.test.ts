import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Multi-communautés, PR9 — wishlist, trophées et compteurs de groupe PAR
 * communauté (clés composites `communityId`), sur un Postgres réel. Trois
 * communautés (default, c1, c2) ; isolation allumée sauf mention contraire.
 * Nécessite `TEST_DATABASE_URL` — suite SKIPPÉE si absente.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const { currentUserMock, announceMock } = vi.hoisted(() => ({
  currentUserMock: vi.fn(),
  announceMock: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: currentUserMock }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true, RATE_LIMIT_ERROR_KEY: "rate_limited" }));
vi.mock("@/lib/discord-group-achievement", () => ({ announceGroupAchievementUnlocked: announceMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn(
    "[community-library-stats.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE. " +
      "L'isolation de la wishlist, des trophées et des compteurs N'EST PAS validée par cette exécution."
  );
}

describe.skipIf(!TEST_DATABASE_URL)("wishlist, trophées et compteurs par communauté (Postgres isolée)", () => {
  let db: import("@prisma/client").PrismaClient;
  let sessionsLib: typeof import("./sessions");
  let homeLib: typeof import("./home");
  let achievements: typeof import("./group-achievements");
  let seed: typeof import("./seed-group-achievements");
  let wishlist: typeof import("./wishlist");
  let wishlistActions: typeof import("@/app/wishlist/actions");
  let defaultCommunity: typeof import("./default-community");

  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    sessionsLib = await import("./sessions");
    homeLib = await import("./home");
    achievements = await import("./group-achievements");
    seed = await import("./seed-group-achievements");
    wishlist = await import("./wishlist");
    wishlistActions = await import("@/app/wishlist/actions");
    defaultCommunity = await import("./default-community");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    announceMock.mockResolvedValue({ ok: true });
    await db.$executeRawUnsafe(
      `TRUNCATE "GameWishlistVote", "GameWishlist", "GroupAchievement", "GroupActiveWeek", "GroupGameStat", "GroupSessionStats", "Session", "Game", "Membership", "Community", "User" CASCADE`
    );
    defaultCommunity.resetDefaultCommunityIdCache();
    const community = async (slug: string) =>
      (await db.community.create({ data: { slug, name: slug, status: "ACTIVE" } })).id;
    ids.def = await community("default");
    ids.c1 = await community("c1");
    ids.c2 = await community("c2");
    const user = async (name: string) => (await db.user.create({ data: { discordId: name, discordName: name } })).id;
    ids.alice = await user("alice"); // c1
    ids.bob = await user("bob"); // c2
    ids.carol = await user("carol"); // c1 + c2 (active : c1, la plus ancienne)
    ids.zed = await user("zed"); // aucune
    for (const [i, [u, c]] of [["alice", "c1"], ["bob", "c2"], ["carol", "c1"], ["carol", "c2"]].entries()) {
      await db.membership.create({
        data: { userId: ids[u], communityId: ids[c], status: "ACTIVE", joinedAt: new Date(Date.UTC(2026, 0, i + 1)) },
      });
    }
    ids.game = (await db.game.create({ data: { name: "Mario Kart", source: "MANUAL", minPlayers: 2, addedById: ids.alice } })).id;
  });

  const asUser = (name: string) => currentUserMock.mockResolvedValue({ id: ids[name] });
  const closedSession = async (communityId: string | null, date = "2026-09-10T20:00:00.000Z") => {
    const session = await db.session.create({
      data: { date: new Date(date), status: "SCHEDULED", decidedGameId: ids.game, createdById: ids.alice, communityId },
    });
    await sessionsLib.markSessionDone(session.id);
    return session;
  };

  describe("compteurs de groupe", () => {
    it("chaque soirée alimente les compteurs de SA communauté ; `null` va à la communauté par défaut", async () => {
      await closedSession(ids.c1);
      await closedSession(ids.c1, "2026-09-11T20:00:00.000Z");
      await closedSession(ids.c2);
      await closedSession(null);

      const rows = await db.groupSessionStats.findMany();
      const byCommunity = Object.fromEntries(rows.map((r) => [r.communityId, r.totalSessionsPlayed]));
      expect(byCommunity).toEqual({ [ids.c1]: 2, [ids.c2]: 1, [ids.def]: 1 });
      const plays = Object.fromEntries((await db.groupGameStat.findMany()).map((r) => [r.communityId, r.playCount]));
      expect(plays).toEqual({ [ids.c1]: 2, [ids.c2]: 1, [ids.def]: 1 });
      expect(await db.groupActiveWeek.count()).toBe(3); // même semaine, 3 communautés
    });

    it("accueil : seulement la communauté active ; éteint, la somme (comportement historique)", async () => {
      await closedSession(ids.c1);
      await closedSession(ids.c1, "2026-09-11T20:00:00.000Z");
      await closedSession(ids.c2);
      expect((await homeLib.getGroupStats(ids.alice)).totalSessionsPlayed).toBe(2);
      expect((await homeLib.getGroupStats(ids.bob)).totalSessionsPlayed).toBe(1);
      expect((await homeLib.getGroupStats(ids.carol)).totalSessionsPlayed).toBe(2); // active : c1
      expect((await homeLib.getGroupStats(ids.zed)).totalSessionsPlayed).toBe(0);
      expect((await homeLib.getGroupStats(ids.alice)).mostPlayedGame).toMatchObject({ name: "Mario Kart", count: 2 });
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "");
      expect((await homeLib.getGroupStats(ids.zed)).totalSessionsPlayed).toBe(0);
    });
  });

  describe("trophées de groupe", () => {
    it("un trophée se débloque dans la communauté qui l'a mérité, pas dans les autres", async () => {
      await closedSession(ids.c1);
      const state = async (communityId: string) =>
        (await db.groupAchievement.findMany({ where: { communityId, unlockedAt: { not: null } }, select: { key: true } })).map((a) => a.key);
      expect(await state(ids.c1)).toEqual(["premiere-soiree"]);
      expect(await state(ids.c2)).toEqual([]);
      expect(await db.groupAchievement.count({ where: { communityId: ids.c1 } })).toBe(10);
    });

    it("annonce de trophée : transmet la communauté source au résolveur de destination", async () => {
      await closedSession(ids.c1);
      expect(announceMock).toHaveBeenCalledWith(expect.anything(), ids.c1);
      await closedSession(null);
      expect(announceMock).toHaveBeenCalledTimes(2);
      expect(announceMock).toHaveBeenLastCalledWith(expect.anything(), await defaultCommunity.getDefaultCommunityId());
    });

    it("isolation éteinte : annonce comme avant, même pour une soirée rattachée à une communauté", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "");
      await closedSession(ids.c1);
      expect(announceMock).toHaveBeenCalledTimes(1);
    });

    it("liste de l'accueil : celle de la communauté active, créée à la première lecture", async () => {
      expect(await db.groupAchievement.count()).toBe(0);
      const list = await achievements.listGroupAchievements(ids.alice);
      expect(list).toHaveLength(10);
      expect(new Set(list.map((a) => a.communityId))).toEqual(new Set([ids.c1]));
      expect(await achievements.listGroupAchievements(ids.zed)).toEqual([]);
    });

    it("isolation OFF : les trophées de l'accueil restent dans la communauté active", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
      const achievement = (communityId: string, key: string) => ({
        communityId, key, name: key, description: key, icon: "🏆",
      });
      await db.groupAchievement.createMany({ data: [
        achievement(ids.c1, "trophee-a"), achievement(ids.c2, "trophee-b"),
      ] });

      const list = await achievements.listGroupAchievements(ids.alice);

      expect(list.map(row => row.key)).toEqual(["trophee-a"]);
      expect(list.every(row => row.communityId === ids.c1)).toBe(true);
    });

    it("isolation OFF : un membre B-only déclenche le seed dans sa communauté active", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
      expect(await db.groupAchievement.count()).toBe(0);

      const list = await achievements.listGroupAchievements(ids.bob);

      expect(list).toHaveLength(10);
      expect(list.every(row => row.communityId === ids.c2)).toBe(true);
      expect(await db.groupAchievement.count({ where: { communityId: ids.c1 } })).toBe(0);
      expect(await db.groupAchievement.count({ where: { communityId: ids.c2 } })).toBe(10);
    });

    it("seed : la communauté par défaut et chaque communauté ACTIVE, idempotent", async () => {
      await seed.seedGroupAchievements();
      await seed.seedGroupAchievements();
      expect(await db.groupAchievement.count()).toBe(30);
      await db.community.create({ data: { slug: "attente", name: "attente", status: "PENDING" } });
      await seed.seedGroupAchievements();
      expect(await db.groupAchievement.count()).toBe(30);
    });
  });

  describe("wishlist", () => {
    const propose = async (userName: string) => {
      asUser(userName);
      const form = new FormData();
      form.set("igdbId", "1234");
      form.set("name", "Hades");
      form.set("coverUrl", "");
      form.set("reason", "");
      await expect(wishlistActions.proposeWishlistGameAction(form)).rejects.toThrow(/REDIRECT:\/wishlist$/);
    };

    it("le même jeu peut être proposé dans deux communautés ; chaque liste reste séparée", async () => {
      await propose("alice");
      await propose("bob");
      expect(await db.gameWishlist.count()).toBe(2);
      expect((await wishlist.getWishlist(ids.alice)).map((e) => e.gameName)).toEqual(["Hades"]);
      const rows = await db.gameWishlist.findMany({ select: { communityId: true } });
      expect(rows.map((r) => r.communityId).sort()).toEqual([ids.c1, ids.c2].sort());
      // carol est dans c1 et c2 : seule la wishlist de sa communauté active (c1) s'affiche.
      expect(await wishlist.getWishlist(ids.carol)).toHaveLength(1);
      expect(await wishlist.getWishlist(ids.zed)).toEqual([]);
    });

    it("doublon dans la même communauté : toujours une seule ligne", async () => {
      await propose("alice");
      await propose("carol"); // active : c1
      expect(await db.gameWishlist.count()).toBe(1);
    });

    it("sans communauté : proposition refusée", async () => {
      asUser("zed");
      const form = new FormData();
      form.set("igdbId", "1234");
      form.set("name", "Hades");
      form.set("coverUrl", "");
      form.set("reason", "");
      await expect(wishlistActions.proposeWishlistGameAction(form)).rejects.toThrow(/REDIRECT:\/wishlist\?error=/);
      expect(await db.gameWishlist.count()).toBe(0);
    });

    it("vote : sur une entrée d'une autre communauté, rien n'est enregistré", async () => {
      await propose("bob");
      const entry = await db.gameWishlist.findFirstOrThrow();
      asUser("alice");
      const form = new FormData();
      form.set("wishlistId", entry.id);
      form.set("interested", "true");
      await wishlistActions.voteWishlistAction(form);
      expect(await db.gameWishlistVote.count()).toBe(0);
      asUser("bob");
      await wishlistActions.voteWishlistAction(form);
      expect(await db.gameWishlistVote.count()).toBe(1);
    });

    it("achat détecté : marque les entrées de TOUTES les communautés de l'utilisateur", async () => {
      await propose("alice");
      await propose("bob");
      await db.userGame.create({ data: { userId: ids.carol, gameId: (await db.gameWishlist.findFirstOrThrow()).gameId, owned: true } });
      await wishlist.checkWishlistPurchases(ids.carol);
      expect(await db.gameWishlist.count({ where: { purchasedById: ids.carol } })).toBe(2);
    });

    it("isolation éteinte : un membre default peut proposer, sans fallback implicite pour les autres", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "");
      await db.membership.create({ data: { userId: ids.alice, communityId: ids.def, status: "ACTIVE" } });
      await propose("alice");
      expect((await db.gameWishlist.findFirstOrThrow()).communityId).toBe(ids.def);
      expect((await wishlist.getWishlist(ids.alice)).map((e) => e.gameName)).toEqual(["Hades"]);
    });
  });
});
