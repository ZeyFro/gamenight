import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getValidSession, searchIgdbGames } = vi.hoisted(() => ({
  getValidSession: vi.fn(),
  searchIgdbGames: vi.fn(),
}));

vi.mock("@/lib/valid-session", () => ({ getValidSession }));
vi.mock("@/lib/igdb", () => ({ searchIgdbGames }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { GET } from "./route";

/**
 * Même garde que les routes Steam — voir `steam/link/route.test.ts` pour
 * le contexte de la reconnexion forcée globale. Cette route est appelée à
 * chaque frappe côté client, d'où le choix de `getValidSession` (pas
 * `getCurrentUser`) pour éviter touchStreak/badges sur chaque requête.
 */
describe("GET /api/igdb/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("session invalide (reconnexion forcée ou non connecté) → 401, sans appeler IGDB", async () => {
    getValidSession.mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost/api/igdb/search?q=zelda")
    );

    expect(response.status).toBe(401);
    expect(searchIgdbGames).not.toHaveBeenCalled();
  });

  it("session valide → recherche effectuée et résultats renvoyés", async () => {
    getValidSession.mockResolvedValue({ user: { discordId: "user-1" } });
    searchIgdbGames.mockResolvedValue([{ id: 1, name: "Zelda" }]);

    const response = await GET(
      new NextRequest("http://localhost/api/igdb/search?q=zelda")
    );
    const body = await response.json();

    expect(searchIgdbGames).toHaveBeenCalledWith("zelda");
    expect(body).toEqual({ results: [{ id: 1, name: "Zelda" }] });
  });

  it.each(["", "a", "  a  ", "   "])("requête %j trop courte → [] sans appeler IGDB", async (q) => {
    getValidSession.mockResolvedValue({ user: { discordId: "user-1" } });

    const response = await GET(
      new NextRequest(`http://localhost/api/igdb/search?q=${encodeURIComponent(q)}`)
    );

    expect(await response.json()).toEqual({ results: [] });
    expect(searchIgdbGames).not.toHaveBeenCalled();
  });

  it("requête trop longue → tronquée à 100 caractères avant IGDB", async () => {
    getValidSession.mockResolvedValue({ user: { discordId: "user-1" } });
    searchIgdbGames.mockResolvedValue([]);

    await GET(new NextRequest(`http://localhost/api/igdb/search?q=${"z".repeat(500)}`));

    expect(searchIgdbGames).toHaveBeenCalledWith("z".repeat(100));
  });

  it("espaces autour de la requête retirés", async () => {
    getValidSession.mockResolvedValue({ user: { discordId: "user-1" } });
    searchIgdbGames.mockResolvedValue([]);

    await GET(new NextRequest("http://localhost/api/igdb/search?q=%20%20zelda%20"));

    expect(searchIgdbGames).toHaveBeenCalledWith("zelda");
  });

  it("IGDB en erreur → 502", async () => {
    getValidSession.mockResolvedValue({ user: { discordId: "user-1" } });
    searchIgdbGames.mockRejectedValue(new Error("IGDB a répondu 500"));

    const response = await GET(new NextRequest("http://localhost/api/igdb/search?q=zelda"));

    expect(response.status).toBe(502);
  });
});
