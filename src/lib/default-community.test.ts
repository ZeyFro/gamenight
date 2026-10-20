import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cas 0 communauté — `ensureDefaultCommunityRecord` (sans base) : la
 * communauté `default` doit porter `discordGuildId = DISCORD_BOT_GUILD_ID`,
 * même avant le premier passage de `/api/backfill/seed-reconcile`, pour que la
 * porte de connexion multi-serveurs ne refuse pas tout le monde.
 */

const { findUnique, create, update, userFindMany, membershipCreateMany } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  userFindMany: vi.fn(),
  membershipCreateMany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    community: { findUnique, create, update },
    user: { findMany: userFindMany },
    membership: { createMany: membershipCreateMany },
  },
}));

import { ensureDefaultCommunity, ensureDefaultCommunityRecord } from "./default-community";

describe("ensureDefaultCommunityRecord", () => {
  beforeEach(() => {
    findUnique.mockReset().mockResolvedValue(null);
    create.mockReset().mockImplementation(async ({ data }) => ({ id: "c1", ...data }));
    update.mockReset().mockImplementation(async ({ data }) => ({ id: "c1", ...data }));
    userFindMany.mockReset();
    membershipCreateMany.mockReset();
    vi.unstubAllEnvs();
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "111");
  });

  it("0 communauté : crée `default` ACTIVE avec discordGuildId = DISCORD_BOT_GUILD_ID", async () => {
    const community = await ensureDefaultCommunityRecord();
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ slug: "default", status: "ACTIVE", discordGuildId: "111" }),
    });
    expect(community.discordGuildId).toBe("111");
  });

  it("DISCORD_BOT_GUILD_ID absente ou vide : créée sans serveur (discordGuildId null)", async () => {
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "  ");
    await ensureDefaultCommunityRecord();
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ discordGuildId: null }) });
  });

  it("existante sans serveur : complétée depuis DISCORD_BOT_GUILD_ID", async () => {
    findUnique.mockResolvedValue({ id: "c1", slug: "default", status: "ACTIVE", discordGuildId: null });
    const community = await ensureDefaultCommunityRecord();
    expect(update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { discordGuildId: "111" } });
    expect(community.discordGuildId).toBe("111");
  });

  it("existante avec un serveur : jamais écrasé, statut jamais modifié (SUSPENDED reste SUSPENDED)", async () => {
    const existing = { id: "c1", slug: "default", status: "SUSPENDED", discordGuildId: "999" };
    findUnique.mockResolvedValue(existing);
    await expect(ensureDefaultCommunityRecord()).resolves.toBe(existing);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("deux premières connexions simultanées (slug unique, P2002) : relit la ligne créée par l'autre", async () => {
    const winner = { id: "c1", slug: "default", status: "ACTIVE", discordGuildId: "111" };
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);
    create.mockRejectedValue(Object.assign(new Error("Unique constraint"), { code: "P2002" }));
    await expect(ensureDefaultCommunityRecord()).resolves.toBe(winner);
  });

  it("toute autre erreur de création remonte (le signIn refuse alors, fail-closed)", async () => {
    create.mockRejectedValue(new Error("db down"));
    await expect(ensureDefaultCommunityRecord()).rejects.toThrow("db down");
  });

  it.each([
    {},
    { AUTH_REQUIRE_GUILD_MEMBER: "true" },
    { AUTH_REQUIRE_GUILD_MEMBER: "false", COMMUNITY_ISOLATION_ENABLED: "false", COMMUNITY_PICKER_ENABLED: "false" },
    { COMMUNITY_ISOLATION_ENABLED: "true", COMMUNITY_PICKER_ENABLED: "true" },
  ])("ensureDefaultCommunity ne rattache personne (membershipsCreated 0) pour les variables %j", async (env) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    userFindMany.mockResolvedValue([{ id: "u1", discordId: "1", role: "USER" }]);

    const result = await ensureDefaultCommunity();

    expect(result).toEqual({ communityId: "c1", created: true, membershipsCreated: 0 });
    expect(userFindMany).not.toHaveBeenCalled();
    expect(membershipCreateMany).not.toHaveBeenCalled();
  });
});
