import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Wrapped mensuel : contenu réel du récap (jeu le plus joué, MVP, plus actif, pronostiqueur,
// série, XP) calculé sur Postgres local. Aucune notification Discord réelle (réseau interdit).
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const { postDiscord } = vi.hoisted(() => ({ postDiscord: vi.fn() }));
vi.mock("@/lib/discord", async () => ({
  ...(await vi.importActual<typeof import("./discord")>("./discord")),
  postToDiscord: postDiscord,
}));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

if (!TEST_DATABASE_URL) console.warn("[monthly-recap] TEST_DATABASE_URL absente : Wrapped mensuel NON validé (SKIPPÉ).");

describe.skipIf(!TEST_DATABASE_URL)("Wrapped mensuel : Postgres local", () => {
  let db: import("@prisma/client").PrismaClient;
  let recap: typeof import("./monthly-recap");
  const ids: Record<string, string> = {};
  const sept = (day: number) => new Date(Date.UTC(2026, 8, day, 20));
  const at = async (iso: string) => vi.spyOn(await import("./wallclock"), "wallClockNow").mockReturnValue(new Date(iso));

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    recap = await import("./monthly-recap");
  });
  afterAll(async () => { await db?.$disconnect(); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Réseau interdit en test"); }));
    postDiscord.mockResolvedValue({ ok: true });
    await db.$executeRawUnsafe(`TRUNCATE "MonthlyRecap", "Pronostic", "SuperlativeAward", "SuperlativeCategory", "XpEvent", "User", "Game", "Community" CASCADE`);
    (await import("./default-community")).resetDefaultCommunityIdCache();
    for (const name of ["default", "a", "b"]) ids[name] = (await db.community.create({ data: { slug: name, name, status: "ACTIVE" } })).id;
    for (const name of ["alice", "bob", "carol"]) ids[name] = (await db.user.create({ data: { discordId: name, discordName: name } })).id;
    for (const [u, c] of [["alice", "a"], ["bob", "a"], ["carol", "b"]]) {
      await db.membership.create({ data: { userId: ids[u], communityId: ids[c], status: "ACTIVE", joinedAt: new Date("2026-01-01") } });
    }
    await db.user.update({ where: { id: ids.carol }, data: { activeCommunityId: ids.b } });
    await db.user.update({ where: { id: ids.alice }, data: { activeCommunityId: ids.a } });
    for (const name of ["Valheim", "Factorio"]) ids[name] = (await db.game.create({ data: { name, source: "MANUAL", addedById: ids.alice } })).id;
    ids.mvp = (await db.superlativeCategory.create({ data: { icon: "X", name: "MVP de la soirée", modifiedById: ids.alice } })).id;
    ids.other = (await db.superlativeCategory.create({ data: { icon: "Y", name: "Boulet", modifiedById: ids.alice } })).id;
  });

  const session = (day: number, game: string, extra: { status?: "DONE" | "SCHEDULED"; community?: string; month?: number } = {}) =>
    db.session.create({
      data: {
        createdById: ids.alice, communityId: ids[extra.community ?? "a"], status: extra.status ?? "DONE",
        date: new Date(Date.UTC(2026, extra.month ?? 8, day, 20)), decidedGameId: ids[game],
      },
    });

  async function seedSeptember() {
    const s1 = await session(3, "Valheim"), s2 = await session(10, "Valheim"), s3 = await session(17, "Factorio");
    // Hors périmètre : août, soirée à venir, autre serveur.
    await session(28, "Factorio", { month: 7 }); await session(20, "Factorio", { status: "SCHEDULED" });
    await session(5, "Factorio", { community: "b" });
    const xp = (userId: string, sourceId: string, reason: "PARTICIPATE" | "VOTE", amount: number, createdAt = sept(5), communityId = ids.a) =>
      db.xpEvent.create({ data: { communityId, userId, sourceId, reason, amount, createdAt } });
    await xp(ids.alice, "p1", "PARTICIPATE", 10); await xp(ids.alice, "p2", "PARTICIPATE", 10); await xp(ids.alice, "p3", "PARTICIPATE", 10);
    await xp(ids.bob, "p4", "PARTICIPATE", 10); await xp(ids.bob, "v1", "VOTE", 5);
    await xp(ids.alice, "old", "PARTICIPATE", 99, new Date(Date.UTC(2026, 7, 31, 12)));
    await xp(ids.carol, "other", "PARTICIPATE", 77, sept(5), ids.b);
    const award = (sessionId: string, categoryId: string, winner: string) =>
      db.superlativeAward.create({ data: { communityId: ids.a, sessionId, categoryId, winnerUserId: ids[winner], voteCount: 2, createdAt: sept(20) } });
    await award(s1.id, ids.mvp, "bob"); await award(s2.id, ids.mvp, "bob"); await award(s3.id, ids.mvp, "alice");
    await award(s1.id, ids.other, "alice"); await award(s2.id, ids.other, "alice");
    const prono = (sessionId: string, voterId: string, correct: boolean) =>
      db.pronostic.create({ data: { communityId: ids.a, sessionId, voterId, predictedUserId: ids.alice, correct, createdAt: sept(20) } });
    await prono(s1.id, ids.bob, true); await prono(s2.id, ids.bob, true); await prono(s3.id, ids.bob, false); await prono(s1.id, ids.alice, true);
    await db.communityMemberStats.createMany({ data: [
      { communityId: ids.a, userId: ids.alice, streakCount: 4 }, { communityId: ids.a, userId: ids.bob, streakCount: 1 },
    ] });
  }

  it("le 1er du mois : snapshot du mois précédent avec chaque statistique du serveur", async () => {
    await seedSeptember();
    await at("2026-10-01T09:00:00Z");
    await recap.generateMonthlyRecapIfDue();
    expect(await db.monthlyRecap.count()).toBe(2); // a + b (b : une seule soirée)
    expect(await recap.getMonthlyRecap(2026, 9, ids.alice)).toEqual({
      sessionsPlayed: 3,
      mostPlayedGame: { name: "Valheim", count: 2 },
      mvpOfMonth: { discordName: "bob", count: 2 },
      mostActive: { discordName: "alice", count: 3 },
      bestStreak: { discordName: "alice", streak: 4 },
      bestPronostiqueur: { discordName: "bob", count: 2 },
      totalGroupXp: 45, // 30 (alice) + 10 + 5 (bob) ; août et autre serveur exclus
    });
  });

  it("idempotent, jamais un autre jour que le 1er, et lecture bornée au serveur du lecteur", async () => {
    await seedSeptember();
    await at("2026-10-15T09:00:00Z");
    await recap.generateMonthlyRecapIfDue();
    expect(await db.monthlyRecap.count()).toBe(0);
    vi.restoreAllMocks();
    await at("2026-10-01T09:00:00Z");
    await recap.generateMonthlyRecapIfDue();
    await recap.generateMonthlyRecapIfDue();
    expect(await db.monthlyRecap.count()).toBe(2);
    expect((await recap.getMonthlyRecap(2026, 9, ids.carol))?.sessionsPlayed).toBe(1);
    expect((await recap.getMonthlyRecap(2026, 9, ids.alice))?.sessionsPlayed).toBe(3);
    expect(await recap.getMonthlyRecap(2026, 8, ids.alice)).toBeNull();
  });

  it("aucune soirée jouée : pas de récap vide", async () => {
    await at("2026-10-01T09:00:00Z");
    await recap.generateMonthlyRecapIfDue();
    expect(await db.monthlyRecap.count()).toBe(0);
  });
});
