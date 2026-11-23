import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), build: vi.fn(), rateLimit: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/shared-rate-limit", () => ({ checkSharedRateLimit: mocks.rateLimit }));
vi.mock("@/lib/account-export", async () => {
  const actual = await vi.importActual<typeof import("@/lib/account-export")>("@/lib/account-export");
  return { ...actual, buildAccountExport: mocks.build };
});

import { GET } from "./route";

const EXPORT = {
  format: "gamenight-export-v1" as const,
  generatedAt: "2026-11-21T10:00:00.000Z",
  notice: ["note"],
  compte: { id: "me", discordName: "Alice" },
  donnees: { UserGame: [{ userId: "me", gameId: "g1" }] },
};

describe("/api/compte/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ACCOUNT_DELETION_ENABLED", "true");
    mocks.user.mockResolvedValue({ id: "me" });
    mocks.rateLimit.mockReturnValue(true);
    mocks.build.mockResolvedValue(EXPORT);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("répond 404 CÔTÉ SERVEUR flag éteint, sans lire la session ni les données", async () => {
    for (const value of ["", "false", "TRUE"]) {
      vi.stubEnv("ACCOUNT_DELETION_ENABLED", value);
      expect((await GET()).status).toBe(404);
    }
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.build).not.toHaveBeenCalled();
  });

  it("refuse l'export anonyme avant toute lecture", async () => {
    mocks.user.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(mocks.build).not.toHaveBeenCalled();
  });

  it("n'exporte que la personne connectée et livre un fichier JSON privé, jamais mis en cache", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(mocks.build).toHaveBeenCalledWith("me");
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="gamenight-mes-donnees-2026-11-21.json"');
    expect(JSON.parse(await response.text())).toEqual(EXPORT);
  });

  it("limite le rythme des exports", async () => {
    mocks.rateLimit.mockReturnValue(false);
    expect((await GET()).status).toBe(429);
    expect(mocks.build).not.toHaveBeenCalled();
  });
});
