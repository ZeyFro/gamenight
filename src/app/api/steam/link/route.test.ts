import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getValidSession, getSteamAuthUrl } = vi.hoisted(() => ({
  getValidSession: vi.fn(),
  getSteamAuthUrl: vi.fn(),
}));

vi.mock("@/lib/valid-session", () => ({ getValidSession }));
vi.mock("@/lib/steam", () => ({ getSteamAuthUrl }));

import { GET } from "./route";

/**
 * `getValidSession` (auth() + reconnexion forcée globale, voir
 * `src/lib/valid-session.ts`) doit gater cette route au même titre que
 * les pages protégées par `getCurrentUser` — un pote déconnecté de force
 * ne doit pas pouvoir démarrer un lien Steam.
 */
describe("GET /api/steam/link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("session invalide (reconnexion forcée ou non connecté) → redirection /", async () => {
    getValidSession.mockResolvedValue(null);

    const response = await GET(new NextRequest("http://localhost/api/steam/link"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(getSteamAuthUrl).not.toHaveBeenCalled();
  });

  it("session valide → redirection vers l'URL d'auth Steam", async () => {
    getValidSession.mockResolvedValue({ user: { discordId: "user-1" } });
    getSteamAuthUrl.mockReturnValue("https://steamcommunity.com/openid/login?fake=1");

    const response = await GET(new NextRequest("http://localhost/api/steam/link"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://steamcommunity.com/openid/login?fake=1"
    );
    expect(getSteamAuthUrl).toHaveBeenCalledWith("http://localhost/api/steam/callback");
  });
});
