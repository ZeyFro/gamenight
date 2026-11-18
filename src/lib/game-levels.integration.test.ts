import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
if (!TEST_DATABASE_URL) console.warn("[game-levels] TEST_DATABASE_URL absente : tests PostgreSQL SKIPPÉS, niveaux par jeu NON validés sur SQL réel.");

describe.skipIf(!TEST_DATABASE_URL)("niveaux par jeu : PostgreSQL isolé", () => {
  let db: import("@prisma/client").PrismaClient;
  let lib: typeof import("./game-levels");
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    lib = await import("./game-levels");
  });
  afterAll(async () => { await db?.$disconnect(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.stubEnv("GAME_LEVELS_ENABLED", "true");
    vi.stubEnv("PROFILE_VISIBILITY_ENABLED", "true");
    await db.$executeRawUnsafe(`TRUNCATE "UserGameLevel", "UserProfileVisibility", "UserGame", "Membership", "User", "Game", "Community" CASCADE`);
    ids.a = (await db.community.create({ data: { slug: "levels-a", name: "A", status: "ACTIVE" } })).id;
    ids.b = (await db.community.create({ data: { slug: "levels-b", name: "B", status: "ACTIVE" } })).id;
    for (const name of ["me", "friend", "stranger"]) {
      ids[name] = (await db.user.create({ data: { discordId: name, discordName: name } })).id;
    }
    for (const [userId, communityId] of [[ids.me, ids.a], [ids.friend, ids.a], [ids.stranger, ids.b]]) {
      await db.membership.create({ data: { userId, communityId, status: "ACTIVE", joinedAt: new Date() } });
    }
    ids.game = (await db.game.create({ data: { name: "Valheim", source: "MANUAL", addedById: ids.me } })).id;
    ids.game2 = (await db.game.create({ data: { name: "Apex", source: "MANUAL", addedById: ids.me } })).id;
    await db.userGame.create({ data: { userId: ids.me, gameId: ids.game, owned: true } });
  });

  it("est inactif sans le drapeau : rien n'est écrit ni lu", async () => {
    vi.stubEnv("GAME_LEVELS_ENABLED", "false");
    expect(await lib.setUserGameLevel(ids.me, ids.game, "EXPERT")).toBe("unavailable");
    expect(await db.userGameLevel.count()).toBe(0);
    await db.userGameLevel.create({ data: { userId: ids.friend, gameId: ids.game, level: "EXPERT" } });
    expect(await lib.listVisibleGameLevels(ids.me, ids.friend)).toEqual([]);
    expect(await lib.listOwnGameLevels(ids.friend)).toEqual([]);
  });

  it("déclare, modifie (une seule ligne) et retire son niveau", async () => {
    expect(await lib.setUserGameLevel(ids.me, ids.game, "DEBUTANT")).toBe("saved");
    expect(await lib.setUserGameLevel(ids.me, ids.game, "AVANCE")).toBe("saved");
    expect(await db.userGameLevel.count()).toBe(1);
    expect(await lib.listOwnGameLevels(ids.me)).toEqual([{ gameId: ids.game, gameName: "Valheim", level: "AVANCE" }]);
    expect(await lib.removeUserGameLevel(ids.me, ids.game)).toBe("removed");
    expect(await db.userGameLevel.count()).toBe(0);
  });

  it("refuse un jeu inconnu et applique la limite par utilisateur", async () => {
    expect(await lib.setUserGameLevel(ids.me, "inconnu", "EXPERT")).toBe("invalid_game");
    const { MAX_GAME_LEVELS_PER_USER } = await import("./game-levels-rules");
    const games = await Promise.all(Array.from({ length: MAX_GAME_LEVELS_PER_USER }, (_, i) =>
      db.game.create({ data: { name: `Jeu ${i}`, source: "MANUAL", addedById: ids.me }, select: { id: true } })));
    for (const game of games) expect(await lib.setUserGameLevel(ids.me, game.id, "EXPERT")).toBe("saved");
    expect(await lib.setUserGameLevel(ids.me, ids.game, "EXPERT")).toBe("limit");
    expect(await lib.setUserGameLevel(ids.me, games[0].id, "DEBUTANT")).toBe("saved"); // modification toujours permise
  });

  it("un membre de la même communauté voit les niveaux, pas un membre d'un autre serveur", async () => {
    await lib.setUserGameLevel(ids.friend, ids.game, "EXPERT");
    expect(await lib.listVisibleGameLevels(ids.me, ids.friend)).toEqual([{ gameId: ids.game, gameName: "Valheim", level: "EXPERT" }]);
    expect(await lib.listVisibleGameLevels(ids.stranger, ids.friend)).toEqual([]);
  });

  it("un profil masqué ne fuit pas ses niveaux, sauf à lui-même ; démasqué ils reviennent", async () => {
    await lib.setUserGameLevel(ids.friend, ids.game, "EXPERT");
    await db.userProfileVisibility.create({ data: { userId: ids.friend, visibility: "HIDDEN" } });
    expect(await lib.listVisibleGameLevels(ids.me, ids.friend)).toEqual([]);
    expect(await lib.listVisibleGameLevels(ids.friend, ids.friend)).toHaveLength(1);
    await db.userProfileVisibility.update({ where: { userId: ids.friend }, data: { visibility: "COMMUNITY" } });
    expect(await lib.listVisibleGameLevels(ids.me, ids.friend)).toHaveLength(1);
  });

  it("propose les jeux de la bibliothèque et ceux déjà notés, sans doublon", async () => {
    await lib.setUserGameLevel(ids.me, ids.game2, "AVANCE");
    await lib.setUserGameLevel(ids.me, ids.game, "AVANCE");
    expect((await lib.listGameLevelChoices(ids.me)).map((game) => game.name)).toEqual(["Apex", "Valheim"]);
  });

  it("la suppression du jeu ou de l'utilisateur supprime ses niveaux en cascade", async () => {
    await lib.setUserGameLevel(ids.friend, ids.game, "EXPERT");
    await db.game.delete({ where: { id: ids.game } });
    expect(await db.userGameLevel.count()).toBe(0);
  });
});
