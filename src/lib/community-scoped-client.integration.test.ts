import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Multi-communautés, PR7 — câblage `$extends` du client scopé sur un Postgres
 * réel (modèle `ChatMessage`, qui porte `communityId`). Les règles de filtrage
 * elles-mêmes sont couvertes sans base dans `community-scoped-client.test.ts`.
 *
 * Nécessite `TEST_DATABASE_URL` — suite SKIPPÉE si absente.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) {
    return { prisma: {} as unknown };
  }
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn(
    "[community-scoped-client.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE. " +
      "Le client Prisma scopé N'EST PAS validé par cette exécution."
  );
}

describe.skipIf(!TEST_DATABASE_URL)("client Prisma scopé (Postgres isolée)", () => {
  let db: import("@prisma/client").PrismaClient;
  let scoped: typeof import("./community-scoped-client");

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    scoped = await import("./community-scoped-client");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  let n = 0;
  const ids: Record<string, string> = {};

  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    await db.$executeRawUnsafe(`TRUNCATE "ChatMessage", "Membership", "Community", "User" CASCADE`);
    const mk = async (slug: string) =>
      (await db.community.create({ data: { slug, name: slug, status: "ACTIVE" } })).id;
    ids.def = await mk("default");
    ids.c1 = await mk("c1");
    ids.c2 = await mk("c2");
    const user = async (name: string) => (await db.user.create({ data: { discordId: name, discordName: name } })).id;
    ids.alice = await user("alice"); // c1 seulement
    ids.bob = await user("bob"); // c2 seulement
    ids.carol = await user("carol"); // c1 + default
    ids.dave = await user("dave"); // aucune communauté
    for (const [u, c] of [["alice", "c1"], ["bob", "c2"], ["carol", "c1"], ["carol", "def"]]) {
      await db.membership.create({ data: { userId: ids[u], communityId: ids[c], status: "ACTIVE" } });
    }
    const msg = async (key: string, communityId: string | null) => {
      n += 1;
      ids[key] = (await db.chatMessage.create({ data: { userId: ids.bob, content: `m${n}`, communityId } })).id;
    };
    await msg("m1", ids.c1);
    await msg("m2", ids.c2);
    await msg("m0", null);
  });

  const contentIds = async (rows: Promise<Array<{ id: string }>>) => (await rows).map((r) => r.id).sort();

  it("isolation éteinte : aucun membre default ne reçoit le périmètre historique", async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "");
    const client = await scoped.getScopedPrisma(ids.dave);
    expect(await client.chatMessage.count()).toBe(0);
    expect(await client.chatMessage.findMany()).toEqual([]);
    await expect(client.chatMessage.create({ data: { userId: ids.dave, content: "libre" } }))
      .rejects.toBeInstanceOf(scoped.CommunityScopeError);
  });

  it("isolation éteinte : un membre B-only lit et écrit B, jamais c1 ni les lignes default/null", async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "");
    const bob = await scoped.getScopedPrisma(ids.bob);
    expect(await contentIds(bob.chatMessage.findMany())).toEqual([ids.m2]);
    const created = await bob.chatMessage.create({ data: { userId: ids.bob, content: "b-new", communityId: ids.c2 } });
    await expect(bob.chatMessage.create({ data: { userId: ids.bob, content: "default-forbidden", communityId: null } }))
      .rejects.toBeInstanceOf(scoped.CommunityScopeError);
    await expect(bob.chatMessage.create({ data: { userId: ids.bob, content: "c1-forbidden", communityId: ids.c1 } }))
      .rejects.toBeInstanceOf(scoped.CommunityScopeError);
    expect(await contentIds(bob.chatMessage.findMany())).toEqual([ids.m2, created.id].sort());
    expect(await db.chatMessage.count({ where: { content: { in: ["default-forbidden", "c1-forbidden"] } } })).toBe(0);
  });

  it("isolation éteinte : un membre default/A garde null mais ne lit ni n'écrit B", async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "");
    const carol = await scoped.getScopedPrisma(ids.carol);
    expect(await contentIds(carol.chatMessage.findMany())).toEqual([ids.m0, ids.m1].sort());
    await expect(carol.chatMessage.create({ data: { userId: ids.carol, content: "b-forbidden", communityId: ids.c2 } }))
      .rejects.toBeInstanceOf(scoped.CommunityScopeError);
    const legacy = await carol.chatMessage.create({ data: { userId: ids.carol, content: "default-legacy", communityId: null } });
    expect(legacy.communityId).toBeNull();
    expect(await db.chatMessage.count({ where: { content: "b-forbidden" } })).toBe(0);
  });

  it("lectures : seule la communauté de l'utilisateur est visible (`null` = default seulement pour ses membres)", async () => {
    const alice = await scoped.getScopedPrisma(ids.alice);
    expect(await contentIds(alice.chatMessage.findMany())).toEqual([ids.m1]);
    const bob = await scoped.getScopedPrisma(ids.bob);
    expect(await contentIds(bob.chatMessage.findMany())).toEqual([ids.m2]);
    const carol = await scoped.getScopedPrisma(ids.carol);
    expect(await contentIds(carol.chatMessage.findMany())).toEqual([ids.m0, ids.m1].sort());
  });

  it("aucune communauté : rien de visible, aucune création", async () => {
    const dave = await scoped.getScopedPrisma(ids.dave);
    expect(await dave.chatMessage.findMany()).toEqual([]);
    expect(await dave.chatMessage.count()).toBe(0);
    await expect(
      dave.chatMessage.create({ data: { userId: ids.dave, content: "x", communityId: ids.c1 } })
    ).rejects.toBeInstanceOf(scoped.CommunityScopeError);
  });

  it("opérations « unique » : un id d'une autre communauté est introuvable", async () => {
    const alice = await scoped.getScopedPrisma(ids.alice);
    expect(await alice.chatMessage.findUnique({ where: { id: ids.m1 } })).not.toBeNull();
    expect(await alice.chatMessage.findUnique({ where: { id: ids.m2 } })).toBeNull();
    await expect(alice.chatMessage.findUniqueOrThrow({ where: { id: ids.m2 } })).rejects.toThrow();
    expect(await alice.chatMessage.findFirst({ where: { id: ids.m2 } })).toBeNull();
  });

  it("update / delete : la ligne d'une autre communauté n'est ni modifiée ni supprimée", async () => {
    const alice = await scoped.getScopedPrisma(ids.alice);
    await expect(alice.chatMessage.update({ where: { id: ids.m2 }, data: { content: "piraté" } })).rejects.toThrow();
    await expect(alice.chatMessage.delete({ where: { id: ids.m2 } })).rejects.toThrow();
    expect((await alice.chatMessage.updateMany({ data: { content: "piraté" } })).count).toBe(1); // m1 seulement
    expect((await alice.chatMessage.deleteMany({})).count).toBe(1);
    expect(await db.chatMessage.count()).toBe(2); // m2 et m0 intacts
    expect((await db.chatMessage.findUniqueOrThrow({ where: { id: ids.m2 } })).content).not.toBe("piraté");
  });

  it("update sur sa propre ligne : fonctionne (filtre non unique à côté de la clé unique)", async () => {
    const alice = await scoped.getScopedPrisma(ids.alice);
    const row = await alice.chatMessage.update({ where: { id: ids.m1 }, data: { content: "ok" } });
    expect(row.content).toBe("ok");
    await expect(
      alice.chatMessage.update({ where: { id: ids.m1 }, data: { communityId: ids.c2 } })
    ).rejects.toBeInstanceOf(scoped.CommunityScopeError);
  });

  it("créations : communauté du périmètre seulement, y compris createMany et upsert", async () => {
    const alice = await scoped.getScopedPrisma(ids.alice);
    await alice.chatMessage.create({ data: { userId: ids.alice, content: "a", communityId: ids.c1 } });
    await expect(
      alice.chatMessage.create({ data: { userId: ids.alice, content: "b", communityId: ids.c2 } })
    ).rejects.toBeInstanceOf(scoped.CommunityScopeError);
    await expect(
      alice.chatMessage.createMany({
        data: [
          { userId: ids.alice, content: "c", communityId: ids.c1 },
          { userId: ids.alice, content: "d", communityId: ids.c2 },
        ],
      })
    ).rejects.toBeInstanceOf(scoped.CommunityScopeError);
    expect(await db.chatMessage.count({ where: { content: { in: ["b", "c", "d"] } } })).toBe(0);
    // upsert sur la ligne d'une autre communauté : le where filtré ne la trouve pas → tentative de création refusée.
    await expect(
      alice.chatMessage.upsert({
        where: { id: ids.m2 },
        create: { userId: ids.alice, content: "e", communityId: ids.c2 },
        update: { content: "piraté" },
      })
    ).rejects.toBeInstanceOf(scoped.CommunityScopeError);
  });

  it("transactions (tableau et interactive) : le scope s'applique aussi", async () => {
    const alice = await scoped.getScopedPrisma(ids.alice);
    const [list] = await alice.$transaction([alice.chatMessage.findMany()]);
    expect(list.map((r) => r.id)).toEqual([ids.m1]);
    const count = await alice.$transaction(async (tx) => tx.chatMessage.count());
    expect(count).toBe(1);
  });

  it("modèle sans `communityId` : jamais filtré", async () => {
    const alice = await scoped.getScopedPrisma(ids.alice);
    expect(await alice.user.count()).toBe(4);
  });
});
