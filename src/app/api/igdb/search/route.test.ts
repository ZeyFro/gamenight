import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getValidSession, searchIgdbGames } = vi.hoisted(() => ({
  getValidSession: vi.fn(),
  searchIgdbGames: vi.fn(),
}));

vi.mock("@/lib/valid-session", () => ({ getValidSession }));
vi.mock("@/lib/igdb", () => ({ searchIgdbGames }));

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
});
