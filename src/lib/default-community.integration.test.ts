import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Multi-communautés, PR A — `ensureDefaultCommunity` : la communauté actuelle
 * devient la communauté « par défaut » (slug `default`, ACTIVE). S0 : plus aucun
 * rattachement automatique, aucun Membership n'est créé ici (seule une connexion
 * avec instantané Discord complet en crée un). Idempotent (appelé à chaque
 * passage de `/api/backfill/seed-reconcile`) : ne crée jamais de doublon.
 *
 * Nécessite `TEST_DATABASE_URL` (Postgres local isolé, jamais Neon) — suite
 * entièrement SKIPPÉE si absente.
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
    "[default-community.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE. " +
      "Le rattrapage de la communauté par défaut N'EST PAS validé par cette exécution."
  );
}

describe.skipIf(!TEST_DATABASE_URL)("ensureDefaultCommunity (Postgres isolée)", () => {
  let db: import("@prisma/client").PrismaClient;
  let ensureDefaultCommunity: typeof import("./default-community").ensureDefaultCommunity;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    ({ ensureDefaultCommunity } = await import("./default-community"));
  });

  afterAll(async () => {
    // Le dernier test suspend la communauté par défaut : ne pas la laisser aux fichiers suivants (selon l'ordre
    // d'exécution, ils échouaient avec 401 / effets absents). `getDefaultCommunityId()` la recrée ACTIVE à la demande.
    await db.$executeRawUnsafe(`TRUNCATE "Membership", "CommunityChannelConfig", "Community", "User" CASCADE`);
    await db.$disconnect();
  });

  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("ADMIN_DISCORD_IDS", "");
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "");
    await db.$executeRawUnsafe(`TRUNCATE "Membership", "CommunityChannelConfig", "Community", "User" CASCADE`);
  });

  const makeUser = (discordId: string, role: "USER" | "ADMIN" = "USER") =>
    db.user.create({ data: { discordId, discordName: discordId, role } });

  it("crée la communauté par défaut ACTIVE et AUCUN Membership, quel que soit l'état des variables", async () => {
    await makeUser("membre");
    await makeUser("db-admin", "ADMIN");
    await makeUser("env-admin-1");
    const states: Record<string, string>[] = [
      {},
      { AUTH_REQUIRE_GUILD_MEMBER: "true" },
      { AUTH_REQUIRE_GUILD_MEMBER: "false", COMMUNITY_ISOLATION_ENABLED: "false", COMMUNITY_PICKER_ENABLED: "false" },
      { COMMUNITY_ISOLATION_ENABLED: "true" },
      { COMMUNITY_PICKER_ENABLED: "true", ADMIN_DISCORD_IDS: "env-admin-1", DISCORD_BOT_GUILD_ID: "111" },
    ];
    for (const state of states) {
      vi.unstubAllEnvs();
      vi.stubEnv("ADMIN_DISCORD_IDS", "");
      vi.stubEnv("DISCORD_BOT_GUILD_ID", "");
      for (const [key, value] of Object.entries(state)) vi.stubEnv(key, value);

      const result = await ensureDefaultCommunity();

      expect(result.membershipsCreated).toBe(0);
      expect(await db.membership.count()).toBe(0);
    }
    const community = await db.community.findUniqueOrThrow({ where: { slug: "default" } });
    expect(community).toMatchObject({ status: "ACTIVE" });
  });

  it("rejoué : aucun doublon, rien de recréé", async () => {
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "111");
    const first = await ensureDefaultCommunity();
    expect(first).toEqual({ communityId: expect.any(String), created: true, membershipsCreated: 0 });
    const community = await db.community.findUniqueOrThrow({ where: { slug: "default" } });
    expect(community).toMatchObject({ status: "ACTIVE", discordGuildId: "111" });

    const second = await ensureDefaultCommunity();

    expect(second).toEqual({ communityId: first.communityId, created: false, membershipsCreated: 0 });
    expect(await db.community.count()).toBe(1);
  });

  it("un Membership existant n'est jamais modifié (LEFT reste LEFT) et aucun utilisateur n'est rattaché", async () => {
    const { communityId } = await ensureDefaultCommunity();
    const parti = await makeUser("parti");
    await db.membership.create({ data: { communityId, userId: parti.id, status: "LEFT" } });
    await makeUser("nouveau");

    const result = await ensureDefaultCommunity();

    expect(result.membershipsCreated).toBe(0);
    const rows = await db.membership.findMany({ include: { user: true } });
    expect(rows.map((m) => `${m.user.discordId}:${m.status}`)).toEqual(["parti:LEFT"]);
  });

  it("sans DISCORD_BOT_GUILD_ID : créée sans serveur, puis complétée quand la variable apparaît", async () => {
    await ensureDefaultCommunity();
    expect((await db.community.findUniqueOrThrow({ where: { slug: "default" } })).discordGuildId).toBeNull();

    vi.stubEnv("DISCORD_BOT_GUILD_ID", "222");
    await ensureDefaultCommunity();

    expect((await db.community.findUniqueOrThrow({ where: { slug: "default" } })).discordGuildId).toBe("222");
  });

  it("serveur déjà renseigné : jamais écrasé par une autre valeur d'environnement", async () => {
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "111");
    await ensureDefaultCommunity();
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "999");

    await ensureDefaultCommunity();

    expect((await db.community.findUniqueOrThrow({ where: { slug: "default" } })).discordGuildId).toBe("111");
  });

  it("communauté par défaut suspendue/archivée par un admin : statut jamais remis à ACTIVE", async () => {
    const { communityId } = await ensureDefaultCommunity();
    await db.community.update({ where: { id: communityId }, data: { status: "SUSPENDED" } });

    await ensureDefaultCommunity();

    expect((await db.community.findUniqueOrThrow({ where: { id: communityId } })).status).toBe("SUSPENDED");
  });
});
