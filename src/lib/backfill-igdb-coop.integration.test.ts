import { Prisma } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Non-régression : le backfill IGDB Coop ne remplissait jamais
 * `igdbDetails`/`igdbDetailsFetchedAt` des jeux ayant un `igdbId` mais pas
 * encore de cache (il n'examinait que `igdbDetails != null`). Postgres
 * isolé (`TEST_DATABASE_URL`) + `fetch` entièrement simulé (Twitch/IGDB) —
 * aucun appel réseau réel. Suite SKIPPÉE si `TEST_DATABASE_URL` est absente.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn("[backfill-igdb-coop.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE.");
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe.skipIf(!TEST_DATABASE_URL)("runIgdbCoopBackfill (Postgres isolé + IGDB simulé)", () => {
  let db: import("@prisma/client").PrismaClient;
  let lib: typeof import("./backfill-igdb-coop");
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as import("@prisma/client").PrismaClient;
    lib = await import("./backfill-igdb-coop");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(`TRUNCATE "Game", "User" CASCADE`);
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://id.twitch.tv/oauth2/token")) {
        return jsonResponse(200, { access_token: "tok", expires_in: 3600 });
      }
      if (url === "https://api.igdb.com/v4/games") {
        return jsonResponse(200, [
          {
            id: 4242,
            name: "Jeu coop",
            summary: "Un jeu.",
            multiplayer_modes: [{ onlinecoop: true, onlinecoopmax: 4 }],
          },
        ]);
      }
      throw new Error(`Appel réseau inattendu : ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("IGDB_CLIENT_ID", "test-id");
    vi.stubEnv("IGDB_CLIENT_SECRET", "test-secret");
    vi.stubEnv("DEEPL_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("remplit igdbDetails + igdbDetailsFetchedAt + isCoop d'un jeu avec igdbId mais sans cache", async () => {
    const user = await db.user.create({ data: { discordId: "u-1", discordName: "u-1" } });
    const withoutCache = await db.game.create({
      data: { name: "Sans cache", source: "MANUAL", addedById: user.id, igdbId: 4242 },
    });
    const withoutIgdbId = await db.game.create({
      data: { name: "Sans igdbId", source: "MANUAL", addedById: user.id },
    });

    const summary = await lib.runIgdbCoopBackfill();

    const filled = await db.game.findUniqueOrThrow({ where: { id: withoutCache.id } });
    expect(filled.igdbDetails).not.toBeNull();
    expect(filled.igdbDetailsFetchedAt).not.toBeNull();
    expect(filled.isCoop).toBe(true);
    expect(filled.maxPlayers).toBe(4);
    expect(summary.detailsFilled).toBe(1);
    expect(summary.failed).toBe(0);

    // Un jeu sans igdbId n'est jamais touché ni interrogé.
    const untouched = await db.game.findUniqueOrThrow({ where: { id: withoutIgdbId.id } });
    expect(untouched.igdbDetails).toBeNull();
    expect(untouched.igdbDetailsFetchedAt).toBeNull();
  });

  it("n'écrase pas isCoop/maxPlayers d'un jeu confirmé manuellement, mais remplit quand même sa fiche", async () => {
    const user = await db.user.create({ data: { discordId: "u-2", discordName: "u-2" } });
    const manual = await db.game.create({
      data: {
        name: "Manuel",
        source: "MANUAL",
        addedById: user.id,
        igdbId: 4242,
        playInfoManual: true,
        isCoop: false,
        maxPlayers: 2,
      },
    });

    await lib.runIgdbCoopBackfill();

    const reread = await db.game.findUniqueOrThrow({ where: { id: manual.id } });
    expect(reread.igdbDetails).not.toBeNull();
    expect(reread.igdbDetailsFetchedAt).not.toBeNull();
    expect(reread.isCoop).toBe(false);
    expect(reread.maxPlayers).toBe(2);
  });

  it("une erreur IGDB est comptée en échec (jamais avalée) et laisse le jeu sans cache", async () => {
    const user = await db.user.create({ data: { discordId: "u-3", discordName: "u-3" } });
    const game = await db.game.create({
      data: { name: "KO", source: "MANUAL", addedById: user.id, igdbId: 4242 },
    });
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://id.twitch.tv/oauth2/token")) {
        return jsonResponse(200, { access_token: "tok", expires_in: 3600 });
      }
      return jsonResponse(500, { message: "boom" });
    });

    const summary = await lib.runIgdbCoopBackfill();

    expect(summary.failed).toBe(1);
    expect(summary.detailsFilled).toBe(0);
    const reread = await db.game.findUniqueOrThrow({ where: { id: game.id } });
    expect(reread.igdbDetails).toBeNull();
  });

  it("429 IGDB : un seul nouvel essai après Retry-After, puis la fiche est remplie", async () => {
    const user = await db.user.create({ data: { discordId: "u-4", discordName: "u-4" } });
    const game = await db.game.create({
      data: { name: "429 puis OK", source: "MANUAL", addedById: user.id, igdbId: 4242 },
    });
    let igdbCalls = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://id.twitch.tv/oauth2/token")) {
        return jsonResponse(200, { access_token: "tok", expires_in: 3600 });
      }
      igdbCalls += 1;
      if (igdbCalls === 1) {
        return new Response("{}", { status: 429, headers: { "Retry-After": "0" } });
      }
      return jsonResponse(200, [{ id: 4242, name: "x", multiplayer_modes: [{ onlinecoop: true }] }]);
    });

    const summary = await lib.runIgdbCoopBackfill();

    expect(igdbCalls).toBe(2);
    expect(summary.detailsFilled).toBe(1);
    const reread = await db.game.findUniqueOrThrow({ where: { id: game.id } });
    expect(reread.igdbDetailsFetchedAt).not.toBeNull();
  });

  it("429 persistant : le passage s'arrête après 3 échecs consécutifs au lieu de solliciter IGDB pour chaque jeu", async () => {
    const user = await db.user.create({ data: { discordId: "u-5", discordName: "u-5" } });
    for (let i = 0; i < 6; i += 1) {
      await db.game.create({
        data: { name: `Jeu ${i}`, source: "MANUAL", addedById: user.id, igdbId: 5000 + i },
      });
    }
    let igdbCalls = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("https://id.twitch.tv/oauth2/token")) {
        return jsonResponse(200, { access_token: "tok", expires_in: 3600 });
      }
      igdbCalls += 1;
      return new Response("{}", { status: 429, headers: { "Retry-After": "0" } });
    });

    const summary = await lib.runIgdbCoopBackfill();

    expect(summary.stoppedEarly).toBe(true);
    expect(summary.failed).toBe(3);
    // 3 jeux × (1 essai + 1 nouvel essai) = 6 appels IGDB, jamais 12.
    expect(igdbCalls).toBe(6);
    expect(await db.game.count({ where: { igdbDetails: { not: Prisma.DbNull } } })).toBe(0);
  });

  it("chaque appel IGDB porte un timeout (signal d'annulation)", async () => {
    const user = await db.user.create({ data: { discordId: "u-6", discordName: "u-6" } });
    await db.game.create({
      data: { name: "Timeout", source: "MANUAL", addedById: user.id, igdbId: 4242 },
    });

    await lib.runIgdbCoopBackfill();

    const igdbCall = fetchMock.mock.calls.find((c) => String(c[0]) === "https://api.igdb.com/v4/games");
    expect(igdbCall?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
