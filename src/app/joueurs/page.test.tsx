import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GAME_LEVELS } from "@/lib/game-levels-rules";

const mocks = vi.hoisted(() => ({ user: vi.fn(), community: vi.fn(), games: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { game: { findMany: mocks.games } } }));
vi.mock("@/lib/player-classifieds", () => ({ getPlayerClassifiedCommunityId: mocks.community, listPlayerClassifieds: mocks.list }));
vi.mock("./actions", () => ({ createPlayerClassifiedAction: vi.fn(), deletePlayerClassifiedAction: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
import Page from "./page";

const occurrences = (html: string, text: string) => html.split(text).length - 1;

// Deux vrais jeux distincts (fiches IGDB différentes), un même jeu en deux
// lignes (import Steam + fiche IGDB) et deux éditions au titre proche.
const GAMES = [
  { id: "game-1", name: "Minecraft", igdbId: 11, steamAppId: null },
  { id: "game-2", name: "Minecraft", igdbId: 22, steamAppId: null },
  { id: "steam-60", name: "60 Parsecs!", igdbId: null, steamAppId: 646810 },
  { id: "igdb-60", name: "60 parsecs!", igdbId: 112135, steamAppId: null },
  { id: "original", name: "60 Seconds!", igdbId: 1001, steamAppId: null },
  { id: "reatomized", name: "60 Seconds! Reatomized", igdbId: 1002, steamAppId: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mocks.user.mockResolvedValue({ id: "viewer" });
  mocks.community.mockResolvedValue("community-a");
  mocks.games.mockResolvedValue(GAMES);
  mocks.list.mockResolvedValue([]);
});

describe("recherche /joueurs", () => {
  it("transmet les filtres validés au serveur et conserve les choix", async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ gameId: "game-2", platform: "WINDOWS", microphone: "no" }) }));
    expect(mocks.list).toHaveBeenCalledWith("viewer", "community-a", expect.any(Date), { gameId: "game-2", platform: "WINDOWS", microphone: "no" });
    expect(html).toContain('value="game-2" selected=""');
    expect(html).toContain('value="no" selected=""');
    expect(html).toContain("Aucune annonce ne correspond aux filtres.");
    expect(html).toContain("Réinitialiser les filtres");
    expect(html).toContain("Non renseigné");
  });
  it("refuse une requête invalide sans élargir les résultats", async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ microphone: "forged" }) }));
    expect(mocks.list).not.toHaveBeenCalled();
    expect(html).toContain("Les filtres sont invalides");
  });
  it("conserve l'état vide sans filtre", async () => {
    expect(renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))).toContain("Aucune annonce en cours.");
  });
  it("ne charge aucune annonce pour une communauté indisponible", async () => {
    mocks.community.mockResolvedValue(null);
    await Page({ searchParams: Promise.resolve({}) });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.games).not.toHaveBeenCalled();
  });
});

describe("filtres de niveau de /joueurs (C035)", () => {
  beforeEach(() => {
    // Les deux interrupteurs allumés reproduisent la Production : c'est la
    // combinaison qui émettait deux champs `level` et invalidait la requête.
    vi.stubEnv("GAME_LEVELS_ENABLED", "true");
    vi.stubEnv("GAME_LEVELS_MATCHMAKING_ENABLED", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("accepte un jeu seul et n'affiche aucun filtre invalide", async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ gameId: "game-1" }) }));

    expect(html).not.toContain("Les filtres sont invalides");
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith("viewer", "community-a", expect.any(Date), { gameId: "game-1" });
  });

  it.each(GAME_LEVELS)("accepte le niveau %s associé à un jeu", async (level) => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ gameId: "game-1", level }) }));

    expect(html).not.toContain("Les filtres sont invalides");
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith("viewer", "community-a", expect.any(Date), { gameId: "game-1", level });
    expect(html).toContain(`value="${level}" selected=""`);
  });

  it("combine le jeu, le niveau et la comparaison exacte", async () => {
    const html = renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve({ gameId: "game-1", level: "CONFIRME", levelMatch: "exact" }) })
    );

    expect(html).not.toContain("Les filtres sont invalides");
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(
      "viewer",
      "community-a",
      expect.any(Date),
      { gameId: "game-1", level: "CONFIRME", levelMatch: "exact" }
    );
    expect(html).toContain('value="CONFIRME" selected=""');
    expect(html).toContain('value="exact" selected=""');
  });

  it("garde « ce niveau ou plus » par défaut, sans second champ level", async () => {
    const html = renderToStaticMarkup(
      await Page({ searchParams: Promise.resolve({ gameId: "game-1", level: "INTERMEDIAIRE" }) })
    );

    // Un seul champ `level` (et un seul id) : l'URL ne peut plus porter deux valeurs.
    expect(html.match(/name="level"/g)).toHaveLength(1);
    expect(html.match(/id="filter-level"/g)).toHaveLength(1);
    expect(html).toContain("Ce niveau ou plus");
    expect(html).toContain("Ce niveau exactement");
  });

  it("refuse toujours un niveau sans jeu, sans élargir les résultats", async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ level: "DEBUTANT" }) }));

    expect(mocks.list).not.toHaveBeenCalled();
    expect(html).toContain("Les filtres sont invalides");
  });
});

describe("sélecteurs de jeux de /joueurs", () => {
  it("affiche une seule entrée par jeu dans la création et le filtre, sans fusionner les éditions", async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));

    // Création + filtre : deux sélecteurs, donc deux occurrences de chaque titre.
    expect(occurrences(html, ">60 Parsecs!<")).toBe(2);
    expect(html).not.toContain(">60 parsecs!<");
    expect(occurrences(html, ">60 Seconds!<")).toBe(2);
    expect(occurrences(html, ">60 Seconds! Reatomized<")).toBe(2);
    // Deux « Minecraft » de fiches IGDB différentes restent deux jeux.
    expect(occurrences(html, ">Minecraft<")).toBe(4);
  });

  it("le filtre par jeu replié couvre les deux lignes sans élargir aux autres jeux", async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ gameId: "steam-60" }) }));

    expect(mocks.list).toHaveBeenCalledWith(
      "viewer",
      "community-a",
      expect.any(Date),
      expect.objectContaining({ gameId: "steam-60", gameIds: ["steam-60", "igdb-60"] })
    );
    expect(html).toContain('value="steam-60" selected=""');
    expect(html).not.toContain('value="igdb-60"');
  });

  it("un lien de filtre sur la ligne repliée sélectionne l'entrée canonique", async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ gameId: "igdb-60" }) }));

    expect(mocks.list).toHaveBeenCalledWith(
      "viewer",
      "community-a",
      expect.any(Date),
      expect.objectContaining({ gameId: "igdb-60", gameIds: ["steam-60", "igdb-60"] })
    );
    expect(html).toContain('value="steam-60" selected=""');
  });
});
