import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), community: vi.fn(), games: vi.fn(), board: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { game: { findMany: mocks.games } } }));
vi.mock("@/lib/player-classifieds", () => ({ getPlayerClassifiedCommunityId: mocks.community }));
vi.mock("@/lib/tonight", () => ({ getTonightBoard: mocks.board }));
vi.mock("./actions", () => ({ declareTonightAction: vi.fn(), clearTonightAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
}));
import Page from "./page";

const occurrences = (html: string, text: string) => html.split(text).length - 1;

const GAMES = [
  { id: "steam-60", name: "60 Parsecs!", igdbId: null, steamAppId: 646810 },
  { id: "igdb-60", name: "60 parsecs!", igdbId: 112135, steamAppId: null },
  { id: "original", name: "60 Seconds!", igdbId: 1001, steamAppId: null },
  { id: "reatomized", name: "60 Seconds! Reatomized", igdbId: 1002, steamAppId: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WHO_PLAYS_TONIGHT_ENABLED", "true");
  mocks.user.mockResolvedValue({ id: "viewer" });
  mocks.community.mockResolvedValue("community-a");
  mocks.games.mockResolvedValue(GAMES);
  mocks.board.mockResolvedValue({ players: [], myGames: [], sessions: [], instantSessions: [] });
});
afterEach(() => vi.unstubAllEnvs());

describe("sélecteurs de jeux de /ce-soir", () => {
  it("affiche une seule entrée par jeu dans les trois sélecteurs et garde les éditions distinctes", async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));

    expect(occurrences(html, ">60 Parsecs!<")).toBe(3);
    expect(html).not.toContain(">60 parsecs!<");
    expect(occurrences(html, ">60 Seconds!<")).toBe(3);
    expect(occurrences(html, ">60 Seconds! Reatomized<")).toBe(3);
  });

  it("reste indisponible quand le parcours est éteint", async () => {
    vi.stubEnv("WHO_PLAYS_TONIGHT_ENABLED", "false");
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
    expect(mocks.games).not.toHaveBeenCalled();
  });
});
