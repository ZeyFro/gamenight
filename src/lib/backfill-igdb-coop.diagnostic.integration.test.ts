import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

/**
 * Diagnostic « seuls 25 jeux sur 134 avec igdbId ont igdbDetailsFetchedAt » :
 * le backfill IGDB Coop (phase 1 de remplissage) existe et fonctionne — ces
 * tests le prouvent avec 134 jeux, puis mesurent ce qui limite le débit et ce
 * qui pouvait bloquer un passage. Postgres isolé (`TEST_DATABASE_URL`) + IGDB
 * entièrement simulé (`fetch` mocké, horloge virtuelle : aucun appel réseau
 * réel, aucune attente réelle). Suite SKIPPÉE si `TEST_DATABASE_URL` est absente.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn("[backfill-igdb-coop.diagnostic.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE.");
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Coût réaliste d'une fiche en production : appel IGDB + traduction DeepL (≈ 1,5 s) puis pause anti-limite de débit (250 ms). */
const PER_GAME_COST_MS = 1500;
const DELAY_COST_MS = 250;

describe.skipIf(!TEST_DATABASE_URL)("backfill IGDB Coop — diagnostic du débit et des blocages (Postgres isolé + IGDB simulé)", () => {
  let db: import("@prisma/client").PrismaClient;
  let lib: typeof import("./backfill-igdb-coop");
  let fetchMock: Mock<FetchFn>;
  let virtualNow: number;
  let userId: string;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as import("@prisma/client").PrismaClient;
    lib = await import("./backfill-igdb-coop");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(`TRUNCATE "Game", "User" CASCADE`);
    userId = (await db.user.create({ data: { discordId: "diag", discordName: "diag" } })).id;
    virtualNow = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => virtualNow);
    fetchMock = vi.fn<FetchFn>(async (input, init) => {
      const url = String(input);
      if (url.startsWith("https://id.twitch.tv/oauth2/token")) return json(200, { access_token: "tok", expires_in: 3600 });
      if (url === "https://api.igdb.com/v4/games") {
        virtualNow += PER_GAME_COST_MS;
        const igdbId = Number(/where id = (\d+);/.exec(String(init?.body))?.[1]);
        return json(200, [{ id: igdbId, name: `Jeu ${igdbId}`, summary: "Un jeu.", multiplayer_modes: [{ onlinecoop: true, onlinecoopmax: 4 }] }]);
      }
      throw new Error(`Appel réseau inattendu : ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("IGDB_CLIENT_ID", "test-id");
    vi.stubEnv("IGDB_CLIENT_SECRET", "test-secret");
    vi.stubEnv("DEEPL_API_KEY", "");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function seedGames(count: number, start = 1) {
    await db.game.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        name: `Jeu ${start + i}`,
        source: "MANUAL" as const,
        addedById: userId,
        igdbId: 1000 + start + i,
      })),
    });
  }

  const datedCount = () => db.game.count({ where: { igdbDetailsFetchedAt: { not: null } } });

  /** Un passage avec coût réel simulé par horloge virtuelle (la pause est comptée, pas attendue). */
  async function runPass(timeBudgetMs: number) {
    const summary = await lib.runIgdbCoopBackfill({ timeBudgetMs, requestDelayMs: 0, callTimeoutMs: 15_000 });
    return summary;
  }

  // Le coût de la pause anti-limite de débit est ajouté à l'horloge virtuelle après chaque fiche.
  beforeEach(() => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await original(input, init);
      if (String(input) === "https://api.igdb.com/v4/games") virtualNow += DELAY_COST_MS;
      return response;
    });
  });

  describe("débit : ce qui explique « 25 sur 134 »", () => {
    it("au budget d'avant (50 s) : ~29 fiches par passage, donc 5 passages pour 134 jeux — la logique n'a PAS disparu, elle progresse à chaque passage", async () => {
      await seedGames(134);

      const filledPerRun: number[] = [];
      for (let run = 0; run < 10 && (await datedCount()) < 134; run += 1) {
        filledPerRun.push((await runPass(50_000)).detailsFilled);
      }

      expect(filledPerRun[0]).toBe(29); // ≈ 25 : l'ordre de grandeur observé en production après un passage
      expect(filledPerRun).toHaveLength(5);
      expect(filledPerRun.reduce((a, b) => a + b, 0)).toBe(134);
      expect(await datedCount()).toBe(134);
    });

    it("au budget actuel (240 s) : les 134 fiches sont remplies en UN passage", async () => {
      await seedGames(134);

      const summary = await runPass(lib.IGDB_COOP_TIME_BUDGET_MS);

      expect(summary.detailsFilled).toBe(134);
      expect(summary.stopReason).not.toBe("time_budget");
      expect(await datedCount()).toBe(134);
      expect(summary.coverage).toEqual({ withIgdbId: 134, withDetails: 134, notFound: 0, remaining: 0, cachedWithoutDate: 0 });
    });

    it("un passage interrompu par le budget reprend là où il s'est arrêté (jamais les mêmes jeux)", async () => {
      await seedGames(60);

      const first = await runPass(50_000);
      const second = await runPass(50_000);
      const third = await runPass(50_000);

      expect(first.stopReason).toBe("time_budget");
      expect(first.detailsFilled + second.detailsFilled + third.detailsFilled).toBe(60);
      expect(await datedCount()).toBe(60);
    });
  });

  describe("blocages possibles d'un passage", () => {
    it("un appel IGDB qui ne répond jamais est interrompu par le délai par appel : compté en échec, le passage continue, aucune marque « introuvable »", async () => {
      await seedGames(2);
      const hungId = 1001;
      const normal = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        const isHung = String(input) === "https://api.igdb.com/v4/games" && String(init?.body).includes(`where id = ${hungId};`);
        if (!isHung) return normal(input, init);
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        });
      });

      const summary = await lib.runIgdbCoopBackfill({ requestDelayMs: 0, callTimeoutMs: 40 });

      expect(summary.failed).toBe(1);
      expect(summary.detailsFilled).toBe(1);
      const hung = await db.game.findFirstOrThrow({ where: { igdbId: hungId } });
      expect(hung.igdbDetails).toBeNull();
      expect(hung.igdbNotFoundAt).toBeNull();
      expect(summary.coverage).toMatchObject({ withIgdbId: 2, withDetails: 1, notFound: 0, remaining: 1 });
    });

    it("fiche en cache SANS date (incohérence) : rafraîchie et datée, au lieu de rester à jamais sans igdbDetailsFetchedAt", async () => {
      await db.game.create({
        data: {
          name: "Ancien cache",
          source: "MANUAL",
          addedById: userId,
          igdbId: 1001,
          igdbDetails: { igdbId: 1001, name: "Ancien cache", summary: null, descriptionFr: null },
          igdbDetailsFetchedAt: null,
        },
      });

      const before = await lib.runIgdbCoopBackfill({ requestDelayMs: 0 });
      expect(before.coverage).toMatchObject({ withDetails: 1, cachedWithoutDate: 0 });

      const game = await db.game.findFirstOrThrow({ where: { igdbId: 1001 } });
      expect(game.igdbDetailsFetchedAt).not.toBeNull();
    });

    it("fiche déjà datée : jamais refetchée par la phase 1 (aucun appel IGDB inutile)", async () => {
      await db.game.create({
        data: {
          name: "Déjà daté",
          source: "MANUAL",
          addedById: userId,
          igdbId: 1001,
          playInfoManual: true,
          igdbDetails: { igdbId: 1001, name: "Déjà daté", summary: null, descriptionFr: null },
          igdbDetailsFetchedAt: new Date("2026-09-01T00:00:00Z"),
        },
      });

      const summary = await lib.runIgdbCoopBackfill({ requestDelayMs: 0 });

      expect(summary.detailsFilled).toBe(0);
      expect(fetchMock.mock.calls.filter(([u]) => String(u) === "https://api.igdb.com/v4/games")).toHaveLength(0);
    });
  });

  describe("observabilité : la couverture est dans le résumé et dans les logs", () => {
    it("mélange rempli / introuvable / en échec : compteurs exacts", async () => {
      await seedGames(3);
      const normal = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "https://api.igdb.com/v4/games") {
          const igdbId = Number(/where id = (\d+);/.exec(String(init?.body))?.[1]);
          if (igdbId === 1002) return json(200, []); // introuvable
          if (igdbId === 1003) return json(500, { error: "boom" }); // échec
        }
        return normal(input, init);
      });

      const summary = await lib.runIgdbCoopBackfill({ requestDelayMs: 0 });

      expect(summary).toMatchObject({ detailsFilled: 1, failed: 1, notFound: 1 });
      expect(summary.coverage).toEqual({ withIgdbId: 3, withDetails: 1, notFound: 1, remaining: 1, cachedWithoutDate: 0 });
    });

    it("sans identifiants IGDB : rien n'est lu, couverture null", async () => {
      vi.stubEnv("IGDB_CLIENT_ID", "");
      const summary = await lib.runIgdbCoopBackfill({ requestDelayMs: 0 });
      expect(summary).toMatchObject({ stopReason: "no_credentials", skippedNoCredentials: true, coverage: null });
    });
  });
});
