import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 5 (crons longs) — deux passages enchaînés = mêmes lignes qu'un seul
 * (seed-reconcile et import Steam), budget épuisé → arrêt propre. Postgres
 * isolé (`TEST_DATABASE_URL`), `fetch` simulé (aucun réseau, aucun Discord).
 * Suite SKIPPÉE si `TEST_DATABASE_URL` est absente.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn("[cron-longs.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE.");
}

describe.skipIf(!TEST_DATABASE_URL)("crons longs (Postgres isolé)", () => {
  let db: import("@prisma/client").PrismaClient;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as import("@prisma/client").PrismaClient;
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  beforeEach(async () => {
    await db.$executeRawUnsafe(
      `TRUNCATE "User", "Game", "Badge", "Tag", "MessageTemplate", "GroupAchievement", "Season", "SuperlativeCategory", "XpEvent", "Community" CASCADE`
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function snapshot() {
    const users = await db.user.findMany({ orderBy: { discordId: "asc" }, select: { discordId: true, xpTotal: true } });
    return {
      users,
      xpEvents: await db.xpEvent.count(),
      userBadges: await db.userBadge.count(),
      badges: await db.badge.count(),
      tags: await db.tag.count(),
      messageTemplates: await db.messageTemplate.count(),
      groupAchievements: await db.groupAchievement.count(),
      seasons: await db.season.count(),
      superlativeCategories: await db.superlativeCategory.count(),
      gameStatTypes: await db.gameStatType.count(),
      userGames: await db.userGame.count(),
      games: await db.game.count(),
      communities: await db.community.count(),
      memberships: await db.membership.count(),
    };
  }

  describe("runSeedReconciliation", () => {
    async function seedData() {
      const alice = await db.user.create({
        data: { discordId: "alice", discordName: "alice", steamId64: "76561198000000001" },
      });
      await db.user.create({ data: { discordId: "bob", discordName: "bob", steamId64: "76561198000000002" } });
      const game = await db.game.create({ data: { name: "Jeu A", source: "MANUAL", addedById: alice.id } });
      await db.userGame.create({ data: { userId: alice.id, gameId: game.id, owned: true, source: "PERSONAL" } });
    }

    it("deux passages enchaînés donnent exactement les mêmes lignes qu'un seul", async () => {
      const { runSeedReconciliation } = await import("./seed-reconciliation");
      await seedData();

      const first = await runSeedReconciliation();
      expect(first.stopReason).toBe("completed");
      expect(Object.values(first.results).every((r) => r === "ok")).toBe(true);
      const afterOne = await snapshot();
      // Garde-fou : le premier passage a réellement écrit quelque chose.
      expect(afterOne.xpEvents).toBeGreaterThan(0);
      expect(afterOne.badges).toBeGreaterThan(0);
      expect(afterOne.tags).toBeGreaterThan(0);
      expect(afterOne.seasons).toBe(1);
      // Multi-communautés (PR A) : communauté par défaut + un Membership par utilisateur.
      expect(afterOne.communities).toBe(1);
      expect(afterOne.memberships).toBe(2);

      const second = await runSeedReconciliation();
      expect(second.stopReason).toBe("completed");
      expect(await snapshot()).toEqual(afterOne);
    });

    it("budget épuisé : tâches restantes 'skipped', stopReason time_budget, rien n'est cassé", async () => {
      const { runSeedReconciliation } = await import("./seed-reconciliation");
      await seedData();
      const summary = await runSeedReconciliation({ budgetMs: -1 });
      expect(summary.stopReason).toBe("time_budget");
      expect(Object.values(summary.results).every((r) => r === "skipped")).toBe(true);
      expect((await snapshot()).xpEvents).toBe(0);
    });
  });

  describe("importSteamLibrary", () => {
    function stubSteam(gameCount: number) {
      const games = Array.from({ length: gameCount }, (_, i) => ({
        appid: 1000 + i,
        name: `Jeu ${i}`,
        rtime_last_played: 1_700_000_000 + i,
      }));
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.startsWith("https://api.steampowered.com/IPlayerService/GetOwnedGames/")) {
            return new Response(JSON.stringify({ response: { game_count: gameCount, games } }), { status: 200 });
          }
          throw new Error(`Appel réseau inattendu : ${url}`);
        })
      );
      vi.stubEnv("STEAM_API_KEY", "test-key");
    }

    it("deux imports enchaînés = mêmes Game/UserGame qu'un seul ; steamLastSyncAt posé", async () => {
      const { importSteamLibrary } = await import("./steam");
      stubSteam(5);
      const user = await db.user.create({
        data: { discordId: "carol", discordName: "carol", steamId64: "76561198000000003" },
      });
      const deadline = { deadlineMs: Date.now() + 60_000 };

      const r1 = await importSteamLibrary(user.id, "76561198000000003", deadline);
      expect(r1).toEqual({ status: "imported", count: 5, newCount: 5 });
      const afterOne = await snapshot();
      expect(afterOne.games).toBe(5);
      expect(afterOne.userGames).toBe(5);

      const r2 = await importSteamLibrary(user.id, "76561198000000003", deadline);
      expect(r2).toEqual({ status: "imported", count: 5, newCount: 0 });
      expect(await snapshot()).toEqual(afterOne);
      expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).steamLastSyncAt).not.toBeNull();
    });

    it("deadline dépassé → partial, steamLastSyncAt NON posé, et un passage suivant complète sans doublon", async () => {
      const { importSteamLibrary } = await import("./steam");
      stubSteam(4);
      const user = await db.user.create({
        data: { discordId: "dave", discordName: "dave", steamId64: "76561198000000004" },
      });

      const partial = await importSteamLibrary(user.id, "76561198000000004", { deadlineMs: Date.now() - 1 });
      expect(partial).toEqual({ status: "partial", processed: 0, total: 4 });
      expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).steamLastSyncAt).toBeNull();
      expect((await snapshot()).games).toBe(0);

      const full = await importSteamLibrary(user.id, "76561198000000004", { deadlineMs: Date.now() + 60_000 });
      expect(full.status).toBe("imported");
      const s = await snapshot();
      expect(s.games).toBe(4);
      expect(s.userGames).toBe(4);
    });
  });
});
