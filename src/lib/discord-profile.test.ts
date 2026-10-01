import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cron de rafraîchissement des avatars/pseudos Discord
 * (`refreshAllDiscordProfiles`) — Prisma, chiffrement et `fetch` simulés,
 * aucun appel réseau réel. Cible : ne jamais marteler l'API Discord quand
 * elle répond 429 (le lot s'arrête, le reste est repris au passage horaire
 * suivant), et ne jamais enchaîner le repli bot derrière un 429 OAuth.
 */

const { prismaMock, fetchMock } = vi.hoisted(() => ({
  prismaMock: { user: { findMany: vi.fn(), update: vi.fn() } },
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/discord-token-crypto", () => ({
  DiscordTokenEncryptionKeyError: class extends Error {},
  getEncryptionKey: () => Buffer.alloc(32),
  encryptToken: (value: string) => value,
  resolveStoredToken: (value: string) => ({ ok: true, value }),
}));

import { refreshAllDiscordProfiles } from "./discord-profile";

function oauthUser(id: string) {
  return {
    discordId: id,
    discordName: `old-${id}`,
    discordAvatar: null,
    discordAccessToken: `access-${id}`,
    discordRefreshToken: `refresh-${id}`,
    discordTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
  };
}

const profileOk = (id: string) =>
  new Response(
    JSON.stringify({ id, username: `new-${id}`, global_name: null, discriminator: "0", avatar: "abc" }),
    { status: 200 }
  );
const rateLimited = () =>
  new Response(JSON.stringify({ message: "rate limited", retry_after: 30 }), {
    status: 429,
    headers: { "Retry-After": "30" },
  });

describe("refreshAllDiscordProfiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DISCORD_CLIENT_ID", "cid");
    vi.stubEnv("DISCORD_CLIENT_SECRET", "secret");
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
  });

  function stubUsers(oauth: ReturnType<typeof oauthUser>[], withoutToken: { discordId: string }[] = []) {
    prismaMock.user.findMany.mockImplementation(async (args: { where: { discordRefreshToken: unknown } }) =>
      args.where.discordRefreshToken === null
        ? withoutToken.map((u) => ({ ...u, discordName: "x", discordAvatar: null }))
        : oauth
    );
  }

  it("chemin nominal : chaque profil modifié est mis à jour (1 appel Discord par user)", async () => {
    stubUsers([oauthUser("1"), oauthUser("2")]);
    fetchMock.mockImplementation(async (url: string) => profileOk(String(url).includes("users/@me") ? "1" : "2"));

    const result = await refreshAllDiscordProfiles();

    expect(result.oauth).toMatchObject({ checked: 2, updated: 2, failed: 0, rateLimited: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("429 sur /users/@me : le lot OAuth s'arrête (aucun appel pour les users suivants) et le repli bot n'est PAS lancé", async () => {
    stubUsers([oauthUser("1"), oauthUser("2"), oauthUser("3")], [{ discordId: "9" }]);
    fetchMock.mockResolvedValue(rateLimited());

    const result = await refreshAllDiscordProfiles();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.oauth.rateLimited).toBe(true);
    expect(result.oauth.updated).toBe(0);
    expect(result.bot.checked).toBe(0);
    expect(result.bot.rateLimited).toBe(false);
  });

  it("429 sur le renouvellement du jeton : le lot s'arrête aussi", async () => {
    const expired = (id: string) => ({ ...oauthUser(id), discordTokenExpiresAt: new Date(Date.now() - 1000) });
    stubUsers([expired("1"), expired("2")]);
    fetchMock.mockResolvedValue(rateLimited());

    const result = await refreshAllDiscordProfiles();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/oauth2/token");
    expect(result.oauth.rateLimited).toBe(true);
  });

  it("429 dans le repli bot : le lot bot s'arrête", async () => {
    stubUsers([], [{ discordId: "7" }, { discordId: "8" }, { discordId: "9" }]);
    fetchMock.mockResolvedValue(rateLimited());

    const result = await refreshAllDiscordProfiles();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.bot.rateLimited).toBe(true);
  });
});
