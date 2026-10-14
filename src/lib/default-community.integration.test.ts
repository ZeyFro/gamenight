import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Multi-communautés, PR A — rattrapage `ensureDefaultCommunity` : la
 * communauté actuelle devient la communauté « par défaut » (slug `default`,
 * ACTIVE) et chaque utilisateur existant y reçoit un Membership. Idempotent
 * (appelé à chaque passage de `/api/backfill/seed-reconcile`) : ne crée
 * jamais de doublon et ne modifie JAMAIS un Membership existant.
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

  async function rolesByDiscordId() {
    const rows = await db.membership.findMany({ include: { user: true } });
    return Object.fromEntries(rows.map((m) => [m.user.discordId, `${m.role}/${m.status}`]));
  }

  it("crée la communauté par défaut ACTIVE et un Membership par utilisateur (rôles)", async () => {
    vi.stubEnv("ADMIN_DISCORD_IDS", "env-admin-1, env-admin-2");
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "111");
    await makeUser("env-admin-2");
    await makeUser("env-admin-1");
    await makeUser("db-admin", "ADMIN");
    await makeUser("membre");

    const result = await ensureDefaultCommunity();

    const community = await db.community.findUniqueOrThrow({ where: { slug: "default" } });
    expect(community).toMatchObject({ status: "ACTIVE", discordGuildId: "111" });
    expect(result).toEqual({ communityId: community.id, created: true, membershipsCreated: 4 });
    // OWNER = premier de ADMIN_DISCORD_IDS présent en base (ordre de la variable).
    expect(await rolesByDiscordId()).toEqual({
      "env-admin-1": "OWNER/ACTIVE",
      "env-admin-2": "ADMIN/ACTIVE",
      "db-admin": "ADMIN/ACTIVE",
      membre: "MEMBER/ACTIVE",
    });
  });

  it("rejoué : aucun doublon, rien de recréé", async () => {
    await makeUser("membre");
    const first = await ensureDefaultCommunity();

    const second = await ensureDefaultCommunity();

    expect(second).toEqual({ communityId: first.communityId, created: false, membershipsCreated: 0 });
    expect(await db.community.count()).toBe(1);
    expect(await db.membership.count()).toBe(1);
  });

  it("ne modifie jamais un Membership existant (LEFT reste LEFT) ; un nouvel utilisateur est ajouté", async () => {
    vi.stubEnv("ADMIN_DISCORD_IDS", "parti");
    await makeUser("parti");
    const { communityId } = await ensureDefaultCommunity();
    await db.membership.updateMany({ where: { communityId }, data: { status: "LEFT", role: "MEMBER" } });
    await makeUser("nouveau");

    const result = await ensureDefaultCommunity();

    expect(result.membershipsCreated).toBe(1);
    expect(await rolesByDiscordId()).toEqual({ parti: "MEMBER/LEFT", nouveau: "MEMBER/ACTIVE" });
  });

  it("un compte déjà membre d'une AUTRE communauté (connexion multi-serveurs) n'est pas rattaché à la communauté par défaut", async () => {
    const other = await db.community.create({
      data: { slug: "autre", name: "Autre", status: "ACTIVE", discordGuildId: "333" },
    });
    const confirmedElsewhere = await makeUser("autre-serveur");
    await db.membership.create({ data: { communityId: other.id, userId: confirmedElsewhere.id } });
    await makeUser("historique");

    const result = await ensureDefaultCommunity();

    expect(result.membershipsCreated).toBe(1);
    const inDefault = await db.membership.findMany({
      where: { communityId: result.communityId },
      include: { user: true },
    });
    expect(inDefault.map((m) => m.user.discordId)).toEqual(["historique"]);
  });

  it("un seul OWNER : un admin d'environnement arrivé après coup devient ADMIN", async () => {
    vi.stubEnv("ADMIN_DISCORD_IDS", "premier,second");
    await makeUser("premier");
    await ensureDefaultCommunity();
    await makeUser("second");

    await ensureDefaultCommunity();

    expect(await rolesByDiscordId()).toEqual({ premier: "OWNER/ACTIVE", second: "ADMIN/ACTIVE" });
    expect(await db.membership.count({ where: { role: "OWNER" } })).toBe(1);
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
