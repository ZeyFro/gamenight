import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

/**
 * D5 : balayage des équipes DISSOUTES dont les salons existent encore (cron des rappels). PostgreSQL local jetable ; aucun appel Discord (file
 * seulement). Suite SKIPPÉE sans `TEST_DATABASE_URL`.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/notification-executor-kick", () => ({ kickNotificationExecutor: vi.fn() }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient: Client } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new Client({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
if (!TEST_DATABASE_URL) console.warn("[discord-team-space-sweep] TEST_DATABASE_URL absente : suite SKIPPÉE.");

describe.skipIf(!TEST_DATABASE_URL)("balayage des espaces d'équipe dissous (D5)", () => {
  let db: PrismaClient;
  let sweep: typeof import("./discord-team-space-sweep");
  let hooks: typeof import("./discord-team-space-hooks");
  let delivery: typeof import("./notification-delivery");
  let loggerModule: typeof import("./logger");
  const ids: Record<string, string> = {};
  const GUILD = "444444444444444444";

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as PrismaClient;
    sweep = await import("./discord-team-space-sweep");
    hooks = await import("./discord-team-space-hooks");
    delivery = await import("./notification-delivery");
    loggerModule = await import("./logger");
  });
  afterAll(async () => { await db?.$disconnect(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "true");
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_TOKEN", "faux-jeton-de-test");
    await db.$executeRawUnsafe('TRUNCATE "DiscordTeamSpace", "NotificationDelivery", "NotificationEvent", "CommunityTeamMember", "CommunityTeam", "Membership", "User", "Game", "Community" CASCADE');
    ids.community = (await db.community.create({ data: { slug: "sweep", name: "Balayage", status: "ACTIVE", communityTeamsEnabled: true, discordGuildId: GUILD } })).id;
    ids.user = (await db.user.create({ data: { discordId: "855555555555555555", discordName: "membre" } })).id;
    await db.membership.create({ data: { userId: ids.user, communityId: ids.community, status: "ACTIVE" } });
    ids.game = (await db.game.create({ data: { name: "Valheim", source: "MANUAL", addedById: ids.user } })).id;
  });

  const team = async (name: string, opts: { members?: string[]; recruiting?: boolean; deleted?: boolean } = {}) => {
    const created = await db.communityTeam.create({ data: { communityId: ids.community, gameId: ids.game, createdById: ids.user, captainId: ids.user, name, description: "Équipe de test.",
      platform: "PC", maxMembers: 4, isRecruiting: opts.recruiting ?? false } });
    for (const userId of opts.members ?? []) await db.communityTeamMember.create({ data: { communityId: ids.community, teamId: created.id, userId } });
    await db.discordTeamSpace.create({ data: { teamId: created.id, communityId: ids.community, guildId: GUILD, channelId: `${name}-chan`, voiceChannelId: `${name}-voice`, deletedAt: opts.deleted ? new Date() : null } });
    return created;
  };
  const events = (teamId: string) => db.notificationEvent.findMany({ where: { eventType: "TEAM_SPACE_SYNC", sourceId: teamId } });

  it("I5 : un échec d'enfilement après la dissolution ne lève jamais, est journalisé, puis le balayage rattrape la suppression des salons", async () => {
    const dissolved = await team("Dissoute");
    const error = vi.spyOn(loggerModule.logger, "error").mockImplementation(() => undefined);
    vi.spyOn(delivery, "createNotificationEvent").mockRejectedValueOnce(new Error("base indisponible"));
    // La dissolution est déjà faite : la mise en file ne doit pas lever (sinon 500 côté web) mais ne doit pas non plus passer inaperçue.
    await expect(hooks.requestTeamSpaceAfterDissolution({ communityId: ids.community, teamId: dissolved.id, actorUserId: ids.user, formerMemberDiscordIds: [] })).resolves.toBeUndefined();
    expect(await events(dissolved.id)).toHaveLength(0);
    expect(error).toHaveBeenCalledWith("discord-team-space", expect.stringContaining("Suppression des salons non enfilée"), expect.anything());
    // Rattrapage.
    expect(await sweep.sweepDissolvedTeamSpaces()).toEqual({ enabled: true, checked: 1, queued: 1, blocked: 0, failed: 0 });
    const [event] = await events(dissolved.id);
    expect(event.payload).toMatchObject({ intent: "delete" });
  });

  it("I5 : un échec d'enfilement DANS le balayage est compté, journalisé, et réessayé au passage suivant", async () => {
    await team("Coincee");
    const error = vi.spyOn(loggerModule.logger, "error").mockImplementation(() => undefined);
    const failing = vi.spyOn(delivery, "createNotificationEvent").mockRejectedValueOnce(new Error("base indisponible"));
    expect(await sweep.sweepDissolvedTeamSpaces()).toMatchObject({ checked: 1, queued: 0, failed: 1 });
    expect(error).toHaveBeenCalled();
    failing.mockRestore();
    expect(await sweep.sweepDissolvedTeamSpaces()).toMatchObject({ checked: 1, queued: 1, failed: 0 });
  });

  it("idempotent : une suppression déjà demandée récemment n'est pas redemandée à chaque passage", async () => {
    const t = await team("Une fois");
    expect(await sweep.sweepDissolvedTeamSpaces()).toMatchObject({ queued: 1 });
    expect(await sweep.sweepDissolvedTeamSpaces()).toMatchObject({ checked: 0, queued: 0 });
    expect(await events(t.id)).toHaveLength(1);
  });

  it("ne touche que les équipes réellement dissoutes : membres présents (même inactifs), recrutement ouvert, salons déjà supprimés : jamais enfilés", async () => {
    const withMember = await team("AvecMembre", { members: [ids.user] });
    await db.membership.update({ where: { communityId_userId: { communityId: ids.community, userId: ids.user } }, data: { status: "LEFT" } });
    const recruiting = await team("Recrute", { recruiting: true });
    const alreadyDeleted = await team("Supprimee", { deleted: true });
    expect(await sweep.sweepDissolvedTeamSpaces()).toMatchObject({ enabled: true, checked: 0, queued: 0 });
    for (const t of [withMember, recruiting, alreadyDeleted]) expect(await events(t.id)).toHaveLength(0);
  });

  it("sans la file des espaces d'équipe (drapeau fermé) : aucune lecture ni écriture", async () => {
    await team("Fermee");
    expect(await sweep.sweepDissolvedTeamSpaces(25, { DISCORD_TEAM_SPACES_ENABLED: "false" } as unknown as NodeJS.ProcessEnv)).toEqual({ enabled: false, checked: 0, queued: 0, blocked: 0, failed: 0 });
    expect(await db.notificationEvent.count()).toBe(0);
  });

  it("branché sur le cron des rappels existant (aucune nouvelle route, aucun nouvel interrupteur)", () => {
    const route = readFileSync("src/app/api/cron/reminders/route.ts", "utf8");
    expect(route).toContain('from "@/lib/discord-team-space-sweep"');
    expect(route).toContain("sweepDissolvedTeamSpaces()");
  });
});
