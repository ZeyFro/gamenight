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

  const gamesCalls = () =>
    fetchMock.mock.calls.filter(([url]) => String(url) === "https://api.igdb.com/v4/games").length;
  const igdbKnowsNothing = () =>
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).startsWith("https://id.twitch.tv/oauth2/token")) {
        return jsonResponse(200, { access_token: "tok", expires_in: 3600 });
      }
      return jsonResponse(200, []);
    });

  it("un jeu rempli en phase 1 n'est pas re-sélectionné en phase 2 du même passage", async () => {
    const user = await db.user.create({ data: { discordId: "u-4", discordName: "u-4" } });
    await db.game.create({
      data: { name: "Une fois", source: "MANUAL", addedById: user.id, igdbId: 4242 },
    });

    const summary = await lib.runIgdbCoopBackfill();

    // Avant le correctif : 2 appels IGDB (remplissage puis resynchronisation).
    expect(gamesCalls()).toBe(1);
    expect(summary.detailsFilled).toBe(1);
    expect(summary.eligible).toBe(1);
    expect(summary.stopReason).toBe("no_eligible");
  });

  it("jeu introuvable sur IGDB : marqué igdbNotFoundAt, pas compté en échec, non retenté avant le délai", async () => {
    const user = await db.user.create({ data: { discordId: "u-5", discordName: "u-5" } });
    const game = await db.game.create({
      data: { name: "Fantôme", source: "MANUAL", addedById: user.id, igdbId: 9999 },
    });
    igdbKnowsNothing();

    const first = await lib.runIgdbCoopBackfill();
    expect(first.notFound).toBe(1);
    expect(first.failed).toBe(0);
    expect(first.detailsFilled).toBe(0);
    const marked = await db.game.findUniqueOrThrow({ where: { id: game.id } });
    expect(marked.igdbNotFoundAt).not.toBeNull();
    expect(marked.igdbDetails).toBeNull();
    expect(gamesCalls()).toBe(1);

    // Second passage juste après : plus interrogé.
    const second = await lib.runIgdbCoopBackfill();
    expect(gamesCalls()).toBe(1);
    expect(second.eligible).toBe(0);
    expect(second.stopReason).toBe("no_eligible");

    // Après le délai : retenté.
    await db.game.update({
      where: { id: game.id },
      data: { igdbNotFoundAt: new Date(Date.now() - lib.IGDB_NOT_FOUND_RETRY_MS - 60_000) },
    });
    const third = await lib.runIgdbCoopBackfill();
    expect(gamesCalls()).toBe(2);
    expect(third.notFound).toBe(1);
  });

  it("un jeu retrouvé après un échec « introuvable » efface la marque", async () => {
    const user = await db.user.create({ data: { discordId: "u-6", discordName: "u-6" } });
    const game = await db.game.create({
      data: {
        name: "Revenu",
        source: "MANUAL",
        addedById: user.id,
        igdbId: 4242,
        igdbNotFoundAt: new Date(Date.now() - lib.IGDB_NOT_FOUND_RETRY_MS - 60_000),
      },
    });

    await lib.runIgdbCoopBackfill();

    const reread = await db.game.findUniqueOrThrow({ where: { id: game.id } });
    expect(reread.igdbDetails).not.toBeNull();
    expect(reread.igdbNotFoundAt).toBeNull();
  });

  it("phase 2 : un jeu en cache devenu introuvable est marqué sans écraser isCoop/maxPlayers", async () => {
    const user = await db.user.create({ data: { discordId: "u-7", discordName: "u-7" } });
    const game = await db.game.create({
      data: {
        name: "En cache",
        source: "MANUAL",
        addedById: user.id,
        igdbId: 4242,
        igdbDetails: { igdbId: 4242, name: "En cache" },
        igdbDetailsFetchedAt: new Date(),
        isCoop: true,
        maxPlayers: 4,
      },
    });
    igdbKnowsNothing();

    const summary = await lib.runIgdbCoopBackfill();

    const reread = await db.game.findUniqueOrThrow({ where: { id: game.id } });
    expect(reread.igdbNotFoundAt).not.toBeNull();
    expect(reread.isCoop).toBe(true);
    expect(reread.maxPlayers).toBe(4);
    expect(summary.notFound).toBe(1);
    expect(summary.updated).toBe(0);
  });

  it("stopReason : « no_eligible » quand rien à faire, « time_budget » quand le budget est épuisé", async () => {
    const user = await db.user.create({ data: { discordId: "u-8", discordName: "u-8" } });
    expect((await lib.runIgdbCoopBackfill()).stopReason).toBe("no_eligible");

    await db.game.create({
      data: { name: "Trop tard", source: "MANUAL", addedById: user.id, igdbId: 4242 },
    });
    // Premier appel (startedAt) = maintenant, les suivants = budget dépassé.
    const real = Date.now();
    let calls = 0;
    const spy = vi.spyOn(Date, "now").mockImplementation(() =>
      calls++ === 0 ? real : real + lib.IGDB_COOP_TIME_BUDGET_MS + 1_000
    );
    try {
      const summary = await lib.runIgdbCoopBackfill();
      expect(summary.stopReason).toBe("time_budget");
      expect(summary.stoppedEarly).toBe(true);
      expect(gamesCalls()).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});
