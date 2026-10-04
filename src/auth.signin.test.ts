import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Callback `signIn` d'Auth.js (src/auth.ts) — porte d'accès
 * `AUTH_REQUIRE_GUILD_MEMBER`, multi-communautés : un NOUVEAU compte doit être
 * membre d'au moins un serveur Discord d'une communauté ACTIVE. Désactivée par
 * défaut ; fail-closed pour les nouveaux comptes (aucun serveur confirmé, ou
 * vérification indécise = refus) ; les comptes existants et
 * `ADMIN_DISCORD_IDS` passent toujours. Un Membership ACTIVE est créé pour
 * chaque serveur confirmé (LEFT réactivé, REMOVED jamais).
 */

type SignInCallback = (args: {
  user: { name?: string; image?: string };
  profile?: { id?: string; username?: string };
}) => Promise<boolean>;

const mocks = vi.hoisted(() => ({
  captured: { config: null as null | { callbacks: { signIn: SignInCallback } } },
  fetchMock: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  communityFindMany: vi.fn(),
  membershipCreateMany: vi.fn(),
  membershipUpdateMany: vi.fn(),
  transaction: vi.fn(),
  ensureDefault: vi.fn(),
  order: [] as string[],
}));
const { captured, fetchMock, findUnique, upsert, communityFindMany } = mocks;
const { membershipCreateMany, membershipUpdateMany, transaction, ensureDefault } = mocks;

vi.mock("next-auth", () => ({
  default: (config: { callbacks: { signIn: SignInCallback } }) => {
    captured.config = config;
    return { handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() };
  },
}));
vi.mock("next-auth/providers/discord", () => ({ default: () => ({ id: "discord" }) }));
vi.mock("@/lib/default-community", () => ({ ensureDefaultCommunityRecord: mocks.ensureDefault }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { update: vi.fn(), upsert: mocks.upsert, findUnique: mocks.findUnique },
    community: { findMany: mocks.communityFindMany },
    $transaction: mocks.transaction,
  },
}));

const NEW_USER = { id: "222", username: "nouveau" };
const GUILD_A = { id: "ca", discordGuildId: "111" };
const GUILD_B = { id: "cb", discordGuildId: "333" };

const member = () => new Response("{}", { status: 200 });
const notMember = () => new Response(JSON.stringify({ code: 10007 }), { status: 404 });
const discordError = () => new Response("{}", { status: 500 });

/** Réponse Discord par serveur (`/guilds/<id>/members/…`). */
function discordByGuild(responses: Record<string, () => Response>) {
  fetchMock.mockImplementation(async (url: string) => {
    const guildId = /\/guilds\/(\d+)\//.exec(url)![1];
    return responses[guildId]();
  });
}

