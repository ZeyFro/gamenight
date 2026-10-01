import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Callback `jwt` d'Auth.js (src/auth.ts) — non-régression « spam de l'API
 * Discord ». `auth()` appelé sans argument (composants serveur, server
 * actions, donc via `getCurrentUser`) NE RÉÉCRIT PAS le cookie de session :
 * Auth.js jette les `Set-Cookie` de cette réponse (next-auth/lib/index.js,
 * `getSession(...).then(parseSessionResponse)`). Un `token.discordSyncedAt =
 * Date.now()` posé dans le callback n'est donc JAMAIS persisté, et le même
 * JWT « périmé » repasse dans le callback à chaque appel. Un rafraîchissement
 * Discord déclenché depuis ce callback partirait donc à CHAQUE requête
 * authentifiée, pour chaque utilisateur, passé 12 h de session. Le
 * rafraîchissement périodique est porté par le cron horaire
 * `/api/cron/refresh-discord-profiles`, pas par ce callback.
 */

type JwtCallback = (args: {
  token: Record<string, unknown>;
  profile?: unknown;
  account?: unknown;
}) => Promise<Record<string, unknown>>;

const { captured, fetchMock } = vi.hoisted(() => ({
  captured: { config: null as null | { callbacks: { jwt: JwtCallback } } },
  fetchMock: vi.fn(),
}));

vi.mock("next-auth", () => ({
  default: (config: { callbacks: { jwt: JwtCallback } }) => {
    captured.config = config;
    return { handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() };
  },
}));
vi.mock("next-auth/providers/discord", () => ({ default: () => ({ id: "discord" }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { update: vi.fn(), upsert: vi.fn() } },
}));

describe("auth.ts — callback jwt", () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await import("./auth");
  });

  it("session ancienne (> 12 h) : aucun appel à l'API Discord, quel que soit le nombre d'appels à auth()", async () => {
    const staleToken = {
      discordId: "123",
      discordAccessToken: "tok",
      discordSyncedAt: Date.now() - 48 * 60 * 60 * 1000,
    };

    // Le cookie n'est jamais réécrit : le même token périmé revient à chaque appel.
    for (let i = 0; i < 5; i++) {
      await captured.config!.callbacks.jwt({ token: { ...staleToken } });
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
