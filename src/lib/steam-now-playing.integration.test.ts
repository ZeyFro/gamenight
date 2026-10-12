import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * « En jeu maintenant » : `refreshSteamNowPlaying`, route
 * `/api/cron/steam-library-sync` et page `/potes` contre une base Postgres
 * isolée, avec une API Steam ENTIÈREMENT simulée (`fetch` mocké : aucun appel
 * réseau réel, aucune vraie clé). Nécessite `TEST_DATABASE_URL` — suite
 * entièrement SKIPPÉE si absente.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const { currentUserMock } = vi.hoisted(() => ({ currentUserMock: vi.fn() }));

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});
vi.mock("@/lib/current-user", () => ({ getCurrentUser: currentUserMock }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  // Rendu serveur statique de la page : pas de routeur monté (PullToRefresh).
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/potes",
}));

if (!TEST_DATABASE_URL) {
  console.warn("[steam-now-playing.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE.");
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe.skipIf(!TEST_DATABASE_URL)("En jeu maintenant (Postgres isolée + Steam simulé)", () => {
  let db: import("@prisma/client").PrismaClient;
  let nowPlayingLib: typeof import("./steam-now-playing");
  let fetchMock: ReturnType<typeof vi.fn>;
  /** steamId → jeu en cours (null = pas en jeu, absent = pas dans la réponse). */
  let playing: Map<string, string | null>;
  let summariesStatus: number;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as import("@prisma/client").PrismaClient;
    nowPlayingLib = await import("./steam-now-playing");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(`TRUNCATE "User" CASCADE`);
    playing = new Map();
    summariesStatus = 200;
    fetchMock = vi.fn(async (input: URL | string) => {
      const url = new URL(String(input));
      if (url.pathname.includes("GetPlayerSummaries")) {
        if (summariesStatus !== 200) return json({}, summariesStatus);
        const ids = (url.searchParams.get("steamids") ?? "").split(",");
        return json({
          response: {
            players: ids
              .filter((id) => playing.has(id))
              .map((id) => ({ steamid: id, ...(playing.get(id) ? { gameextrainfo: playing.get(id) } : {}) })),
          },
        });
      }
      if (url.pathname.includes("GetOwnedGames")) {
        return json({ response: { game_count: 1, games: [{ appid: 1, name: "Jeu" }] } });
      }
      if (url.pathname.includes("GetRecentlyPlayedGames")) {
        return json({ response: { total_count: 1, games: [{ appid: 1, name: "Mario Kart", playtime_2weeks: 30 }] } });
      }
      throw new Error(`appel Steam inattendu : ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("STEAM_API_KEY", "clé-de-test-jamais-réelle");
    vi.stubEnv("CRON_SECRET", "secret-de-test");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const summariesCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("GetPlayerSummaries"));

  let counter = 0;
  async function makeUser(overrides: Partial<{ steamId64: string | null; discordName: string; steamNowPlaying: string; steamNowPlayingSeenAt: Date; lastPlayedGame: string }> = {}) {
    counter += 1;
    return db.user.create({
      data: {
        discordId: `now-${counter}`,
        discordName: overrides.discordName ?? `Pote ${counter}`,
        steamId64: "steamId64" in overrides ? overrides.steamId64 : `7656119800000${String(counter).padStart(4, "0")}`,
        steamNowPlaying: overrides.steamNowPlaying ?? null,
        steamNowPlayingSeenAt: overrides.steamNowPlayingSeenAt ?? null,
        lastPlayedGame: overrides.lastPlayedGame ?? null,
      },
    });
  }

  const row = (id: string) => db.user.findUniqueOrThrow({ where: { id } });
  const asList = (users: Array<{ id: string; steamId64: string | null }>) => users.map(({ id, steamId64 }) => ({ id, steamId64 }));

  describe("drapeau éteint (défaut) : rien ne se passe", () => {
    it("refreshSteamNowPlaying : aucun appel Steam, aucune écriture", async () => {
      const user = await makeUser();
      playing.set(user.steamId64!, "Rocket League");

      expect(await nowPlayingLib.refreshSteamNowPlaying(asList([user]))).toEqual({ enabled: false, checked: 0, playing: 0, error: false });

      expect(fetchMock).not.toHaveBeenCalled();
      expect((await row(user.id)).steamNowPlaying).toBeNull();
    });

    it("la route cron ne fait AUCUN appel GetPlayerSummaries (activité inchangée)", async () => {
      const user = await makeUser();
      playing.set(user.steamId64!, "Rocket League");
      const route = await import("@/app/api/cron/steam-library-sync/route");

      const response = await route.GET(
        new Request("https://example.test/api/cron/steam-library-sync", { headers: { authorization: "Bearer secret-de-test" } })
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.nowPlaying).toEqual({ enabled: false, checked: 0, playing: 0, error: false });
      expect(summariesCalls()).toHaveLength(0);
      expect((await row(user.id)).steamNowPlaying).toBeNull();
      expect((await row(user.id)).lastPlayedGame).toBe("Mario Kart");
    });
  });

  describe("drapeau actif — refreshSteamNowPlaying", () => {
    beforeEach(() => vi.stubEnv(nowPlayingLib.NOW_PLAYING_FLAG, "true"));

    it("sept comptes déjà inactifs : une lecture groupée, aucune écriture", async () => {
      const users = [];
      for (let i = 0; i < 7; i += 1) {
        const user = await makeUser();
        users.push(user);
        playing.set(user.steamId64!, null);
      }
      const read = vi.spyOn(db.user, "findMany");
      const write = vi.spyOn(db.user, "update");

      expect(await nowPlayingLib.refreshSteamNowPlaying(asList(users))).toEqual({
        enabled: true, checked: 7, playing: 0, error: false,
      });
      expect(read).toHaveBeenCalledTimes(1);
      expect(write).not.toHaveBeenCalled();
      expect(summariesCalls()).toHaveLength(1);
      for (const user of users) {
        const after = await row(user.id);
        expect(after.steamNowPlaying).toBeNull();
        expect(after.steamNowPlayingSeenAt).toBeNull();
      }
    });

    it("le même jeu actif renouvelle l'horodatage et reste récent", async () => {
      const old = new Date(Date.now() - 9 * 60_000);
      const user = await makeUser({ steamNowPlaying: "Rocket League", steamNowPlayingSeenAt: old });
      playing.set(user.steamId64!, "Rocket League");

      expect(await nowPlayingLib.refreshSteamNowPlaying(asList([user]))).toEqual({
        enabled: true, checked: 1, playing: 1, error: false,
      });
      const after = await row(user.id);
      expect(after.steamNowPlayingSeenAt!.getTime()).toBeGreaterThan(old.getTime());
      expect(nowPlayingLib.activeNowPlaying(after.steamNowPlaying, after.steamNowPlayingSeenAt, Date.now())).toBe("Rocket League");
    });

    it("échec de lecture en base : résultat en erreur et observation préservée", async () => {
      const at = new Date();
      const user = await makeUser({ steamNowPlaying: "Rocket League", steamNowPlayingSeenAt: at });
      playing.set(user.steamId64!, null);
      vi.spyOn(db.user, "findMany").mockRejectedValueOnce(new Error("lecture indisponible"));
      const write = vi.spyOn(db.user, "update");

      expect(await nowPlayingLib.refreshSteamNowPlaying(asList([user]))).toEqual({
        enabled: true, checked: 0, playing: 0, error: true,
      });
      expect(write).not.toHaveBeenCalled();
      const after = await row(user.id);
      expect(after.steamNowPlaying).toBe("Rocket League");
      expect(after.steamNowPlayingSeenAt!.getTime()).toBe(at.getTime());
    });

    it("Steam relié ailleurs pendant la lecture : aucune observation de l'ancien compte écrite", async () => {
      const user = await makeUser();
      const newSteamId = "76561198888888888";
      playing.set(user.steamId64!, "Ancien jeu");
      const originalRead = db.user.findMany.bind(db.user);
      vi.spyOn(db.user, "findMany").mockImplementationOnce((args) => {
        const pending = originalRead(args);
        return pending.then(async (rows) => {
          await db.user.update({ where: { id: user.id }, data: { steamId64: newSteamId } });
          return rows;
        }) as typeof pending;
      });

      expect(await nowPlayingLib.refreshSteamNowPlaying(asList([user]))).toEqual({
        enabled: true, checked: 0, playing: 0, error: true,
      });
      const after = await row(user.id);
      expect(after.steamId64).toBe(newSteamId);
      expect(after.steamNowPlaying).toBeNull();
      expect(after.steamNowPlayingSeenAt).toBeNull();
    });

    it("en jeu → nom + horodatage réel ; plus en jeu → remis à null", async () => {
      const user = await makeUser();
      playing.set(user.steamId64!, "Rocket League");
      const before = Date.now();

      expect(await nowPlayingLib.refreshSteamNowPlaying(asList([user]))).toEqual({ enabled: true, checked: 1, playing: 1, error: false });
      const first = await row(user.id);
      expect(first.steamNowPlaying).toBe("Rocket League");
      expect(first.steamNowPlayingSeenAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(first.steamNowPlayingSeenAt!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);

      playing.set(user.steamId64!, null);
      expect((await nowPlayingLib.refreshSteamNowPlaying(asList([user]))).playing).toBe(0);
      const second = await row(user.id);
      expect(second.steamNowPlaying).toBeNull();
      expect(second.steamNowPlayingSeenAt).toBeNull();
    });

    it("un seul appel groupé pour tous les comptes liés ; les comptes sans Steam sont ignorés", async () => {
      const a = await makeUser();
      const b = await makeUser();
      const noSteam = await makeUser({ steamId64: null });
      playing.set(a.steamId64!, "A");
      playing.set(b.steamId64!, null);

      await nowPlayingLib.refreshSteamNowPlaying(asList([a, b, noSteam]));

      expect(summariesCalls()).toHaveLength(1);
      expect(new URL(String(summariesCalls()[0][0])).searchParams.get("steamids")).toBe(`${a.steamId64},${b.steamId64}`);
      expect((await row(a.id)).steamNowPlaying).toBe("A");
      expect((await row(noSteam.id)).steamNowPlaying).toBeNull();
    });

    it("aucun compte lié : aucun appel", async () => {
      expect(await nowPlayingLib.refreshSteamNowPlaying([])).toEqual({ enabled: true, checked: 0, playing: 0, error: false });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("échec Steam (429) : rien n'est écrit, l'état précédent reste (il s'éteindra par péremption)", async () => {
      const seenAt = new Date();
      const user = await makeUser({ steamNowPlaying: "Rocket League", steamNowPlayingSeenAt: seenAt });
      summariesStatus = 429;

      expect(await nowPlayingLib.refreshSteamNowPlaying(asList([user]))).toEqual({ enabled: true, checked: 0, playing: 0, error: true });

      const after = await row(user.id);
      expect(after.steamNowPlaying).toBe("Rocket League");
      expect(after.steamNowPlayingSeenAt!.getTime()).toBe(seenAt.getTime());
    });

    it("compte absent de la réponse Steam : état inchangé (jamais interprété comme « pas en jeu »)", async () => {
      const user = await makeUser({ steamNowPlaying: "Rocket League", steamNowPlayingSeenAt: new Date() });

      const result = await nowPlayingLib.refreshSteamNowPlaying(asList([user]));

      expect(result.checked).toBe(0);
      expect((await row(user.id)).steamNowPlaying).toBe("Rocket League");
    });

    it("un compte supprimé entre-temps n'empêche pas les autres (erreur journalisée, jamais avalée)", async () => {
      const real = await makeUser();
      playing.set(real.steamId64!, "Rocket League");
      playing.set("76561198999999999", "Fantôme");

      const result = await nowPlayingLib.refreshSteamNowPlaying([
        { id: "compte-supprime", steamId64: "76561198999999999" },
        { id: real.id, steamId64: real.steamId64 },
      ]);

      expect(result).toEqual({ enabled: true, checked: 1, playing: 1, error: true });
      expect((await row(real.id)).steamNowPlaying).toBe("Rocket League");
    });
  });

  describe("drapeau actif — route /api/cron/steam-library-sync", () => {
    beforeEach(() => vi.stubEnv(nowPlayingLib.NOW_PLAYING_FLAG, "true"));

    async function callRoute() {
      const route = await import("@/app/api/cron/steam-library-sync/route");
      return route.GET(
        new Request("https://example.test/api/cron/steam-library-sync", { headers: { authorization: "Bearer secret-de-test" } })
      );
    }

    it("écrit l'état en jeu EN PLUS de l'activité habituelle, avec un seul appel groupé", async () => {
      const a = await makeUser();
      const b = await makeUser();
      playing.set(a.steamId64!, "Rocket League");
      playing.set(b.steamId64!, null);

      const body = await (await callRoute()).json();

      expect(body.nowPlaying).toEqual({ enabled: true, checked: 2, playing: 1, error: false });
      expect(summariesCalls()).toHaveLength(1);
      expect((await row(a.id)).steamNowPlaying).toBe("Rocket League");
      expect((await row(b.id)).steamNowPlaying).toBeNull();
      expect((await row(a.id)).lastPlayedGame).toBe("Mario Kart");
      expect(body.summary).toMatchObject({ approximate: 2 });
    });

    it("GetPlayerSummaries en échec : l'activité habituelle est rafraîchie quand même, la route répond 200", async () => {
      const user = await makeUser();
      summariesStatus = 500;

      const response = await callRoute();

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.nowPlaying).toMatchObject({ enabled: true, error: true });
      expect(body.summary).toMatchObject({ approximate: 1 });
      expect((await row(user.id)).lastPlayedGame).toBe("Mario Kart");
    });
  });

  describe("page /potes", () => {
    async function renderPotes() {
      const { default: PotesPage } = await import("@/app/potes/page");
      return renderToStaticMarkup(await PotesPage());
    }

    beforeEach(async () => {
      const me = await makeUser({ discordName: "Moi" });
      currentUserMock.mockResolvedValue(me);
    });

    it("drapeau éteint : jamais d'indicateur, même avec une observation récente en base", async () => {
      await makeUser({ discordName: "Yuichiro", steamNowPlaying: "Rocket League", steamNowPlayingSeenAt: new Date() });
      expect(await renderPotes()).not.toContain("En jeu");
    });

    it("drapeau actif + observation récente : « En jeu · jeu » à la place de la ligne d'activité passée", async () => {
      vi.stubEnv(nowPlayingLib.NOW_PLAYING_FLAG, "true");
      await makeUser({
        discordName: "Yuichiro",
        steamNowPlaying: "Rocket League",
        steamNowPlayingSeenAt: new Date(),
        lastPlayedGame: "Ancien jeu",
      });

      const html = await renderPotes();

      expect(html).toContain("En jeu · Rocket League");
      expect(html).not.toContain("Ancien jeu");
    });

    it("drapeau actif + observation périmée (cron arrêté) : l'indicateur s'éteint, l'activité passée reste", async () => {
      vi.stubEnv(nowPlayingLib.NOW_PLAYING_FLAG, "true");
      await makeUser({
        discordName: "Yuichiro",
        steamNowPlaying: "Rocket League",
        steamNowPlayingSeenAt: new Date(Date.now() - 3 * 3_600_000),
        lastPlayedGame: "Ancien jeu",
      });

      const html = await renderPotes();

      expect(html).not.toContain("En jeu");
      expect(html).toContain("A joué récemment à Ancien jeu");
    });

    it("pote sans Steam lié : jamais d'indicateur", async () => {
      vi.stubEnv(nowPlayingLib.NOW_PLAYING_FLAG, "true");
      await makeUser({ discordName: "Sans Steam", steamId64: null, steamNowPlaying: "X", steamNowPlayingSeenAt: new Date() });
      expect(await renderPotes()).not.toContain("En jeu");
    });
  });
});