describe("auth.ts — callback signIn (AUTH_REQUIRE_GUILD_MEMBER)", () => {
  let signIn: SignInCallback;

  beforeEach(async () => {
    fetchMock.mockReset();
    findUnique.mockReset().mockResolvedValue(null);
    upsert.mockReset().mockResolvedValue({ id: "u-new" });
    communityFindMany.mockReset().mockResolvedValue([GUILD_A]);
    membershipCreateMany.mockReset().mockResolvedValue({ count: 1 });
    membershipUpdateMany.mockReset().mockResolvedValue({ count: 0 });
    ensureDefault.mockReset().mockResolvedValue({});
    transaction.mockReset().mockImplementation((fn: (tx: unknown) => unknown) =>
      fn({
        user: { upsert },
        membership: { createMany: membershipCreateMany, updateMany: membershipUpdateMany },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DISCORD_BOT_TOKEN", "bot-secret");
    vi.stubEnv("ADMIN_DISCORD_IDS", "999");
    await import("./auth");
    signIn = captured.config!.callbacks.signIn;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const call = (profile = NEW_USER) => signIn({ user: { name: "N" }, profile });

  it("variable absente : comportement inchangé, aucun appel Discord ni communauté", async () => {
    await expect(call()).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(communityFindMany).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledOnce();
  });

  it.each(["false", "1", "TRUE", ""])("valeur %j : porte désactivée (seule `true` active)", async (v) => {
    vi.stubEnv("AUTH_REQUIRE_GUILD_MEMBER", v);
    await expect(call()).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(communityFindMany).not.toHaveBeenCalled();
  });

  describe("porte activée", () => {
    beforeEach(() => vi.stubEnv("AUTH_REQUIRE_GUILD_MEMBER", "true"));

    it("nouveau compte non membre (404/10007) : refusé, rien écrit en base", async () => {
      fetchMock.mockResolvedValue(notMember());
      await expect(call()).resolves.toBe(false);
      expect(upsert).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });

    it("nouveau compte membre : accepté, user + Membership créés dans UNE transaction", async () => {
      fetchMock.mockResolvedValue(member());
      await expect(call()).resolves.toBe(true);
      expect(transaction).toHaveBeenCalledOnce();
      expect(upsert).toHaveBeenCalledOnce();
      expect(membershipCreateMany).toHaveBeenCalledWith({
        data: [{ communityId: "ca", userId: "u-new" }],
        skipDuplicates: true,
      });
    });

    it("ne cible que les communautés ACTIVE ayant un serveur Discord", async () => {
      fetchMock.mockResolvedValue(member());
      await call();
      expect(communityFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: "ACTIVE", discordGuildId: { not: null } } })
      );
    });

    it("compte déjà en base : accepté sans appel Discord ni Membership", async () => {
      findUnique.mockResolvedValue({ id: "u1" });
      await expect(call()).resolves.toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(communityFindMany).not.toHaveBeenCalled();
      expect(ensureDefault).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });

    it("ADMIN_DISCORD_IDS : accepté sans appel Discord, même nouveau", async () => {
      await expect(call({ id: "999", username: "admin" })).resolves.toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    });

    it("erreur Discord (500) : nouveau compte refusé (fail-closed)", async () => {
      fetchMock.mockResolvedValue(discordError());
      await expect(call()).resolves.toBe(false);
      expect(upsert).not.toHaveBeenCalled();
    });

    it("erreur réseau : nouveau compte refusé (fail-closed)", async () => {
      fetchMock.mockRejectedValue(new Error("ECONNRESET"));
      await expect(call()).resolves.toBe(false);
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

    describe("cas 0 communauté", () => {
      it("la communauté par défaut est assurée AVANT de lister les serveurs (DISCORD_BOT_GUILD_ID → discordGuildId)", async () => {
        const order: string[] = [];
        ensureDefault.mockImplementation(async () => void order.push("ensure"));
        communityFindMany.mockImplementation(async () => {
          order.push("findMany");
          return [GUILD_A];
        });
        fetchMock.mockResolvedValue(member());
        await expect(call()).resolves.toBe(true);
        expect(order).toEqual(["ensure", "findMany"]);
      });

      it("aucune communauté ACTIVE avec serveur : refusé, aucun appel Discord", async () => {
        communityFindMany.mockResolvedValue([]);
        await expect(call()).resolves.toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(upsert).not.toHaveBeenCalled();
      });

      it("création de la communauté par défaut impossible : refusé (fail-closed)", async () => {
        ensureDefault.mockRejectedValue(new Error("db down"));
        await expect(call()).resolves.toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
      });
    });

    describe("plusieurs serveurs", () => {
      beforeEach(() => communityFindMany.mockResolvedValue([GUILD_A, GUILD_B]));

      it("vérifie les serveurs en parallèle (les deux appels partent avant toute réponse)", async () => {
        const resolvers: Array<() => void> = [];
        fetchMock.mockImplementation(
          () => new Promise<Response>((resolve) => resolvers.push(() => resolve(member())))
        );
        const pending = call();
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        resolvers.forEach((r) => r());
        await expect(pending).resolves.toBe(true);
      });

      it("membre des deux : Membership ACTIVE pour chacun", async () => {
        discordByGuild({ "111": member, "333": member });
        await expect(call()).resolves.toBe(true);
        expect(membershipCreateMany).toHaveBeenCalledWith({
          data: [
            { communityId: "ca", userId: "u-new" },
            { communityId: "cb", userId: "u-new" },
          ],
          skipDuplicates: true,
        });
      });

      it("membre d'un seul (l'autre : non membre) : accepté, Membership du seul serveur confirmé", async () => {
        discordByGuild({ "111": notMember, "333": member });
        await expect(call()).resolves.toBe(true);
        expect(membershipCreateMany).toHaveBeenCalledWith({
          data: [{ communityId: "cb", userId: "u-new" }],
          skipDuplicates: true,
        });
      });

      it("un serveur confirmé, l'autre indécis (500) : accepté, aucun Membership pour l'indécis", async () => {
        discordByGuild({ "111": discordError, "333": member });
        await expect(call()).resolves.toBe(true);
        expect(membershipCreateMany).toHaveBeenCalledWith({
          data: [{ communityId: "cb", userId: "u-new" }],
          skipDuplicates: true,
        });
      });

      it("aucun confirmé (non membre + indécis) : refusé, rien écrit", async () => {
        discordByGuild({ "111": notMember, "333": discordError });
        await expect(call()).resolves.toBe(false);
        expect(upsert).not.toHaveBeenCalled();
        expect(membershipCreateMany).not.toHaveBeenCalled();
      });

      it("tous indécis : refusé (fail-closed)", async () => {
        discordByGuild({ "111": discordError, "333": discordError });
        await expect(call()).resolves.toBe(false);
      });
    });

    describe("Memberships existants", () => {
      it("réactive uniquement un Membership LEFT ; REMOVED n'est jamais touché", async () => {
        fetchMock.mockResolvedValue(member());
        await call();
        // createMany + skipDuplicates : un Membership existant (quel que soit
        // son statut) n'est jamais réécrit ; seule la réactivation ciblée de
        // LEFT passe par updateMany, filtré sur status LEFT.
        expect(membershipUpdateMany).toHaveBeenCalledWith({
          where: { userId: "u-new", communityId: { in: ["ca"] }, status: "LEFT" },
          data: { status: "ACTIVE", leftAt: null },
        });
        const serialized = JSON.stringify(membershipUpdateMany.mock.calls);
        expect(serialized).not.toContain("REMOVED");
      });

      it("échec d'écriture des Membership : refusé (la transaction annule aussi le user)", async () => {
        fetchMock.mockResolvedValue(member());
        membershipCreateMany.mockRejectedValue(new Error("db down"));
        await expect(call()).resolves.toBe(false);
      });
    });
  });
});
