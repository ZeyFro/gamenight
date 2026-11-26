import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Filtre et tag « niveau » de la recherche de joueurs (cahier 12.2) : Postgres local isolé, aucun réseau.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
if (!TEST_DATABASE_URL) console.warn("[player-classified-level] TEST_DATABASE_URL absente : filtre niveau NON validé sur SQL réel (SKIPPÉ).");

describe.skipIf(!TEST_DATABASE_URL)("recherche de joueurs par niveau : PostgreSQL isolé", () => {
  let db: import("@prisma/client").PrismaClient;
  let lib: typeof import("./player-classifieds");
  const ids: Record<string, string> = {};
  const search = async (viewer: string, filters: Record<string, string>, community = "a") => {
    const { parsePlayerClassifiedFilters } = await import("./player-classified-filters");
    const parsed = parsePlayerClassifiedFilters(filters);
    if (!parsed.success) throw new Error("filtres invalides");
    return lib.listPlayerClassifieds(ids[viewer], ids[community], new Date(), parsed.data);
  };
  const names = (rows: { createdBy: { discordName: string } }[]) => rows.map((row) => row.createdBy.discordName).sort();

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    lib = await import("./player-classifieds");
  });
  afterAll(async () => { await db?.$disconnect(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.stubEnv("GAME_LEVELS_ENABLED", "true");
    vi.stubEnv("PROFILE_VISIBILITY_ENABLED", "true");
    await db.$executeRawUnsafe(`TRUNCATE "PlayerClassified", "UserGameLevel", "UserProfileVisibility", "Membership", "User", "Game", "Community" CASCADE`);
    ids.a = (await db.community.create({ data: { slug: "lvl-a", name: "A", status: "ACTIVE", playerClassifiedsEnabled: true } })).id;
    ids.b = (await db.community.create({ data: { slug: "lvl-b", name: "B", status: "ACTIVE", playerClassifiedsEnabled: true } })).id;
    for (const name of ["viewer", "novice", "pro", "expert", "hidden", "elsewhere", "nolevel"]) {
      ids[name] = (await db.user.create({ data: { discordId: name, discordName: name } })).id;
    }
    for (const [user, community] of [["viewer", "a"], ["novice", "a"], ["pro", "a"], ["expert", "a"], ["hidden", "a"], ["nolevel", "a"], ["elsewhere", "b"]]) {
      await db.membership.create({ data: { userId: ids[user], communityId: ids[community], status: "ACTIVE", joinedAt: new Date("2026-01-01") } });
    }
    ids.game = (await db.game.create({ data: { name: "Valheim", source: "MANUAL", addedById: ids.viewer } })).id;
    ids.other = (await db.game.create({ data: { name: "Apex", source: "MANUAL", addedById: ids.viewer } })).id;
    const levels: [string, string, "DEBUTANT" | "INTERMEDIAIRE" | "CONFIRME" | "COMPETITIF"][] = [
      ["novice", "game", "DEBUTANT"], ["pro", "game", "CONFIRME"], ["expert", "game", "COMPETITIF"], ["hidden", "game", "COMPETITIF"], ["elsewhere", "game", "COMPETITIF"],
      ["pro", "other", "DEBUTANT"],
    ];
    for (const [user, game, level] of levels) await db.userGameLevel.create({ data: { userId: ids[user], gameId: ids[game], level } });
    await db.userProfileVisibility.create({ data: { userId: ids.hidden, visibility: "HIDDEN" } });
    for (const [user, community] of [["novice", "a"], ["pro", "a"], ["expert", "a"], ["hidden", "a"], ["nolevel", "a"], ["elsewhere", "b"]]) {
      await db.playerClassified.create({ data: {
        communityId: ids[community], gameId: ids.game, createdById: ids[user], message: `annonce ${user}`, createdAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000),
      } });
    }
  });

  it("niveau minimum : ce niveau et plus, sans profil masqué ni autre serveur", async () => {
    expect(names(await search("viewer", { gameId: ids.game, level: "CONFIRME" }))).toEqual(["expert", "pro"]);
    expect(names(await search("viewer", { gameId: ids.game, level: "DEBUTANT" }))).toEqual(["expert", "novice", "pro"]);
  });

  it("niveau exact", async () => {
    expect(names(await search("viewer", { gameId: ids.game, level: "CONFIRME", levelMatch: "exact" }))).toEqual(["pro"]);
    expect(names(await search("viewer", { gameId: ids.game, level: "INTERMEDIAIRE", levelMatch: "exact" }))).toEqual([]);
  });

  it("le niveau est celui du jeu choisi, pas d'un autre jeu", async () => {
    expect(names(await search("viewer", { gameId: ids.other, level: "DEBUTANT" }))).toEqual([]); // aucune annonce sur Apex
    expect(names(await search("viewer", { gameId: ids.game, level: "COMPETITIF" }))).toEqual(["expert"]);
  });

  it("sans filtre de niveau, les profils visibles restent listés avec leur tag ; un profil masqué n’est jamais exposé", async () => {
    const rows = await search("viewer", {});
    expect(names(rows)).toEqual(["expert", "nolevel", "novice", "pro"]);
    const level = (name: string) => rows.find((row) => row.createdBy.discordName === name)?.authorLevel;
    expect(level("expert")).toBe("COMPETITIF");
    expect(level("novice")).toBe("DEBUTANT");
    expect(level("nolevel")).toBeNull();
  });

  it("jeu replié : le niveau déclaré sur la ligne sœur s’applique à l’annonce", async () => {
    const sister = await db.game.create({ data: { name: "Valheim", source: "MANUAL", addedById: ids.viewer, steamAppId: 990_001 } });
    await db.playerClassified.deleteMany({ where: { createdById: ids.pro } });
    await db.userGameLevel.deleteMany({ where: { userId: ids.pro, gameId: ids.game } });
    await db.playerClassified.create({ data: {
      communityId: ids.a, gameId: sister.id, createdById: ids.pro, message: "annonce ligne sœur", createdAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000),
    } });
    await db.userGameLevel.create({ data: { userId: ids.pro, gameId: sister.id, level: "CONFIRME" } });

    const rows = await lib.listPlayerClassifieds(ids.viewer, ids.a, new Date(), {
      gameId: ids.game, gameIds: [ids.game, sister.id], level: "CONFIRME",
    });
    // « expert » reste présent (niveau supérieur, annonce sur la ligne principale) ;
    // « pro » n'est retenu que grâce à son niveau déclaré sur la ligne sœur.
    expect(names(rows)).toEqual(["expert", "pro"]);
    const pro = rows.find((row) => row.createdBy.discordName === "pro");
    expect(pro?.authorLevel).toBe("CONFIRME");
    expect(pro?.game.id).toBe(sister.id);
  });

  it("un membre d'un autre serveur ne voit pas les annonces ni les niveaux d'ici", async () => {
    expect(await search("elsewhere", { gameId: ids.game, level: "DEBUTANT" }, "b").then(names)).toEqual(["elsewhere"]);
    expect(await lib.listPlayerClassifieds(ids.elsewhere, ids.a, new Date(), { gameId: ids.game, level: "DEBUTANT" })).toEqual([]);
  });

  it("flag éteint : le niveau n'est ni filtré ni affiché", async () => {
    vi.stubEnv("GAME_LEVELS_ENABLED", "false");
    const rows = await search("viewer", {});
    expect(rows.every((row) => row.authorLevel === null)).toBe(true);
  });
});
