import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

if (!TEST_DATABASE_URL) console.warn("[game-library.integration.test] TEST_DATABASE_URL absente — isolation bibliothèque NON validée (SKIPPÉE).");

describe.skipIf(!TEST_DATABASE_URL)("bibliothèque et compteurs de la communauté active (Postgres)", () => {
  let db: import("@prisma/client").PrismaClient;
  let library: typeof import("./game-library");
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as typeof db;
    library = await import("./game-library");
  });
  afterAll(async () => { vi.unstubAllEnvs(); await db.$disconnect(); });
  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    await db.$executeRawUnsafe('TRUNCATE "Game", "Membership", "Community", "User" CASCADE');
    for (const slug of ["a", "b"]) ids[slug] = (await db.community.create({ data: { slug, name: slug, status: "ACTIVE" } })).id;
    for (const name of ["alice", "bob", "both", "left", "none"]) {
      ids[name] = (await db.user.create({ data: { discordId: name, discordName: name } })).id;
    }
    for (const [name, community] of [["alice", "a"], ["bob", "b"], ["both", "a"], ["both", "b"], ["left", "a"]]) {
      await db.membership.create({ data: { userId: ids[name], communityId: ids[community], status: name === "left" ? "REMOVED" : "ACTIVE" } });
    }
    await db.user.update({ where: { id: ids.both }, data: { activeCommunityId: ids.a } });
    for (const name of ["onlyA", "onlyB", "shared", "unowned", "former"]) {
      ids[name] = (await db.game.create({ data: { name, source: "MANUAL", addedById: ids.alice } })).id;
    }
    for (const [name, game] of [["alice", "onlyA"], ["bob", "onlyB"], ["alice", "shared"], ["bob", "shared"], ["both", "shared"], ["alice", "unowned"], ["left", "former"]]) {
      await db.userGame.create({ data: { userId: ids[name], gameId: ids[game], owned: game !== "unowned" } });
    }
  });

  it("ne montre que les jeux et les avatars des membres actifs du serveur affiché", async () => {
    const games = await library.getGroupLibraryGames(ids.alice);
    expect(games.map(g => g.name)).toEqual(["onlyA", "shared"]);
    expect(games.find(g => g.name === "shared")!.userGames.map(g => g.user.id).sort()).toEqual([ids.alice, ids.both].sort());
    expect((await library.getGroupLibraryGames(ids.bob)).map(g => g.name)).toEqual(["onlyB", "shared"]);
    expect((await library.getGameOwners(ids.alice, ids.shared)).map(g => g.user.id).sort()).toEqual([ids.alice, ids.both].sort());
    expect(await library.getGameOwners(ids.alice, ids.onlyB)).toEqual([]);
  });

  it("compte les mêmes possesseurs que ceux affichés et les seuls membres actifs", async () => {
    const counts = await library.getGameOwnerCounts(ids.alice);
    expect(Object.fromEntries(counts)).toEqual({ [ids.onlyA]: 1, [ids.shared]: 2 });
    expect(await library.getTotalUserCount(ids.alice)).toBe(2);
    expect(await library.getTotalUserCount(ids.bob)).toBe(2);
  });

  it("exige chacun des possesseurs choisis, déduplique et exclut owned:false", async () => {
    expect((await library.getGroupLibraryGames(ids.alice, [ids.alice, ids.both, ids.alice])).map(g => g.name)).toEqual(["shared"]);
    expect((await library.getGroupLibraryGames(ids.alice, [ids.alice])).map(g => g.name)).toEqual(["onlyA", "shared"]);
    expect((await library.getGroupLibraryGames(ids.alice, [])).map(g => g.name)).toEqual(["onlyA", "shared"]);
    await db.userGame.create({ data: { userId: ids.both, gameId: ids.unowned, owned: true } });
    expect((await library.getGroupLibraryGames(ids.alice, [ids.alice, ids.both])).map(g => g.name)).toEqual(["shared"]);
  });

  it.each(["bob", "left", "none", "missing"])("refuse toute la sélection si un participant est inaccessible (%s)", async name => {
    expect(await library.getGroupLibraryGames(ids.alice, [ids.alice, ids[name] ?? "unknown"])).toEqual([]);
  });

  it("revalide le serveur actif, la révocation et la suspension", async () => {
    expect((await library.getGroupLibraryGames(ids.both, [ids.alice, ids.both])).map(g => g.name)).toEqual(["shared"]);
    await db.user.update({ where: { id: ids.both }, data: { activeCommunityId: ids.b } });
    expect(await library.getGroupLibraryGames(ids.both, [ids.alice, ids.both])).toEqual([]);
    expect((await library.getGroupLibraryGames(ids.both, [ids.bob, ids.both])).map(g => g.name)).toEqual(["shared"]);
    await db.membership.update({ where: { communityId_userId: { userId: ids.bob, communityId: ids.b } }, data: { status: "REMOVED" } });
    expect(await library.getGroupLibraryGames(ids.both, [ids.bob, ids.both])).toEqual([]);
    await db.community.update({ where: { id: ids.b }, data: { status: "SUSPENDED" } });
    // Le visiteur revient sur son autre serveur ACTIVE ; la sélection de B
    // reste refusée et ne doit jamais révéler ses bibliothèques suspendues.
    expect(await library.getGroupLibraryGames(ids.both, [ids.bob, ids.both])).toEqual([]);
  });

  it("OFF : aucun fallback global pour un utilisateur sans membership", async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    expect(await library.getGroupLibraryGames(ids.none, [ids.alice, ids.bob, ids.both])).toEqual([]);
    expect(await library.getGroupLibraryGames(ids.none, [ids.alice, ids.bob, ids.left])).toEqual([]);
  });

  it("propose les seuls membres du serveur actif et ne donne pas de roster global sous OFF", async () => {
    expect((await library.getGroupLibraryMembers(ids.alice)).map(row => row.id).sort()).toEqual([ids.alice, ids.both].sort());
    expect(await library.getGroupLibraryMembers(ids.none)).toEqual([]);
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    expect(await library.getGroupLibraryMembers(ids.none)).toEqual([]);
  });

  it("refuse les sélections trop grandes sans élargir aux membres valides", async () => {
    expect(await library.getGroupLibraryGames(ids.alice, [ids.alice, ...Array.from({ length: 100 }, (_, index) => `unknown-${index}`)])).toEqual([]);
  });

  it("un changement de serveur bascule les jeux et compteurs sans agréger les deux serveurs", async () => {
    expect((await library.getGroupLibraryGames(ids.both)).map(g => g.name)).toEqual(["onlyA", "shared"]);
    await db.user.update({ where: { id: ids.both }, data: { activeCommunityId: ids.b } });
    expect((await library.getGroupLibraryGames(ids.both)).map(g => g.name)).toEqual(["onlyB", "shared"]);
    expect(Object.fromEntries(await library.getGameOwnerCounts(ids.both))).toEqual({ [ids.onlyB]: 1, [ids.shared]: 2 });
  });

  it.each(["none", "left"])("sans appartenance active (%s), aucune donnée ni compteur global", async name => {
    expect(await library.getGroupLibraryGames(ids[name])).toEqual([]);
    expect(await library.getGameOwnerCounts(ids[name])).toEqual(new Map());
    expect(await library.getTotalUserCount(ids[name])).toBe(0);
    expect(await library.getGameOwners(ids[name], ids.shared)).toEqual([]);
  });

  it("une communauté suspendue n'accorde pas d'accès", async () => {
    await db.community.update({ where: { id: ids.a }, data: { status: "SUSPENDED" } });
    expect(await library.getGroupLibraryGames(ids.alice)).toEqual([]);
    expect(await library.getTotalUserCount(ids.alice)).toBe(0);
  });

  it("plusieurs serveurs sans choix valide ne révèlent aucune bibliothèque", async () => {
    await db.user.update({ where: { id: ids.both }, data: { activeCommunityId: null } });
    expect(await library.getGroupLibraryGames(ids.both)).toEqual([]);
    expect(await library.getTotalUserCount(ids.both)).toBe(0);
  });

  it("isolation OFF : aucun jeu, possesseur ou compteur global sans membership", async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    expect(await library.getGroupLibraryGames(ids.none)).toEqual([]);
    expect(await library.getGameOwnerCounts(ids.none)).toEqual(new Map());
    expect(await library.getTotalUserCount(ids.none)).toBe(0);
    expect(await library.getGameOwners(ids.none, ids.shared)).toEqual([]);
  });
});
