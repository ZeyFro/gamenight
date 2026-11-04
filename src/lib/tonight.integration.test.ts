import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// « Qui joue ce soir ? » : parcours réel sur Postgres local, aucun réseau.
// Déclarer / remplacer / retirer sa dispo, puis lecture du tableau.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const { currentUser } = vi.hoisted(() => ({ currentUser: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: currentUser }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true, RATE_LIMIT_ERROR_KEY: "rate_limited", RATE_LIMIT_MESSAGE: "trop vite" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

if (!TEST_DATABASE_URL) console.warn("[tonight] TEST_DATABASE_URL absente : « Qui joue ce soir ? » NON validé (SKIPPÉ).");

describe.skipIf(!TEST_DATABASE_URL)("Qui joue ce soir ? : Postgres local", () => {
  let db: import("@prisma/client").PrismaClient;
  let actions: typeof import("@/app/ce-soir/actions");
  let board: typeof import("./tonight");
  let rules: typeof import("./tonight-rules");
  let wallclock: typeof import("./wallclock");
  const ids: Record<string, string> = {};
  const form = (fields: [string, string][]) => { const f = new FormData(); for (const [k, v] of fields) f.append(k, v); return f; };
  const as = async (name: string) => currentUser.mockResolvedValue(await db.user.findUnique({ where: { id: ids[name] } }));
  const tonightRows = (name: string) =>
    db.playerClassified.findMany({
      where: { createdById: ids[name], message: { startsWith: rules.TONIGHT_MESSAGE_PREFIX } },
      orderBy: { gameId: "asc" },
    });

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    actions = await import("@/app/ce-soir/actions");
    board = await import("./tonight");
    rules = await import("./tonight-rules");
    wallclock = await import("./wallclock");
  });
  afterAll(async () => { await db?.$disconnect(); });
  afterEach(() => { vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("WHO_PLAYS_TONIGHT_ENABLED", "true");
    await db.$executeRawUnsafe(`TRUNCATE "PlayerClassified", "Session", "User", "Game", "Community" CASCADE`);
    ids.on = (await db.community.create({ data: { slug: "on", name: "on", status: "ACTIVE", playerClassifiedsEnabled: true } })).id;
    for (const name of ["alice", "bob", "carol"]) {
      ids[name] = (await db.user.create({ data: { discordId: name, discordName: name } })).id;
      await db.membership.create({ data: { userId: ids[name], communityId: ids.on, status: "ACTIVE", joinedAt: new Date("2026-01-01") } });
    }
    ids.valheim = (await db.game.create({ data: { name: "Valheim", source: "MANUAL", addedById: ids.alice } })).id;
    ids.amongus = (await db.game.create({ data: { name: "Among Us", source: "MANUAL", addedById: ids.alice } })).id;
  });

  it("flag éteint : 404, rien n'est écrit", async () => {
    vi.stubEnv("WHO_PLAYS_TONIGHT_ENABLED", "false");
    await as("alice");
    await expect(actions.declareTonightAction(form([["gameId", ids.valheim]]))).rejects.toThrow("NOT_FOUND");
    await expect(actions.clearTonightAction()).rejects.toThrow("NOT_FOUND");
    expect(await db.playerClassified.count()).toBe(0);
  });

  it("déclare 2 jeux jusqu'à 4 h, la nouvelle déclaration remplace l'ancienne, les annonces ordinaires restent", async () => {
    await as("alice");
    await db.playerClassified.create({
      data: { communityId: ids.on, gameId: ids.valheim, createdById: ids.alice, message: "Il manque un quatrième", createdAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000) },
    });

    await expect(actions.declareTonightAction(form([["gameId", ids.valheim], ["gameId", ids.amongus], ["note", "dès 21h"]]))).rejects.toThrow("REDIRECT:/ce-soir?declared=1");
    const first = await tonightRows("alice");
    expect(first).toHaveLength(2);
    for (const row of first) {
      expect(row.message).toBe(rules.buildTonightMessage("dès 21h"));
      expect(row.expiresAt).toEqual(rules.tonightExpiresAt(row.createdAt));
    }

    await expect(actions.declareTonightAction(form([["gameId", ids.amongus]]))).rejects.toThrow("REDIRECT:/ce-soir?declared=1");
    const second = await tonightRows("alice");
    expect(second.map((r) => r.gameId)).toEqual([ids.amongus]);
    expect(await db.playerClassified.count({ where: { message: "Il manque un quatrième" } })).toBe(1);
  });

  it("préserve la disponibilité précédente si la nouvelle insertion échoue", async () => {
    await as("alice");
    await expect(actions.declareTonightAction(form([["gameId", ids.valheim]]))).rejects.toThrow("REDIRECT");
    const original = await tonightRows("alice");
    expect(original).toHaveLength(1);

    const { replaceTonightClassifieds } = await import("./tonight-write");
    await expect(replaceTonightClassifieds({
      userId: ids.alice,
      communityId: ids.on,
      gameIds: ["jeu-inexistant-foreign-key"],
      message: rules.buildTonightMessage("remplacement"),
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    })).rejects.toThrow();

    const after = await tonightRows("alice");
    expect(after.map((row) => row.id)).toEqual(original.map((row) => row.id));
    expect(after.map((row) => row.message)).toEqual(original.map((row) => row.message));
  });

  it("refuse un jeu inconnu ou une liste vide, sans rien écrire", async () => {
    await as("alice");
    await expect(actions.declareTonightAction(form([["gameId", "inconnu"]]))).rejects.toThrow("REDIRECT:/ce-soir?error=invalid");
    await expect(actions.declareTonightAction(form([]))).rejects.toThrow("REDIRECT:/ce-soir?error=invalid");
    expect(await db.playerClassified.count()).toBe(0);
  });

  it("communauté sans petites annonces : indisponible", async () => {
    await db.community.update({ where: { id: ids.on }, data: { playerClassifiedsEnabled: false } });
    await as("alice");
    await expect(actions.declareTonightAction(form([["gameId", ids.valheim]]))).rejects.toThrow("REDIRECT:/ce-soir?error=unavailable");
  });

  it("« je ne suis plus dispo » ne retire que ses propres déclarations", async () => {
    await as("alice");
    await expect(actions.declareTonightAction(form([["gameId", ids.valheim]]))).rejects.toThrow("REDIRECT");
    await as("bob");
    await expect(actions.declareTonightAction(form([["gameId", ids.valheim]]))).rejects.toThrow("REDIRECT");
    await as("alice");
    await expect(actions.clearTonightAction()).rejects.toThrow("REDIRECT:/ce-soir");
    expect(await tonightRows("alice")).toHaveLength(0);
    expect(await tonightRows("bob")).toHaveLength(1);
  });

  it("tableau : joueurs groupés par jeu, seulement les soirées visibles par le lecteur", async () => {
    await as("alice");
    await expect(actions.declareTonightAction(form([["gameId", ids.valheim]]))).rejects.toThrow("REDIRECT");
    await as("bob");
    await expect(actions.declareTonightAction(form([["gameId", ids.valheim], ["gameId", ids.amongus]]))).rejects.toThrow("REDIRECT");

    // Commencée il y a une heure : toujours dans la fenêtre « ce soir », quelle que soit l'heure du test.
    const now = wallclock.wallClockNow();
    const date = new Date(now.getTime() - 3_600_000);
    const bobsSession = await db.session.create({ data: { date, createdById: ids.bob, communityId: ids.on, status: "SCHEDULED" } });
    await db.session.create({ data: { date, createdById: ids.carol, communityId: ids.on, status: "SCHEDULED" } });

    const view = await board.getTonightBoard(ids.bob, ids.on, now);
    expect(view.players.map((g) => g.game)).toEqual(["Valheim", "Among Us"]);
    expect(view.players[0].players.map((p) => p.id).sort()).toEqual([ids.alice, ids.bob].sort());
    expect(view.players[1].players.map((p) => p.id)).toEqual([ids.bob]);
    expect(view.myGames.sort()).toEqual(["Among Us", "Valheim"]);
    expect(view.sessions.map((s) => s.id)).toEqual([bobsSession.id]);
    expect(view.instantSessions).toEqual([]);
  });
});
