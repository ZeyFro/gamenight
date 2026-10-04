import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Diagnostic « pourquoi la dernière activité Steam peut manquer sur /potes » —
 * `refreshSteamActivity` (cron léger `steam-library-sync`) rejoué contre une
 * base Postgres isolée avec une API Steam ENTIÈREMENT simulée (`fetch`
 * mocké : aucun appel réseau réel, aucune vraie clé). Chaque cas correspond
 * à une cause possible, avec son effet exact sur ce que `/potes` affiche
 * (`formatSteamActivityLabel`, le même libellé que la page).
 *
 * Nécessite `TEST_DATABASE_URL` — suite entièrement SKIPPÉE si absente.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn("[steam-activity.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE.");
}

type FetchPlan = { owned: () => Response | Promise<Response>; recent: () => Response | Promise<Response> };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

const OWNED_PRIVATE = () => json(200, { response: {} });
const OWNED_NO_TIMESTAMP = () =>
  json(200, { response: { game_count: 2, games: [{ appid: 1, name: "Vieux Jeu" }, { appid: 2, name: "Autre Jeu" }] } });
const OWNED_WITH_TIMESTAMP = (secondsAgo: number) => () =>
  json(200, {
    response: {
      game_count: 2,
      games: [
        { appid: 1, name: "Vieux Jeu", rtime_last_played: 1_600_000_000 },
        { appid: 2, name: "Jeu Récent", rtime_last_played: Math.floor(Date.now() / 1000) - secondsAgo },
      ],
    },
  });
const RECENT = (...names: Array<[string, number]>) => () =>
  json(200, { response: { total_count: names.length, games: names.map(([name, m], i) => ({ appid: 100 + i, name, playtime_2weeks: m })) } });
const RECENT_EMPTY = () => json(200, { response: { total_count: 0 } });
const HTTP_500 = () => json(500, { error: "boom" });
const HTTP_429 = () => json(429, { error: "rate limit" });
const TIMEOUT = () => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"));

