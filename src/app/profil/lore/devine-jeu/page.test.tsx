import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), games: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/community-content", () => ({ getCommunityQuizGames: mocks.games }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));

import GuessTheGamePage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "viewer" });
  mocks.games.mockResolvedValue([{
    name: "Stardew Valley",
    details: {
      igdbId: 1, name: "Stardew Valley", summary: null, descriptionFr: null, totalRating: null,
      coverUrl: null, screenshotUrls: [], youtubeVideoIds: [], platforms: ["PC"], genres: ["RPG"],
      themes: ["Nature"], releaseDate: "2016-02-26", developers: ["ConcernedApe"], publishers: [],
    },
  }]);
});

describe("/profil/lore/devine-jeu", () => {
  it("redirects anonymous visitors before loading community games", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(GuessTheGamePage()).rejects.toThrow("REDIRECT:/");
    expect(mocks.games).not.toHaveBeenCalled();
  });

  it("builds a puzzle only from the signed-in viewer's community games", async () => {
    const html = renderToStaticMarkup(await GuessTheGamePage());
    expect(mocks.games).toHaveBeenCalledWith("viewer");
    expect(html).toContain("Devine le jeu");
    expect(html).toContain("Genre : RPG");
    expect(html).not.toContain("Stardew Valley");
  });
});
