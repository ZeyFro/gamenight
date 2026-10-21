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

import {
  ensureDefaultCommunity,
  ensureDefaultCommunityRecord,
  findExistingDefaultCommunityId,
  getDefaultCommunityId,
  resetDefaultCommunityIdCache,
} from "./default-community";
import * as defaultCommunityModule from "./default-community";

const rememberDefaultCommunityIdFromLookup = (defaultCommunityModule as unknown as {
  rememberDefaultCommunityIdFromLookup?: (community: { id: string; slug: string }) => void;
}).rememberDefaultCommunityIdFromLookup;

describe("ensureDefaultCommunityRecord", () => {
  beforeEach(() => {
    resetDefaultCommunityIdCache();
    findUnique.mockReset().mockResolvedValue(null);
    create.mockReset().mockImplementation(async ({ data }) => ({ id: "c1", ...data }));
    update.mockReset().mockImplementation(async ({ data }) => ({ id: "c1", ...data }));
    userFindMany.mockReset();
    membershipCreateMany.mockReset();
    vi.unstubAllEnvs();
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "111");
  });

  it("résout l'ID default sans créer la communauté et réutilise son cache positif", async () => {
    findUnique.mockResolvedValue({ id: "c1" });

    await expect(findExistingDefaultCommunityId()).resolves.toBe("c1");
    await expect(findExistingDefaultCommunityId()).resolves.toBe("c1");

    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith({
      where: { slug: "default" },
      select: { id: true },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("une absence reste non mise en cache et ne déclenche jamais le bootstrap", async () => {
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "c1" });

    await expect(findExistingDefaultCommunityId()).resolves.toBeNull();
    await expect(findExistingDefaultCommunityId()).resolves.toBe("c1");

    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(create).not.toHaveBeenCalled();
  });

  it("lit dans le client transactionnel fourni lorsque le cache est froid", async () => {
    const txFindUnique = vi.fn().mockResolvedValue({ id: "tx-c1" });
    const transactionClient = { community: { findUnique: txFindUnique } } as unknown as Parameters<typeof findExistingDefaultCommunityId>[0];

    await expect(findExistingDefaultCommunityId(transactionClient)).resolves.toBe("tx-c1");

    expect(txFindUnique).toHaveBeenCalledWith({
      where: { slug: "default" },
      select: { id: true },
    });
    expect(findUnique).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("partage le cache positif établi par le getter historique", async () => {
    findUnique.mockResolvedValue({ id: "c1" });

    await expect(getDefaultCommunityId()).resolves.toBe("c1");
    await expect(findExistingDefaultCommunityId()).resolves.toBe("c1");

    expect(findUnique).toHaveBeenCalledOnce();
  });

  it("mémorise un ID uniquement quand la ligne lue porte le slug default", async () => {
    expect(rememberDefaultCommunityIdFromLookup).toBeTypeOf("function");
    rememberDefaultCommunityIdFromLookup!({ id: "c-default", slug: "default" });
    rememberDefaultCommunityIdFromLookup!({ id: "c-b", slug: "serveur-b" });

    await expect(findExistingDefaultCommunityId()).resolves.toBe("c-default");
    expect(findUnique).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
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
