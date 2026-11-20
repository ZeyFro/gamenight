import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

/**
 * Recette SQL isolée : PostgreSQL jetable (`TEST_DATABASE_URL`), jamais Neon ni Production. Aucune migration
 * propre à ce sujet. Ignorée sans `TEST_DATABASE_URL` : à signaler « skipped », jamais présentée comme passée.
 * Aucun appel Discord (compteurs simulés).
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient: Client } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new Client({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

describe.skipIf(!TEST_DATABASE_URL)("PostgreSQL isolé — tableau de bord staff v2", () => {
  let db: PrismaClient;
  let dashboard: typeof import("./admin-dashboard-v2");
  const GUILD = "100000000000000001";
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as PrismaClient;
    dashboard = await import("./admin-dashboard-v2");
  });
  afterAll(async () => {
    await db?.$disconnect();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    // Faux jeton : le chargeur ne lit les compteurs que si le bot est configuré ; les compteurs sont injectés, aucun appel Discord.
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-token");
    await db.$executeRawUnsafe(
      `TRUNCATE "TeamApplication", "DiscordTeamSpace", "NotificationDelivery", "NotificationEvent", "CommunityTeamMember", "CommunityTeam", "Membership", "User", "Game", "Community" CASCADE`
    );
    ids.community = (await db.community.create({ data: { slug: "tower-test", name: "The Tower", status: "ACTIVE", discordGuildId: GUILD, communityTeamsEnabled: true } })).id;
    ids.other = (await db.community.create({ data: { slug: "autre", name: "Autre", status: "ACTIVE" } })).id;
    ids.user = (await db.user.create({ data: { discordId: "100000000000000021", discordName: "Maxime" } })).id;
    ids.game = (await db.game.create({ data: { name: "Valheim", source: "MANUAL", addedById: ids.user } })).id;
    ids.team = (await db.communityTeam.create({ data: { communityId: ids.community, gameId: ids.game, createdById: ids.user, name: "Les Dragons", description: "Explorer ensemble.", platform: "PC", maxMembers: 8 } })).id;
  });

  it("compte uniquement ce qui appartient à chaque communauté, sans rien écrire", async () => {
    await db.teamApplication.create({ data: { communityId: ids.community, teamId: ids.team, applicantId: ids.user, message: "Je candidate", status: "PENDING" } });
    await db.discordTeamSpace.create({ data: { teamId: ids.team, communityId: ids.community, guildId: GUILD, channelId: "chan-1", roleId: "role-1", archived: true } });
    const event = await db.notificationEvent.create({ data: { category: "ADMIN", eventType: "TEAM_SPACE_SYNC", sourceId: ids.team, communityId: ids.community } });
    await db.notificationDelivery.create({
      data: { eventId: event.id, channel: "DISCORD_CHANNEL", transport: "BOT", recipientKey: "team:x", targetSlot: "slot-1", status: "FAILED", errorClass: "auth_or_permission", attempts: 5 },
    });
    const before = await db.notificationDelivery.count();
    const result = await dashboard.loadAdminDashboardV2({ discordCounts: async () => ({ roles: 205, channels: 10 }) });
    const tower = result.communities.find((community) => community.id === ids.community)!;
    const other = result.communities.find((community) => community.id === ids.other)!;
    expect(tower).toMatchObject({ pendingApplications: 1, failedOperations: 1, archivedSpaces: [{ teamName: "Les Dragons" }], roles: { level: "alert" } });
    expect(other).toMatchObject({ pendingApplications: 0, failedOperations: 0, archivedSpaces: [] });
    expect(result.failedOperations).toEqual([expect.objectContaining({ communityName: "The Tower", errorClass: "auth_or_permission" })]);
    expect(await db.notificationDelivery.count()).toBe(before);
  });
});