describe.skipIf(!TEST_DATABASE_URL)("activité Steam sur /potes — diagnostic (Postgres isolée + Steam simulé)", () => {
  let db: import("@prisma/client").PrismaClient;
  let steam: typeof import("./steam");
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as import("@prisma/client").PrismaClient;
    steam = await import("./steam");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(`TRUNCATE "User" CASCADE`);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("STEAM_API_KEY", "clé-de-test-jamais-réelle");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function steamReturns(plan: FetchPlan) {
    fetchMock.mockImplementation(async (input: URL | string) => {
      const url = String(input);
      if (url.includes("GetOwnedGames")) return plan.owned();
      if (url.includes("GetRecentlyPlayedGames")) return plan.recent();
      throw new Error(`appel Steam inattendu : ${url}`);
    });
  }

  let counter = 0;
  async function makeUser(overrides: Partial<{ lastPlayedGame: string | null; lastPlayedAt: Date | null; steamPublic: boolean }> = {}) {
    counter += 1;
    return db.user.create({
      data: {
        discordId: `steam-${counter}`,
        discordName: `steam-${counter}`,
        steamId64: `7656119800000${String(counter).padStart(4, "0")}`,
        steamPublic: overrides.steamPublic ?? true,
        lastPlayedGame: overrides.lastPlayedGame ?? null,
        lastPlayedAt: overrides.lastPlayedAt ?? null,
      },
    });
  }

  /** Ce que la carte du pote affiche sous « Steam lié » (même fonction que la page). */
  async function labelFor(userId: string): Promise<string | null> {
    const row = await db.user.findUniqueOrThrow({ where: { id: userId } });
    return steam.formatSteamActivityLabel(row.lastPlayedGame, row.lastPlayedAt, Date.now());
  }

  async function refresh(userId: string) {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    return steam.refreshSteamActivity(user.id, user.steamId64!);
  }

  describe("causes côté Steam / confidentialité (comportement voulu, rien à corriger)", () => {
    it("détails de jeu privés ({response:{}}) : activité effacée, rien affiché", async () => {
      const user = await makeUser({ lastPlayedGame: "Ancien", lastPlayedAt: new Date() });
      steamReturns({ owned: OWNED_PRIVATE, recent: RECENT_EMPTY });

      expect(await refresh(user.id)).toEqual({ userId: user.id, category: "private" });
      expect(await labelFor(user.id)).toBeNull();
      expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).steamPublic).toBe(false);
    });

    it("aucune partie sur les 2 dernières semaines (fenêtre Steam) : rien affiché", async () => {
      const user = await makeUser();
      steamReturns({ owned: OWNED_NO_TIMESTAMP, recent: RECENT_EMPTY });

      expect((await refresh(user.id)).category).toBe("none");
      expect(await labelFor(user.id)).toBeNull();
    });
  });

  describe("chemin nominal", () => {
    it("rtime_last_played absent (cas Production) + parties récentes : « A joué récemment à X »", async () => {
      const user = await makeUser();
      steamReturns({ owned: OWNED_NO_TIMESTAMP, recent: RECENT(["Rocket League", 90], ["Mario Kart", 30]) });

      expect((await refresh(user.id)).category).toBe("approximate");
      expect(await labelFor(user.id)).toBe("A joué récemment à Rocket League");
    });

    it("rtime_last_played présent : « A joué à X — il y a Y » et aucun second appel Steam", async () => {
      const user = await makeUser();
      steamReturns({ owned: OWNED_WITH_TIMESTAMP(3 * 3600), recent: HTTP_500 });

      expect((await refresh(user.id)).category).toBe("precise");
      expect(await labelFor(user.id)).toBe("A joué à Jeu Récent — il y a 3 h");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("GetOwnedGames en échec (gros catalogue : timeout 6 s, 429, 5xx) — l'appel léger officiel fonctionne encore", () => {
    it.each([
      ["timeout", TIMEOUT],
      ["HTTP 500", HTTP_500],
      ["HTTP 429", HTTP_429],
    ])("%s : l'activité vient de GetRecentlyPlayedGames au lieu de rester vide", async (_label, ownedFailure) => {
      const user = await makeUser();
      steamReturns({ owned: ownedFailure, recent: RECENT(["Rocket League", 90]) });

      expect(await refresh(user.id)).toEqual({ userId: user.id, category: "approximate", degraded: true });

      expect(await labelFor(user.id)).toBe("A joué récemment à Rocket League");
      const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(row.steamPublic).toBe(true);
      expect(row.steamActivityCheckedAt).not.toBeNull();
    });

    it("remplace une activité plus ancienne par la plus récente", async () => {
      const user = await makeUser({ lastPlayedGame: "Ancien jeu", lastPlayedAt: null });
      steamReturns({ owned: TIMEOUT, recent: RECENT(["Nouveau jeu", 45]) });

      await refresh(user.id);
      expect(await labelFor(user.id)).toBe("A joué récemment à Nouveau jeu");
    });

    it("les deux appels échouent : l'ancienne activité valide est conservée (jamais effacée par une panne)", async () => {
      const user = await makeUser({ lastPlayedGame: "Ancien jeu", lastPlayedAt: null });
      steamReturns({ owned: TIMEOUT, recent: TIMEOUT });

      expect(await refresh(user.id)).toEqual({ userId: user.id, category: "error" });
      expect(await labelFor(user.id)).toBe("A joué récemment à Ancien jeu");
      expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).steamActivityCheckedAt).not.toBeNull();
    });

    it("liste récente VIDE alors que GetOwnedGames a échoué : ambigu (privé ? aucune partie ?), rien n'est effacé", async () => {
      const user = await makeUser({ lastPlayedGame: "Ancien jeu", lastPlayedAt: null });
      steamReturns({ owned: HTTP_500, recent: RECENT_EMPTY });

      expect(await refresh(user.id)).toEqual({ userId: user.id, category: "error" });
      expect(await labelFor(user.id)).toBe("A joué récemment à Ancien jeu");
    });

    it("le repli ne s'applique pas à un profil réellement privé ({response:{}}) : toujours effacé", async () => {
      const user = await makeUser({ lastPlayedGame: "Ancien jeu", lastPlayedAt: null });
      steamReturns({ owned: OWNED_PRIVATE, recent: RECENT(["Rocket League", 90]) });

      expect((await refresh(user.id)).category).toBe("private");
      expect(await labelFor(user.id)).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("route /api/cron/steam-library-sync (Steam simulé)", () => {
    it("rafraîchit l'activité de chaque compte et compte les replis dégradés dans le résumé", async () => {
      vi.stubEnv("CRON_SECRET", "secret-de-test");
      const heavy = await makeUser(); // catalogue trop lourd : GetOwnedGames expire
      const normal = await makeUser(); // chemin habituel
      fetchMock.mockImplementation(async (input: URL | string) => {
        const url = new URL(String(input));
        const isHeavy = url.searchParams.get("steamid") === (await db.user.findUniqueOrThrow({ where: { id: heavy.id } })).steamId64;
        if (url.pathname.includes("GetOwnedGames")) return isHeavy ? TIMEOUT() : OWNED_NO_TIMESTAMP();
        return RECENT([isHeavy ? "Rocket League" : "Mario Kart", 60])();
      });

      const route = await import("@/app/api/cron/steam-library-sync/route");
      const response = await route.GET(
        new Request("https://example.test/api/cron/steam-library-sync", { headers: { authorization: "Bearer secret-de-test" } })
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ total: 2, processed: 2 });
      expect(body.summary).toMatchObject({ approximate: 2, degraded: 1, error: 0, private: 0, rejected: 0 });
      expect(await labelFor(heavy.id)).toBe("A joué récemment à Rocket League");
      expect(await labelFor(normal.id)).toBe("A joué récemment à Mario Kart");
    });
  });
});
