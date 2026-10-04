import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOW_PLAYING_FLAG,
  NOW_PLAYING_FRESH_MS,
  activeNowPlaying,
  getPlayersNowPlaying,
  isNowPlayingEnabled,
} from "./steam-now-playing";

describe("isNowPlayingEnabled — nouveau drapeau, éteint par défaut", () => {
  it("éteint sans variable", () => {
    expect(isNowPlayingEnabled({})).toBe(false);
  });

  it("actif seulement avec exactement `true`", () => {
    expect(isNowPlayingEnabled({ [NOW_PLAYING_FLAG]: "true" })).toBe(true);
  });

  it.each(["TRUE", "True", "1", "yes", " true", "true ", "false", ""])("la valeur %j n'active pas le drapeau", (value) => {
    expect(isNowPlayingEnabled({ [NOW_PLAYING_FLAG]: value })).toBe(false);
  });
});

describe("activeNowPlaying — jamais « en jeu » sur une observation périmée", () => {
  const now = Date.parse("2026-10-04T12:00:00Z");
  const seen = (msAgo: number) => new Date(now - msAgo);

  it("observation récente : le jeu est affiché", () => {
    expect(activeNowPlaying("Rocket League", seen(60_000), now)).toBe("Rocket League");
  });

  it("à la limite exacte : encore affiché ; une milliseconde de plus : éteint", () => {
    expect(activeNowPlaying("X", seen(NOW_PLAYING_FRESH_MS), now)).toBe("X");
    expect(activeNowPlaying("X", seen(NOW_PLAYING_FRESH_MS + 1), now)).toBeNull();
  });

  it("cron arrêté (observation vieille de plusieurs heures) : éteint", () => {
    expect(activeNowPlaying("X", seen(5 * 3_600_000), now)).toBeNull();
  });

  it("horodatage dans le futur (horloge décalée) : invalide", () => {
    expect(activeNowPlaying("X", new Date(now + 60_000), now)).toBeNull();
  });

  it.each([
    [null, new Date(now)],
    ["", new Date(now)],
    [undefined, new Date(now)],
    ["X", null],
    ["X", undefined],
  ])("jeu %j / observation %j : rien", (game, at) => {
    expect(activeNowPlaying(game, at, now)).toBeNull();
  });
});

describe("getPlayersNowPlaying (Steam simulé, aucun appel réel)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("STEAM_API_KEY", "clé-de-test-jamais-réelle");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const reply = (players: unknown[], status = 200) => new Response(JSON.stringify({ response: { players } }), { status });

  it("jeu en cours → nom ; pas en jeu → null ; nom vide → null", async () => {
    fetchMock.mockResolvedValueOnce(
      reply([
        { steamid: "1", gameextrainfo: "Rocket League", gameid: "252950" },
        { steamid: "2", personaname: "au repos" },
        { steamid: "3", gameextrainfo: "   " },
      ])
    );
    const result = await getPlayersNowPlaying(["1", "2", "3"]);
    expect([...result.entries()]).toEqual([
      ["1", "Rocket League"],
      ["2", null],
      ["3", null],
    ]);
  });

  it("un compte absent de la réponse n'est PAS interprété comme « pas en jeu »", async () => {
    fetchMock.mockResolvedValueOnce(reply([{ steamid: "1", gameextrainfo: "A" }]));
    const result = await getPlayersNowPlaying(["1", "2"]);
    expect(result.has("1")).toBe(true);
    expect(result.has("2")).toBe(false);
  });

  it("un seul appel groupé, identifiants joints par des virgules, clé jamais loguée ailleurs que dans la requête", async () => {
    fetchMock.mockResolvedValueOnce(reply([]));
    await getPlayersNowPlaying(["10", "20", "30"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/ISteamUser/GetPlayerSummaries/v0002/");
    expect(url.searchParams.get("steamids")).toBe("10,20,30");
  });

  it("plus de 100 comptes : lots de 100 (limite de l'API Steam)", async () => {
    fetchMock.mockImplementation(async () => reply([]));
    await getPlayersNowPlaying(Array.from({ length: 205 }, (_, i) => String(i)));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const sizes = fetchMock.mock.calls.map(([u]) => new URL(String(u)).searchParams.get("steamids")!.split(",").length);
    expect(sizes).toEqual([100, 100, 5]);
  });

  it("réponse HTTP en erreur : lève (rien n'est écrit par l'appelant)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 429 }));
    await expect(getPlayersNowPlaying(["1"])).rejects.toThrow("GetPlayerSummaries a répondu 429");
  });

  it("clé Steam absente : lève avant tout appel réseau", async () => {
    vi.stubEnv("STEAM_API_KEY", "");
    await expect(getPlayersNowPlaying(["1"])).rejects.toThrow("STEAM_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("réponse sans joueurs : Map vide", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ response: {} }), { status: 200 }));
    expect((await getPlayersNowPlaying(["1"])).size).toBe(0);
  });
});
