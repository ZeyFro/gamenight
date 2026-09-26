import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: userFindUnique, update: userUpdate } },
}));

import { GET } from "./route";

/**
 * Même garde que `steam/link` — voir ce fichier de test pour le contexte
 * de la reconnexion forcée globale. Le reste de la logique métier de ce
 * callback (import de bibliothèque, XP première liaison) est hors scope
 * de cette PR ; seul le comportement de la porte d'authentification est
 * vérifié ici.
 */
describe("GET /api/steam/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("session invalide (reconnexion forcée ou non connecté) → redirection /, sans toucher Steam ni la base", async () => {
    getValidSession.mockResolvedValue(null);

    const response = await GET(new NextRequest("http://localhost/api/steam/callback"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/");
    expect(verifySteamOpenId).not.toHaveBeenCalled();
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("session valide → poursuit le flux (vérification OpenID puis import)", async () => {
    getValidSession.mockResolvedValue({ user: { discordId: "user-1" } });
    verifySteamOpenId.mockResolvedValue("76561197960287930");
    userFindUnique.mockResolvedValue({ id: "user-1", steamId64: null });
    userUpdate.mockResolvedValue({ id: "user-1", steamId64: "76561197960287930" });
    importSteamLibrary.mockResolvedValue({ status: "prive" });

    const response = await GET(new NextRequest("http://localhost/api/steam/callback"));

    expect(verifySteamOpenId).toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "http://localhost/profil/parametres?steam=prive"
    );
  });
});
