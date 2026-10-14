import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

const {
  getValidSession,
  verifySteamOpenId,
  importSteamLibrary,
  awardXp,
  userFindUnique,
  userUpdate,
} = vi.hoisted(() => ({
  getValidSession: vi.fn(),
  verifySteamOpenId: vi.fn(),
  importSteamLibrary: vi.fn(),
  awardXp: vi.fn(),
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
}));

vi.mock("@/lib/valid-session", () => ({ getValidSession }));
vi.mock("@/lib/steam", () => ({ verifySteamOpenId, importSteamLibrary }));
vi.mock("@/lib/xp-actions", () => ({ awardXp }));
vi.mock("@/lib/community-stats", () => ({ writeCommunityIdForUser: vi.fn(async () => "community-active") }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: userFindUnique, update: userUpdate } },
}));

import { GET } from "./route";

/**
 * Même garde que `steam/link` — voir ce fichier de test pour le contexte
 * de la reconnexion forcée globale. Le `state` (cookie posé par
 * `steam/link`, répété dans le `return_to` signé par Steam) lie
 * l'assertion OpenID à la session qui a démarré le flux et la rend
 * non rejouable (cookie supprimé à la première utilisation).
 */
describe("GET /api/steam/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const URL_OK = "http://localhost/api/steam/callback?state=abc&openid.mode=id_res";
  const REDIRECT_ERREUR = "http://localhost/profil/parametres?steam=erreur";
  const withCookie = (url: string, state?: string) =>
    new NextRequest(url, state ? { headers: { cookie: `steam_link_state=${state}` } } : undefined);

  it("session invalide (reconnexion forcée ou non connecté) → redirection /, sans toucher Steam ni la base", async () => {
    getValidSession.mockResolvedValue(null);

    const response = await GET(new NextRequest("http://localhost/api/steam/callback"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(verifySteamOpenId).not.toHaveBeenCalled();
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("session valide + state cohérent → vérifie l'assertion avec le return_to attendu, puis importe", async () => {
    getValidSession.mockResolvedValue({ user: { discordId: "user-1" } });
    verifySteamOpenId.mockResolvedValue("76561197960287930");
    userFindUnique.mockResolvedValue({ id: "user-1", steamId64: null });
    userUpdate.mockResolvedValue({ id: "user-1", steamId64: "76561197960287930" });
    importSteamLibrary.mockResolvedValue({ status: "prive" });

    const response = await GET(withCookie(URL_OK, "abc"));

    expect(verifySteamOpenId).toHaveBeenCalledWith(
      expect.any(URLSearchParams),
      "http://localhost/api/steam/callback?state=abc"
    );
    expect(response.headers.get("location")).toBe("http://localhost/profil/parametres?steam=prive");
    expect(awardXp).toHaveBeenCalledWith("user-1", "community-active", "STEAM_LINK_FIRST", "user-1", expect.any(Number));
  });

  it("cookie state absent → erreur, Steam jamais appelé, rien lié", async () => {
    getValidSession.mockResolvedValue({ user: { discordId: "user-1" } });

    const response = await GET(withCookie(URL_OK));

    expect(response.headers.get("location")).toBe(REDIRECT_ERREUR);
    expect(verifySteamOpenId).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("state de l'URL ≠ cookie (assertion forcée dans une autre session) → erreur", async () => {
    getValidSession.mockResolvedValue({ user: { discordId: "user-1" } });

    const response = await GET(withCookie(URL_OK, "autre"));

    expect(response.headers.get("location")).toBe(REDIRECT_ERREUR);
    expect(verifySteamOpenId).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("le state est à usage unique : cookie supprimé dès qu'il est consommé", async () => {
    getValidSession.mockResolvedValue({ user: { discordId: "user-1" } });
    verifySteamOpenId.mockResolvedValue(null);

    const response = await GET(withCookie(URL_OK, "abc"));

    expect(response.headers.get("location")).toBe(REDIRECT_ERREUR);
    expect(response.headers.get("set-cookie") ?? "").toMatch(/steam_link_state=;|Max-Age=0/i);
  });

  it("SteamID déjà lié à un autre compte (contrainte unique) → erreur propre, pas de 500, pas d'import", async () => {
    getValidSession.mockResolvedValue({ user: { discordId: "user-1" } });
    verifySteamOpenId.mockResolvedValue("76561197960287930");
    userFindUnique.mockResolvedValue({ id: "user-1", steamId64: null });
    userUpdate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" })
    );

    const response = await GET(withCookie(URL_OK, "abc"));

    expect(response.headers.get("location")).toBe(REDIRECT_ERREUR);
    expect(importSteamLibrary).not.toHaveBeenCalled();
    expect(awardXp).not.toHaveBeenCalled();
  });
});
