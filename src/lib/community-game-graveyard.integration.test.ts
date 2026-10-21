import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (TEST_DATABASE_URL && new URL(TEST_DATABASE_URL).hostname !== "127.0.0.1") throw new Error("Postgres local uniquement");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
if (!TEST_DATABASE_URL) console.warn("[community-game-graveyard] Postgres absent : intégrations ignorées.");

describe.skipIf(!TEST_DATABASE_URL)("cimetière : droits et isolation Postgres", () => {
  let db: import("@prisma/client").PrismaClient;
  let api: typeof import("./community-game-graveyard");
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    api = await import("./community-game-graveyard");
  });
  afterAll(async () => { await db?.$disconnect(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_GAME_GRAVEYARD_ENABLED", "true");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    const members = [
      ["grave-author", "grave-a", "ADMIN"], ["grave-member", "grave-a", "MEMBER"],
      ["grave-admin", "grave-a", "ADMIN"], ["grave-owner", "grave-a", "OWNER"],
      ["grave-outsider", "grave-b", "OWNER"],
    ] as const;
    await db.$transaction([
      db.communityGameEpitaph.deleteMany({ where: { communityId: { in: ["grave-a", "grave-b"] } } }),
      db.userGame.deleteMany({ where: { userId: { in: members.map(([id]) => id) } } }),
      db.community.deleteMany({ where: { id: { in: ["grave-a", "grave-b"] } } }),
      db.game.deleteMany({ where: { id: { in: ["grave-owned", "grave-played", "grave-foreign", "grave-forgotten"] } } }),
      db.user.deleteMany({ where: { id: { in: members.map(([id]) => id) } } }),
      db.community.createMany({ data: ["grave-a", "grave-b"].map(id => ({ id, slug: id, name: id, status: "ACTIVE" })) }),
      db.user.createMany({ data: members.map(([id, communityId]) => ({ id, discordId: id, discordName: id, activeCommunityId: communityId })) }),
      db.membership.createMany({ data: members.map(([userId, communityId, role]) => ({ userId, communityId, status: "ACTIVE", role })) }),
      db.game.createMany({ data: ["grave-owned", "grave-played", "grave-foreign", "grave-forgotten"].map(id => ({ id, name: id, source: "MANUAL", addedById: "grave-author" })) }),
      db.userGame.createMany({ data: [{ userId: "grave-member", gameId: "grave-owned", owned: true }, { userId: "grave-outsider", gameId: "grave-foreign", owned: true }, { userId: "grave-member", gameId: "grave-forgotten", owned: false }] }),
      db.groupGameStat.create({ data: { communityId: "grave-a", gameId: "grave-played", playCount: 1 } }),
    ]);
  });

  it("propose seulement les jeux possédés ou joués du serveur et permet la recherche", async () => {
    expect((await api.listCommunityGameGraveyard("grave-author"))?.games.map(game => game.id)).toEqual(["grave-owned", "grave-played"]);
    expect((await api.listCommunityGameGraveyard("grave-author", "play"))?.games.map(game => game.id)).toEqual(["grave-played"]);
    expect(await api.saveCommunityGameEpitaph("grave-author", null, "grave-foreign", "Non")).toBe("unavailable");
    expect(await api.saveCommunityGameEpitaph("grave-author", null, "grave-forgotten", "Non")).toBe("unavailable");
    await db.membership.update({ where: { communityId_userId: { communityId: "grave-a", userId: "grave-member" } }, data: { status: "LEFT" } });
    expect((await api.listCommunityGameGraveyard("grave-author"))?.games.map(game => game.id)).toEqual(["grave-played"]);
  });

  it("crée une épitaphe unique sans toucher aux jeux ni aux bibliothèques", async () => {
    const gamesBefore = await db.game.findMany({ orderBy: { id: "asc" } });
    const libraryBefore = await db.userGame.findMany({ orderBy: [{ userId: "asc" }, { gameId: "asc" }] });
    const saved = await Promise.all([
      api.saveCommunityGameEpitaph("grave-author", null, "grave-owned", " Ci-gît notre backlog "),
      api.saveCommunityGameEpitaph("grave-owner", null, "grave-owned", "Autre texte"),
    ]);
    expect(saved.sort()).toEqual(["exists", "saved"]);
    const row = await db.communityGameEpitaph.findFirstOrThrow();
    expect(row.communityId).toBe("grave-a");
    expect(await db.communityGameEpitaph.count()).toBe(1);
    expect(await api.deleteCommunityGameEpitaph("grave-admin", row.id)).toBe("deleted");
    expect(await db.game.findMany({ orderBy: { id: "asc" } })).toEqual(gamesBefore);
    expect(await db.userGame.findMany({ orderBy: [{ userId: "asc" }, { gameId: "asc" }] })).toEqual(libraryBefore);
  });

  it.each(["false", "true"])("isole liste, création et mutations même isolation=%s", async isolation => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", isolation);
    await api.saveCommunityGameEpitaph("grave-author", null, "grave-owned", "Au revoir");
    const row = await db.communityGameEpitaph.findFirstOrThrow();
    expect((await api.listCommunityGameGraveyard("grave-outsider"))?.entries).toEqual([]);
    expect(await api.saveCommunityGameEpitaph("grave-outsider", row.id, "grave-owned", "Non")).toBe("unavailable");
    expect(await api.deleteCommunityGameEpitaph("grave-outsider", row.id)).toBe("unavailable");
  });

  it("réserve les mutations aux administrateurs, même pour un ancien auteur ; le jeu reste immuable", async () => {
    await api.saveCommunityGameEpitaph("grave-author", null, "grave-owned", "Au revoir");
    const row = await db.communityGameEpitaph.findFirstOrThrow();
    expect(await api.saveCommunityGameEpitaph("grave-member", null, "grave-played", "Non")).toBe("unavailable");
    expect(await api.saveCommunityGameEpitaph("grave-member", row.id, "grave-owned", "Non")).toBe("unavailable");
    expect(await api.deleteCommunityGameEpitaph("grave-member", row.id)).toBe("unavailable");
    expect(await api.saveCommunityGameEpitaph("grave-author", row.id, "grave-played", "Autre jeu")).toBe("unavailable");
    await db.membership.update({ where: { communityId_userId: { communityId: "grave-a", userId: "grave-author" } }, data: { role: "MEMBER" } });
    expect((await api.listCommunityGameGraveyard("grave-author"))?.entries).toHaveLength(1);
    expect(await api.saveCommunityGameEpitaph("grave-author", row.id, "grave-owned", "Non")).toBe("unavailable");
    expect(await api.deleteCommunityGameEpitaph("grave-author", row.id)).toBe("unavailable");
    for (const user of ["grave-admin", "grave-owner"]) expect(await api.saveCommunityGameEpitaph(user, row.id, "grave-owned", user)).toBe("saved");
    expect(await api.deleteCommunityGameEpitaph("grave-admin", row.id)).toBe("deleted");
  });

  it("refuse un ancien onglet après changement de serveur", async () => {
    await db.membership.create({ data: { userId: "grave-author", communityId: "grave-b", status: "ACTIVE", role: "OWNER" } });
    await db.user.update({ where: { id: "grave-author" }, data: { activeCommunityId: "grave-b" } });
    expect(await api.saveCommunityGameEpitaph("grave-author", null, "grave-owned", "Ancien onglet", "grave-a")).toBe("unavailable");
    expect(await db.communityGameEpitaph.count()).toBe(0);
  });

  it.each(["Membership", "Community"])("revalide %s lors d’un retrait concurrent", async table => {
    let release!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { locked = resolve; });
    const blocker = db.$transaction(async tx => {
      if (table === "Membership") await tx.membership.update({ where: { communityId_userId: { communityId: "grave-a", userId: "grave-author" } }, data: { status: "REMOVED" } });
      else await tx.community.update({ where: { id: "grave-a" }, data: { status: "SUSPENDED" } });
      locked(); await gate;
    }, { timeout: 15000 });
    await ready;
    const save = api.saveCommunityGameEpitaph("grave-author", null, "grave-owned", "Interdit");
    try {
      await vi.waitFor(async () => {
        const waiting = await db.$queryRaw<{ pid: number }[]>`SELECT pid FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FOR SHARE%'`;
        expect(waiting.length).toBeGreaterThan(0);
      }, { timeout: 4000 });
    } finally { release(); await blocker; }
    expect(await save).toBe("unavailable");
    expect(await db.communityGameEpitaph.count()).toBe(0);
  }, 15000);

  it("refuse une saisie invalide, un membre retiré et le drapeau OFF", async () => {
    expect(await api.saveCommunityGameEpitaph("grave-author", null, "grave-owned", "x".repeat(1001))).toBe("invalid");
    await db.membership.update({ where: { communityId_userId: { communityId: "grave-a", userId: "grave-author" } }, data: { status: "LEFT" } });
    expect(await api.listCommunityGameGraveyard("grave-author")).toBeNull();
    expect(await api.saveCommunityGameEpitaph("grave-author", null, "grave-owned", "Non")).toBe("unavailable");
    vi.stubEnv("COMMUNITY_GAME_GRAVEYARD_ENABLED", "false");
    expect(await api.listCommunityGameGraveyard("grave-admin")).toBeNull();
    expect(await api.saveCommunityGameEpitaph("grave-admin", null, "grave-played", "Non")).toBe("unavailable");
    expect(await db.communityGameEpitaph.count()).toBe(0);
  });
});
