import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Callback `signIn` d'Auth.js (src/auth.ts) — porte d'accès
 * `AUTH_REQUIRE_GUILD_MEMBER` : refuse un NOUVEAU compte non membre du
 * serveur Discord. Désactivée par défaut ; fail-closed pour les nouveaux
 * comptes ; les comptes existants et `ADMIN_DISCORD_IDS` passent toujours.
 */

type SignInCallback = (args: {
  user: { name?: string; image?: string };
  profile?: { id?: string; username?: string };
}) => Promise<boolean>;

const { captured, fetchMock, findUnique, upsert } = vi.hoisted(() => ({
  captured: { config: null as null | { callbacks: { signIn: SignInCallback } } },
  fetchMock: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("next-auth", () => ({
  default: (config: { callbacks: { signIn: SignInCallback } }) => {
    captured.config = config;
    return { handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() };
  },
}));
vi.mock("next-auth/providers/discord", () => ({ default: () => ({ id: "discord" }) }));
vi.mock("@/lib/prisma", () => ({
  prisma: { user: { update: vi.fn(), upsert, findUnique } },
}));

const NEW_USER = { id: "222", username: "nouveau" };

describe("auth.ts — callback signIn (AUTH_REQUIRE_GUILD_MEMBER)", () => {
  let signIn: SignInCallback;

  beforeEach(async () => {
    fetchMock.mockReset();
    findUnique.mockReset().mockResolvedValue(null);
    upsert.mockReset().mockResolvedValue({});
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-secret");
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "111");
    vi.stubEnv("ADMIN_DISCORD_IDS", "999");
    await import("./auth");
    signIn = captured.config!.callbacks.signIn;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const call = (profile = NEW_USER) => signIn({ user: { name: "N" }, profile });

  it("variable absente : comportement inchangé, aucun appel Discord", async () => {
    await expect(call()).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledOnce();
  });

  it.each(["false", "1", "TRUE", ""])("valeur %j : porte désactivée (seule `true` active)", async (v) => {
    vi.stubEnv("AUTH_REQUIRE_GUILD_MEMBER", v);
    await expect(call()).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("porte activée", () => {
    beforeEach(() => vi.stubEnv("AUTH_REQUIRE_GUILD_MEMBER", "true"));

    it("nouveau compte non membre (404/10007) : refusé, rien écrit en base", async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 10007 }), { status: 404 }));
      await expect(call()).resolves.toBe(false);
      expect(upsert).not.toHaveBeenCalled();
    });

    it("nouveau compte membre : accepté", async () => {
      fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
      await expect(call()).resolves.toBe(true);
      expect(upsert).toHaveBeenCalledOnce();
    });

    it("compte déjà en base : accepté sans appel Discord", async () => {
      findUnique.mockResolvedValue({ id: "u1" });
      await expect(call()).resolves.toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("ADMIN_DISCORD_IDS : accepté sans appel Discord, même nouveau", async () => {
      await expect(call({ id: "999", username: "admin" })).resolves.toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("erreur Discord (500) : nouveau compte refusé (fail-closed)", async () => {
      fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
      await expect(call()).resolves.toBe(false);
      expect(upsert).not.toHaveBeenCalled();
    });

    it("erreur réseau : nouveau compte refusé (fail-closed)", async () => {
      fetchMock.mockRejectedValue(new Error("ECONNRESET"));
      await expect(call()).resolves.toBe(false);
    });

    it("DISCORD_BOT_GUILD_ID absent : nouveau compte refusé (fail-closed)", async () => {
      vi.stubEnv("DISCORD_BOT_GUILD_ID", "");
      await expect(call()).resolves.toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("lecture en base impossible : refusé (fail-closed)", async () => {
      findUnique.mockRejectedValue(new Error("db down"));
      await expect(call()).resolves.toBe(false);
    });

    it("existant et Discord en panne : accepté (la panne ne verrouille pas les membres)", async () => {
      findUnique.mockResolvedValue({ id: "u1" });
      fetchMock.mockRejectedValue(new Error("down"));
      await expect(call()).resolves.toBe(true);
    });
  });
});
