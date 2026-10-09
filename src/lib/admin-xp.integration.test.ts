import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/discord-level-up", () => ({ announceLevelUp: vi.fn() }));
vi.mock("@/lib/discord-badge-unlocked", () => ({ announceBadgeUnlocked: vi.fn() }));
vi.mock("@/lib/community-announce", () => ({ postToCommunity: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (TEST_DATABASE_URL && new URL(TEST_DATABASE_URL).hostname !== "127.0.0.1") throw new Error("Postgres local 127.0.0.1 uniquement");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
if (!TEST_DATABASE_URL) console.warn("[admin-xp] Postgres local absent : tests SKIPPÉS.");

describe.skipIf(!TEST_DATABASE_URL)("correction d'XP par un admin, Postgres sans réseau", () => {
  let db: import("@prisma/client").PrismaClient;
  let lib: typeof import("./admin-xp");
  let xp: typeof import("./xp-actions");
  let scoreboard: typeof import("./scoreboard");
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma;
    lib = await import("./admin-xp"); xp = await import("./xp-actions"); scoreboard = await import("./scoreboard");
  });
  afterAll(async () => { await db?.$disconnect(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true"); vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Réseau interdit dans ce test"); }));
    await db.$executeRawUnsafe('TRUNCATE "XpAdjustment", "XpEvent", "LevelUpEvent", "Session", "CommunityMemberStats", "User", "Community" CASCADE');
    (await import("./default-community")).resetDefaultCommunityIdCache();
    for (const c of ["default", "a", "b"]) ids[c] = (await db.community.create({ data: { slug: c, name: `Serveur ${c}`, status: "ACTIVE" } })).id;
    for (const [key, name] of [["admin", "Admin"], ["alice", "Alice Martin"], ["bob", "Bob"], ["both", "Alicia"]]) {
      ids[key] = (await db.user.create({ data: { discordId: key, discordName: name } })).id;
    }
    for (const [u, c] of [["admin", "a"], ["alice", "a"], ["bob", "b"], ["both", "a"], ["both", "b"]]) {
      await db.membership.create({ data: { userId: ids[u], communityId: ids[c] } });
    }
  });

  const setXp = (user: string, community: string, xpTotal: number) =>
    db.communityMemberStats.upsert({
      where: { communityId_userId: { communityId: ids[community], userId: ids[user] } },
      create: { communityId: ids[community], userId: ids[user], xpTotal }, update: { xpTotal },
    });
  const xpOf = async (user: string, community: string) =>
    (await db.communityMemberStats.findUnique({ where: { communityId_userId: { communityId: ids[community], userId: ids[user] } } }))?.xpTotal ?? null;
  const adjust = (patch: Partial<Parameters<typeof lib.applyXpAdjustment>[0]> = {}) =>
    lib.applyXpAdjustment({
      adminId: ids.admin, adminName: "Admin", communityId: ids.a, userId: ids.alice,
      newXp: 500, expectedOldXp: 1596, reason: "abus création/suppression", ...patch,
    });

  describe("application", () => {
    it("remplace le solde, écrit l'écart dans le ledger et journalise (qui, avant, après, raison)", async () => {
      await setXp("alice", "a", 1596);
      expect(await adjust()).toEqual({ ok: true, oldXp: 1596, newXp: 500 });
      expect(await xpOf("alice", "a")).toBe(500);
      const event = await db.xpEvent.findFirstOrThrow({ where: { userId: ids.alice, reason: "ADMIN_ADJUSTMENT" } });
      expect(event).toMatchObject({ communityId: ids.a, amount: -1096 });
      const log = await db.xpAdjustment.findMany({});
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
        communityId: ids.a, userId: ids.alice, userName: "Alice Martin", adminId: ids.admin, adminName: "Admin",
        oldXp: 1596, newXp: 500, reason: "abus création/suppression",
      });
      expect(event.sourceId).toBe(log[0].id);
    });

    it("hausse possible, raison facultative, aucune annonce de niveau ni LevelUpEvent", async () => {
      await setXp("alice", "a", 100);
      expect(await adjust({ newXp: 20_000, expectedOldXp: 100, reason: null })).toMatchObject({ ok: true });
      expect(await xpOf("alice", "a")).toBe(20_000);
      expect((await db.xpAdjustment.findFirstOrThrow({})).reason).toBeNull();
      expect(await db.levelUpEvent.count()).toBe(0);
    });

    it("le niveau et le rang suivent le nouveau solde (calcul à la volée)", async () => {
      await setXp("alice", "a", 1596);
      await adjust();
      const detail = await lib.getAdminPlayerDetail(ids.a, ids.alice);
      expect(detail).toMatchObject({ xpTotal: 500, level: 4 });
    });

    it("un joueur sans ligne de stats est corrigeable à partir de 0", async () => {
      expect(await adjust({ expectedOldXp: 0, newXp: 40 })).toMatchObject({ ok: true, oldXp: 0, newXp: 40 });
      expect(await xpOf("alice", "a")).toBe(40);
    });

    it("les classements par période additionnent le ledger : la correction y apparaît", async () => {
      await setXp("alice", "a", 1596);
      await db.xpEvent.create({ data: { communityId: ids.a, userId: ids.alice, reason: "CREATE_SESSION", sourceId: "s1", amount: 1596 } });
      await adjust();
      const week = await scoreboard.getScoreboard("week", { communityId: ids.a });
      const global = await scoreboard.getScoreboard("global", { communityId: ids.a });
      // Même valeur au classement de la semaine (ledger) et au classement global (solde).
      expect(week.find((e) => e.userId === ids.alice)?.periodXp).toBe(500);
      expect(global.find((e) => e.userId === ids.alice)?.periodXp).toBe(500);
      const sum = await db.xpEvent.aggregate({ where: { userId: ids.alice, communityId: ids.a }, _sum: { amount: true } });
      expect(sum._sum.amount).toBe(500);
    });
  });

  describe("refus", () => {
    it("valeur identique : rien n'est écrit", async () => {
      await setXp("alice", "a", 500);
      expect(await adjust({ expectedOldXp: 500, newXp: 500 })).toEqual({ ok: false, reason: "unchanged" });
      expect(await db.xpAdjustment.count()).toBe(0);
      expect(await db.xpEvent.count()).toBe(0);
    });

    it("solde modifié depuis l'affichage : refus « stale », rien n'est écrit", async () => {
      await setXp("alice", "a", 1600);
      expect(await adjust({ expectedOldXp: 1596 })).toEqual({ ok: false, reason: "stale" });
      expect(await xpOf("alice", "a")).toBe(1600);
      expect(await db.xpAdjustment.count()).toBe(0);
    });

    it("valeurs invalides : négatif, trop grand, non entier, raison trop longue", async () => {
      await setXp("alice", "a", 1596);
      for (const patch of [{ newXp: -1 }, { newXp: 10_000_001 }, { newXp: 1.5 }, { expectedOldXp: -1 }, { reason: "x".repeat(501) }]) {
        expect(await adjust(patch), JSON.stringify(patch)).toEqual({ ok: false, reason: "invalid" });
      }
      expect(await xpOf("alice", "a")).toBe(1596);
      expect(await db.xpAdjustment.count()).toBe(0);
    });

    it("joueur d'une autre communauté, retiré, ou communauté suspendue : refus « not_member »", async () => {
      await setXp("bob", "b", 300);
      expect(await adjust({ userId: ids.bob, expectedOldXp: 300 })).toEqual({ ok: false, reason: "not_member" });
      await setXp("alice", "a", 300);
      await db.membership.update({ where: { communityId_userId: { communityId: ids.a, userId: ids.alice } }, data: { status: "REMOVED" } });
      expect(await adjust({ expectedOldXp: 300 })).toEqual({ ok: false, reason: "not_member" });
      await db.membership.update({ where: { communityId_userId: { communityId: ids.a, userId: ids.alice } }, data: { status: "ACTIVE" } });
      await db.community.update({ where: { id: ids.a }, data: { status: "SUSPENDED" } });
      expect(await adjust({ expectedOldXp: 300 })).toEqual({ ok: false, reason: "not_member" });
      expect(await xpOf("alice", "a")).toBe(300);
      expect(await xpOf("bob", "b")).toBe(300);
    });

    it("n'agit que sur la communauté visée : le même joueur garde son XP ailleurs", async () => {
      await setXp("both", "a", 1000); await setXp("both", "b", 2000);
      expect(await adjust({ userId: ids.both, expectedOldXp: 1000, newXp: 10 })).toMatchObject({ ok: true });
      expect(await xpOf("both", "a")).toBe(10);
      expect(await xpOf("both", "b")).toBe(2000);
      expect(await db.xpEvent.count({ where: { communityId: ids.b } })).toBe(0);
    });
  });

  describe("concurrence", () => {
    it("deux corrections simultanées avec le même solde vu : une seule s'applique", async () => {
      await setXp("alice", "a", 1596);
      const results = await Promise.all([adjust({ newXp: 500 }), adjust({ newXp: 900 })]);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok && r.reason === "stale")).toHaveLength(1);
      expect(await db.xpAdjustment.count()).toBe(1);
      const final = await xpOf("alice", "a");
      expect([500, 900]).toContain(final);
    });

    it("correction et gain d'XP simultanés : soit correction puis gain, soit refus « stale » ; jamais un gain perdu", async () => {
      await setXp("alice", "a", 1596);
      const [result] = await Promise.all([adjust(), xp.awardXp(ids.alice, ids.a, "VOTE", "v1", 5)]);
      const final = await xpOf("alice", "a");
      if (result.ok) expect(final).toBe(505);
      else { expect(result).toEqual({ ok: false, reason: "stale" }); expect(final).toBe(1601); }
      const ledger = await db.xpEvent.aggregate({ where: { userId: ids.alice, communityId: ids.a }, _sum: { amount: true } });
      expect(ledger._sum.amount).toBe(result.ok ? -1096 + 5 : 5);
    });
  });

  describe("recherche et fiche", () => {
    it("trouve par pseudo (insensible à la casse, partiel), limité aux membres actifs de la communauté", async () => {
      await setXp("alice", "a", 1596);
      expect((await lib.searchAdminPlayers(ids.a, "ali")).map((p) => p.discordName).sort()).toEqual(["Alice Martin", "Alicia"]);
      expect((await lib.searchAdminPlayers(ids.a, "ALICE"))[0]).toMatchObject({ discordName: "Alice Martin", xpTotal: 1596 });
      expect(await lib.searchAdminPlayers(ids.a, "bob")).toEqual([]);
      expect(await lib.searchAdminPlayers(ids.b, "bob")).toHaveLength(1);
      expect(await lib.searchAdminPlayers(ids.a, "   ")).toEqual([]);
      await db.membership.update({ where: { communityId_userId: { communityId: ids.a, userId: ids.alice } }, data: { status: "REMOVED" } });
      expect(await lib.searchAdminPlayers(ids.a, "Alice")).toEqual([]);
    });

    it("la fiche marque les gains « soirée créée » dont la soirée n'existe plus et compte les suppressions", async () => {
      await setXp("alice", "a", 90);
      const kept = await db.session.create({ data: { communityId: ids.a, createdById: ids.alice, date: new Date(), status: "VOTING" } });
      await db.xpEvent.createMany({ data: [
        { communityId: ids.a, userId: ids.alice, reason: "CREATE_SESSION", sourceId: kept.id, amount: 30 },
        { communityId: ids.a, userId: ids.alice, reason: "CREATE_SESSION", sourceId: "supprimee-1", amount: 30 },
        { communityId: ids.a, userId: ids.alice, reason: "CREATE_SESSION", sourceId: "supprimee-2", amount: 30 },
        { communityId: ids.a, userId: ids.alice, reason: "VOTE", sourceId: "p1", amount: 5 },
      ] });
      const detail = await lib.getAdminPlayerDetail(ids.a, ids.alice);
      expect(detail?.creations).toEqual({ paid: 3, deleted: 2 });
      expect(detail!.recentEvents.filter((e) => e.sessionDeleted)).toHaveLength(2);
      expect(detail!.recentEvents.filter((e) => e.reason === "VOTE")[0].sessionDeleted).toBe(false);
    });

    it("la fiche liste les corrections précédentes ; un non-membre n'a pas de fiche", async () => {
      await setXp("alice", "a", 1596);
      await adjust();
      const detail = await lib.getAdminPlayerDetail(ids.a, ids.alice);
      expect(detail?.adjustments).toHaveLength(1);
      expect(detail?.adjustments[0]).toMatchObject({ adminName: "Admin", oldXp: 1596, newXp: 500 });
      expect(await lib.getAdminPlayerDetail(ids.a, ids.bob)).toBeNull();
    });
  });

  it("l'admin voit sa communauté actuelle (jamais une autre)", async () => {
    await db.user.update({ where: { id: ids.admin }, data: { activeCommunityId: ids.a } });
    expect(await lib.getAdminCurrentCommunity(ids.admin)).toEqual({ id: ids.a, name: "Serveur a" });
  });
});
