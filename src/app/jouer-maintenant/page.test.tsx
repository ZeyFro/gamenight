import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), games: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/prisma", () => ({
  prisma: { game: { findMany: mocks.games }, user: { findMany: vi.fn().mockResolvedValue([]) } },
}));
vi.mock("@/lib/instant-sessions", () => ({
  listActiveInstantSessions: vi.fn().mockResolvedValue([]),
  getActiveInstantSessionForUser: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/community-isolation", () => ({ creationMemberUserWhere: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/game-ping-optin", () => ({ isNotificationCenterEnabled: () => false }));
// Le sélecteur client est remplacé par un rendu minimal : ce test vérifie les
// options que la PAGE lui transmet, pas son interaction (couverte par
// lib/game-search.test.ts).
vi.mock("@/components/jouer-maintenant/InstantSessionCreateForm", () => ({
  InstantSessionCreateForm: ({ localGames }: { localGames: Array<{ id: string; name: string }> }) => (
    <ul>{localGames.map((game): ReactNode => <li key={game.id}>{game.name}</li>)}</ul>
  ),
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
import Page from "./page";

const occurrences = (html: string, text: string) => html.split(text).length - 1;

const GAMES = [
  { id: "steam-60", name: "60 Parsecs!", igdbId: null, steamAppId: 646810 },
  { id: "igdb-60", name: "60 parsecs!", igdbId: 112135, steamAppId: null },
  { id: "original", name: "60 Seconds!", igdbId: 1001, steamAppId: null },
  { id: "reatomized", name: "60 Seconds! Reatomized", igdbId: 1002, steamAppId: null },
];

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "viewer" });
  mocks.games.mockResolvedValue(GAMES);
});

describe("sélecteur de jeu de /jouer-maintenant", () => {
  it("reçoit une seule entrée par jeu et garde les éditions distinctes", async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));

    expect(occurrences(html, ">60 Parsecs!<")).toBe(1);
    expect(html).not.toContain(">60 parsecs!<");
    expect(occurrences(html, ">60 Seconds!<")).toBe(1);
    expect(occurrences(html, ">60 Seconds! Reatomized<")).toBe(1);
  });

  it("affiche la limite de 2 h quand les rivalités sont activées", async () => {
    vi.stubEnv("TEAM_RIVALRIES_ENABLED", "true");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("2 h maximum");
    expect(html).not.toContain("3 h maximum");
  });

  it("conserve la limite de 3 h quand les rivalités sont désactivées", async () => {
    vi.stubEnv("TEAM_RIVALRIES_ENABLED", "false");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("3 h maximum");
    expect(html).not.toContain("2 h maximum");
  });
});
