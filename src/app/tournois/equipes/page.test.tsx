import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), community: vi.fn(), games: vi.fn(), tournaments: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/tournament-teams", () => ({ getTournamentTeamsCommunityId: mocks.community }));
vi.mock("@/lib/prisma", () => ({ prisma: { game: { findMany: mocks.games } } }));
vi.mock("@/lib/community-scoped-client", () => ({
  getScopedPrisma: async () => ({ tournament: { findMany: mocks.tournaments } }),
}));
vi.mock("./actions", () => ({ createTeamTournamentAction: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
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
  mocks.user.mockResolvedValue({ id: "viewer" });
  mocks.community.mockResolvedValue("community-a");
  mocks.games.mockResolvedValue(GAMES);
  mocks.tournaments.mockResolvedValue([]);
});

describe("sélecteur de jeu de /tournois/equipes", () => {
  it("affiche une seule entrée par jeu et garde les éditions distinctes", async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));

    expect(occurrences(html, ">60 Parsecs!<")).toBe(1);
    expect(html).not.toContain(">60 parsecs!<");
    expect(occurrences(html, ">60 Seconds!<")).toBe(1);
    expect(occurrences(html, ">60 Seconds! Reatomized<")).toBe(1);
  });
});
