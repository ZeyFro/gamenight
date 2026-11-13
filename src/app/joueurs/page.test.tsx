import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), community: vi.fn(), games: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { game: { findMany: mocks.games } } }));
vi.mock("@/lib/player-classifieds", () => ({ getPlayerClassifiedCommunityId: mocks.community, listPlayerClassifieds: mocks.list }));
vi.mock("./actions", () => ({ createPlayerClassifiedAction: vi.fn(), deletePlayerClassifiedAction: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
import Page from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "viewer" });
  mocks.community.mockResolvedValue("community-a");
  mocks.games.mockResolvedValue([{ id: "game-1", name: "Minecraft" }, { id: "game-2", name: "Minecraft" }]);
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
