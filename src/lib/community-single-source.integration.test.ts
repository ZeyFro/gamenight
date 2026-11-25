import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

/**
 * Cahier §21.1 / C124 : « Pas de système parallèle de profils, équipes ou
 * progression ». La preuve croise les deux entrées normales sur une base
 * jetable :
 * - le handler `/profil` de Discord (`loadCommunityProfile`) ;
 * - les services de lecture du site (`getMemberStats`, `listCommunityTeams`,
 *   `getTowerProgress`) utilisés par `/profil`, `/ascension` et `/equipes`.
 *
 * Une équipe créée par le service du site doit apparaître dans le profil
 * Discord avec le même nom, le même jeu et le même nombre de membres ; l'XP
 * et l'étage doivent être identiques des deux côtés. Aucun second stockage,
 * aucun appel Discord : Prisma lit les mêmes tables.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
if (!TEST_DATABASE_URL) {
  console.warn("[community-single-source] TEST_DATABASE_URL absente : test PostgreSQL ignoré.");
}

const scopes: string[] = [];

/** Identifiant Discord numérique de 17 chiffres, unique par test. */
function snowflake(prefix: string): string {
  return prefix + String(Date.now()).slice(-12) + String(Math.floor(Math.random() * 10_000)).padStart(4, "0");
}

describe.skipIf(!TEST_DATABASE_URL)("C124 — une seule source pour profils, équipes et progression", () => {
  let db: PrismaClient;
  let scope: string;
  let communityId: string;
  let userId: string;
  let gameId: string;
  let guildId: string;
  let discordId: string;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as PrismaClient;
    // Base jetable : repart d'un état vide, comme les autres suites PostgreSQL.
    await db.$executeRawUnsafe('TRUNCATE "User", "Community" CASCADE');
  });

  async function cleanup(value: string) {
    await db.community.deleteMany({ where: { id: value + "-community" } });
    await db.game.deleteMany({ where: { id: value + "-game" } });
    await db.user.deleteMany({ where: { id: value + "-user" } });
  }

  afterEach(async () => {
    if (scope) await cleanup(scope);
  });

  afterAll(async () => {
    for (const value of scopes) await cleanup(value);
    await db.$disconnect();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "false");
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "false");
    vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "false");
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "false");

    scope = "c124-" + randomUUID();
    scopes.push(scope);
    communityId = scope + "-community";
    userId = scope + "-user";
    gameId = scope + "-game";
    guildId = snowflake("8");
    discordId = snowflake("9");

    await db.community.create({
      data: {
        id: communityId,
        slug: scope,
        name: "The Tower — C124",
        status: "ACTIVE",
        discordGuildId: guildId,
        towerLevelsPerFloor: 10,
        communityTeamsEnabled: true,
      },
    });
    await db.user.create({
      data: { id: userId, discordId, discordName: "Maxime" },
    });
    await db.membership.create({
      data: { communityId, userId, status: "ACTIVE", joinedAt: new Date() },
    });
    await db.communityMemberStats.create({
      data: { communityId, userId, xpTotal: 120, xpBalance: 40, streakCount: 3 },
    });
    await db.game.create({
      data: { id: gameId, name: "Valheim", source: "MANUAL", addedById: userId },
    });
  });

  it("une équipe créée sur le site est retrouvée à l'identique par /profil et par les vues du site", async () => {
    const teams = await import("./community-teams");
    const created = await teams.createCommunityTeam({
      userId,
      communityId,
      gameId,
      name: "Les Bâtisseurs",
      description: "Construire et explorer ensemble.",
      platform: "PC",
      maxMembers: 4,
    });
    expect(created).toBe("created");

    const [profileModule, statsModule, progressModule] = await Promise.all([
      import("./discord-community-profile"),
      import("./member-stats"),
      import("./tower-progression"),
    ]);

    const profile = await profileModule.loadCommunityProfile({ guildId, discordId });
    expect(profile.status).toBe("PROFILE");
    if (profile.status !== "PROFILE") throw new Error("profil attendu");

    const stats = await statsModule.getMemberStats(userId, communityId);
    const siteTeams = await teams.listCommunityTeams(userId, communityId);
    const siteProgress = progressModule.getTowerProgress(stats.xpTotal, 10);

    expect(profile.profile).toMatchObject({
      displayName: "Maxime",
      xpTotal: stats.xpTotal,
      level: siteProgress.level,
      floor: siteProgress.floor,
      xpToNextFloor: siteProgress.xpToNextFloor,
      floorsWon: null,
    });
    expect(siteTeams).toHaveLength(1);
    expect(profile.profile.teams).toEqual([
      {
        name: siteTeams[0].name,
        game: siteTeams[0].game.name,
        captain: siteTeams[0].captainId === userId,
        members: siteTeams[0]._count.members,
        maxMembers: siteTeams[0].maxMembers,
      },
    ]);
    expect(profile.profile.teams[0]).toMatchObject({
      name: "Les Bâtisseurs",
      game: "Valheim",
      captain: true,
      members: 1,
      maxMembers: 4,
    });
  });

  it("un non-membre ne reçoit ni profil Discord ni statistiques du site", async () => {
    await db.membership.delete({
      where: { communityId_userId: { communityId, userId } },
    });

    const [profileModule, statsModule, teams] = await Promise.all([
      import("./discord-community-profile"),
      import("./member-stats"),
      import("./community-teams"),
    ]);

    expect(await profileModule.loadCommunityProfile({ guildId, discordId })).toEqual({
      status: "NOT_MEMBER",
    });
    expect(await statsModule.getMemberStats(userId, communityId)).toMatchObject({ xpTotal: 0 });
    expect(await teams.listCommunityTeams(userId, communityId)).toEqual([]);
  });
});
