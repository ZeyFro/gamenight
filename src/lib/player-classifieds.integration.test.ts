import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Petites annonces « il manque un quatrième » (LFG) : parcours réel sur Postgres local,
// aucun réseau. Actions serveur créer/supprimer + lecture filtrée.
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

if (!TEST_DATABASE_URL) console.warn("[player-classifieds] TEST_DATABASE_URL absente : petites annonces NON validées (SKIPPÉE).");

describe.skipIf(!TEST_DATABASE_URL)("petites annonces LFG : Postgres local", () => {
  let db: import("@prisma/client").PrismaClient;
  let actions: typeof import("@/app/joueurs/actions");
  let lib: typeof import("./player-classifieds");
  const ids: Record<string, string> = {};
  const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; };
  const as = async (name: string) => currentUser.mockResolvedValue(await db.user.findUnique({ where: { id: ids[name] } }));

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    actions = await import("@/app/joueurs/actions");
    lib = await import("./player-classifieds");
  });
  afterAll(async () => { await db?.$disconnect(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("ADMIN_DISCORD_IDS", "admin");
    await db.$executeRawUnsafe(`TRUNCATE "PlayerClassified", "User", "Game", "Community" CASCADE`);
    ids.on = (await db.community.create({ data: { slug: "on", name: "on", status: "ACTIVE", playerClassifiedsEnabled: true } })).id;
    ids.off = (await db.community.create({ data: { slug: "off", name: "off", status: "ACTIVE", playerClassifiedsEnabled: false } })).id;
    for (const name of ["alice", "bob", "outsider", "admin", "offUser"]) {
      ids[name] = (await db.user.create({ data: { discordId: name, discordName: name } })).id;
    }
    for (const [u, c] of [["alice", "on"], ["bob", "on"], ["admin", "on"], ["offUser", "off"]]) {
      await db.membership.create({ data: { userId: ids[u], communityId: ids[c], status: "ACTIVE", joinedAt: new Date("2026-01-01") } });
    }
    ids.game = (await db.game.create({ data: { name: "Valheim", source: "MANUAL", addedById: ids.alice } })).id;
  });

  it("un membre publie une annonce : jeu + message coupé, expire à +24 h, visible des autres membres", async () => {
    await as("alice");
    await expect(actions.createPlayerClassifiedAction(form({ gameId: ids.game, message: "  Il manque un quatrième  " }))).rejects.toThrow("REDIRECT:/joueurs");
    const row = await db.playerClassified.findFirstOrThrow();
    expect(row).toMatchObject({ communityId: ids.on, gameId: ids.game, createdById: ids.alice, message: "Il manque un quatrième" });
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(24 * 60 * 60 * 1000);
    const list = await lib.listPlayerClassifieds(ids.bob, ids.on, row.createdAt);
    expect(list.map((a) => [a.message, a.game.name, a.createdBy.id])).toEqual([["Il manque un quatrième", "Valheim", ids.alice]]);
  });

  it("annonce expirée ou auteur retiré de la communauté : masquée", async () => {
    await as("alice");
    await expect(actions.createPlayerClassifiedAction(form({ gameId: ids.game, message: "Ce soir ?" }))).rejects.toThrow("REDIRECT:/joueurs");
    const row = await db.playerClassified.findFirstOrThrow();
    expect(await lib.listPlayerClassifieds(ids.bob, ids.on, new Date(row.expiresAt.getTime() - 1))).toHaveLength(1);
    expect(await lib.listPlayerClassifieds(ids.bob, ids.on, row.expiresAt)).toHaveLength(0);
    await db.membership.update({ where: { communityId_userId: { communityId: ids.on, userId: ids.alice } }, data: { status: "REMOVED" } });
    expect(await lib.listPlayerClassifieds(ids.bob, ids.on, row.createdAt)).toHaveLength(0);
  });

  it("module éteint, non-membre, message vide ou trop long : rien n'est créé", async () => {
    await as("offUser");
    await expect(actions.createPlayerClassifiedAction(form({ gameId: ids.game, message: "x" }))).rejects.toThrow("REDIRECT:/joueurs?error=unavailable");
    await as("outsider");
    await expect(actions.createPlayerClassifiedAction(form({ gameId: ids.game, message: "x" }))).rejects.toThrow("REDIRECT:/joueurs?error=unavailable");
    await as("alice");
    await expect(actions.createPlayerClassifiedAction(form({ gameId: ids.game, message: "   " }))).rejects.toThrow("REDIRECT:/joueurs?error=invalid");
    await expect(actions.createPlayerClassifiedAction(form({ gameId: ids.game, message: "x".repeat(241) }))).rejects.toThrow("REDIRECT:/joueurs?error=invalid");
    await expect(actions.createPlayerClassifiedAction(form({ gameId: "inconnu", message: "ok" }))).rejects.toThrow("REDIRECT:/joueurs?error=invalid");
    expect(await db.playerClassified.count()).toBe(0);
  });

  it("suppression : l'auteur et l'admin peuvent, un autre membre non", async () => {
    const make = () => db.playerClassified.create({ data: { communityId: ids.on, gameId: ids.game, createdById: ids.alice, message: "m", createdAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) } });
    const a = await make();
    await as("bob");
    await expect(actions.deletePlayerClassifiedAction(form({ id: a.id }))).rejects.toThrow("REDIRECT:/joueurs?error=forbidden");
    expect(await db.playerClassified.count()).toBe(1);
    await as("alice");
    await actions.deletePlayerClassifiedAction(form({ id: a.id }));
    expect(await db.playerClassified.count()).toBe(0);
    const b = await make();
    await as("admin");
    await actions.deletePlayerClassifiedAction(form({ id: b.id }));
    expect(await db.playerClassified.count()).toBe(0);
  });

  it("une annonce d'un autre serveur est introuvable pour la suppression", async () => {
    const foreign = await db.playerClassified.create({ data: { communityId: ids.off, gameId: ids.game, createdById: ids.offUser, message: "m", createdAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) } });
    await as("admin");
    await expect(actions.deletePlayerClassifiedAction(form({ id: foreign.id }))).rejects.toThrow("REDIRECT:/joueurs?error=forbidden");
    expect(await db.playerClassified.count()).toBe(1);
  });
});
