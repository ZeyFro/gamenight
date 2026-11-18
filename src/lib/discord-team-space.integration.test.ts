import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * Recette SQL isolée : PostgreSQL jetable (`TEST_DATABASE_URL`), jamais Neon ni
 * Production. Prérequis : `prisma migrate deploy` (migration
 * `20261118121000_discord_team_space`). Ignorée sans `TEST_DATABASE_URL`, ce qui
 * doit alors être signalé comme « skipped », jamais présenté comme passé.
 *
 * Aucun appel Discord : l'adaptateur est un double de test ; la file passe par les
 * vraies tables `NotificationEvent` / `NotificationDelivery`.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient: Client } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new Client({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
vi.mock("@/lib/notification-executor-kick", () => ({ kickNotificationExecutor: vi.fn() }));

describe.skipIf(!TEST_DATABASE_URL)("PostgreSQL isolé — espaces d'équipe Discord", () => {
  let db: PrismaClient;
  let spaceStore: typeof import("./discord-team-space-service");
  let queue: typeof import("./discord-team-space-queue");
  let runner: typeof import("./discord-team-space-runner");
  let dispatch: typeof import("./notification-dispatch");
  const ids: Record<string, string> = {};
  const GUILD = "100000000000000001";
  const CREATOR_DISCORD = "100000000000000021";
  const MEMBER_DISCORD = "100000000000000022";

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as PrismaClient;
    spaceStore = await import("./discord-team-space-service");
    queue = await import("./discord-team-space-queue");
    runner = await import("./discord-team-space-runner");
    dispatch = await import("./notification-dispatch");
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const enableQueue = () => {
    vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "true");
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_TOKEN", "faux-jeton-de-test");
  };

  const newTeam = (name: string, createdById: string, captainId: string | null = null) =>
    db.communityTeam.create({
      data: {
        communityId: ids.community,
        gameId: ids.game,
        createdById,
        captainId,
        name,
        description: "Explorer et construire ensemble.",
        platform: "PC",
        maxMembers: 8,
      },
    });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      `TRUNCATE "DiscordTeamSpace", "NotificationDelivery", "NotificationEvent", "CommunityTeamMember", "CommunityTeam", "Membership", "User", "Game", "Community" CASCADE`
    );
    ids.community = (
      await db.community.create({
        data: { slug: "tower-test", name: "The Tower", status: "ACTIVE", communityTeamsEnabled: true, discordGuildId: GUILD },
      })
    ).id;
    ids.creator = (await db.user.create({ data: { discordId: CREATOR_DISCORD, discordName: "Maxime" } })).id;
    ids.member = (await db.user.create({ data: { discordId: MEMBER_DISCORD, discordName: "Sarah" } })).id;
    for (const userId of [ids.creator, ids.member]) {
      await db.membership.create({ data: { userId, communityId: ids.community, status: "ACTIVE", joinedAt: new Date() } });
    }
    ids.game = (await db.game.create({ data: { name: "Valheim", source: "MANUAL", addedById: ids.creator } })).id;
    ids.team = (await newTeam("Les Dragons", ids.creator, ids.creator)).id;
    await db.communityTeamMember.create({ data: { communityId: ids.community, teamId: ids.team, userId: ids.creator } });
    await db.communityTeamMember.create({ data: { communityId: ids.community, teamId: ids.team, userId: ids.member } });
  });

  it("impose l'unicité de l'équipe et du salon associés", async () => {
    const store = spaceStore.createPrismaSpaceLinkStore(ids.community);
    await store.save({ teamId: ids.team, communityId: ids.community, guildId: GUILD, channelId: "chan-1", roleId: "role-1" });
    expect(await db.discordTeamSpace.count()).toBe(1);
    await expect(
      db.discordTeamSpace.create({ data: { teamId: ids.team, communityId: ids.community, guildId: GUILD, channelId: "chan-2", roleId: "role-2" } })
    ).rejects.toMatchObject({ code: "P2002" });
    const other = await newTeam("Autre", ids.creator);
    await expect(
      db.discordTeamSpace.create({ data: { teamId: other.id, communityId: ids.community, guildId: GUILD, channelId: "chan-1", roleId: "role-9" } })
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("refuse une association vers une équipe d'une autre communauté et suit l'équipe en cascade", async () => {
    const foreign = await db.community.create({ data: { slug: "autre", name: "Autre", status: "ACTIVE" } });
    await expect(
      db.discordTeamSpace.create({ data: { teamId: ids.team, communityId: foreign.id, guildId: GUILD, channelId: "chan-x", roleId: "role-x" } })
    ).rejects.toMatchObject({ code: "P2003" });
    await spaceStore.createPrismaSpaceLinkStore(ids.community).save({ teamId: ids.team, communityId: ids.community, guildId: GUILD, channelId: "chan-1", roleId: "role-1" });
    await db.communityTeamMember.deleteMany({ where: { teamId: ids.team } });
    await db.communityTeam.delete({ where: { id: ids.team } });
    expect(await db.discordTeamSpace.count()).toBe(0);
  });

  it("reste idempotent sur un rejeu et sous créations concurrentes, et isole par communauté", async () => {
    const store = spaceStore.createPrismaSpaceLinkStore(ids.community);
    const link = { teamId: ids.team, communityId: ids.community, guildId: GUILD, channelId: "chan-1", voiceChannelId: "voice-1", roleId: "role-1" };
    await store.save(link);
    await store.save(link);
    const results = await Promise.allSettled([store.save({ ...link, channelId: "chan-2" }), store.save({ ...link, channelId: "chan-2" })]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    const rows = await db.discordTeamSpace.findMany({ where: { teamId: ids.team } });
    expect(rows).toHaveLength(1);
    expect(rows[0].channelId).toBe("chan-1");
    // Un store scopé sur une autre communauté ne voit rien.
    expect(await spaceStore.createPrismaSpaceLinkStore("autre-communaute").find(ids.team)).toBeNull();
  });

  it("conserve l'association après un nouveau client (redémarrage)", async () => {
    await spaceStore.createPrismaSpaceLinkStore(ids.community).save({ teamId: ids.team, communityId: ids.community, guildId: GUILD, channelId: "chan-1", roleId: "role-1" });
    const restarted = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
    try {
      const row = await restarted.discordTeamSpace.findUnique({ where: { teamId: ids.team } });
      expect(row).toMatchObject({ channelId: "chan-1", voiceChannelId: "voice-1", roleId: "role-1", archived: false });
      expect(await spaceStore.readTeamSpaceLink({ teamId: ids.team, communityId: ids.community })).toMatchObject({ status: "linked", channelId: "chan-1" });
    } finally {
      await restarted.$disconnect();
    }
  });

  it("file : une demande devient un événement + une livraison BOT, idempotente, résolue vers l'action de l'executor", async () => {
    expect(await queue.enqueueTeamSpaceSync({ teamId: ids.team, communityId: ids.community, intent: "provision" })).toBe("disabled");
    expect(await db.notificationEvent.count()).toBe(0);

    enableQueue();
    const now = new Date("2026-11-18T12:00:00Z");
    expect(await queue.enqueueTeamSpaceSync({ teamId: ids.team, communityId: ids.community, intent: "provision" }, now)).toBe("queued");
    expect(await queue.enqueueTeamSpaceSync({ teamId: ids.team, communityId: ids.community, intent: "provision" }, now)).toBe("queued");
    expect(await db.notificationEvent.count()).toBe(1);
    const delivery = await db.notificationDelivery.findFirstOrThrow({ include: { event: true } });
    expect(delivery).toMatchObject({ transport: "BOT", channel: "DISCORD_CHANNEL", operation: "SEND", status: "PENDING", recipientKey: `team:${ids.team}` });
    expect(delivery.event).toMatchObject({ category: "ADMIN", eventType: "TEAM_SPACE_SYNC", communityId: ids.community });

    const resolution = await dispatch.DISPATCH_RESOLVER.resolve({ delivery: delivery as never, event: delivery.event, now });
    expect(resolution).toEqual({
      eligible: true,
      action: { kind: "sync_team_space", intent: "provision", teamId: ids.team, communityId: ids.community, discordId: undefined },
    });

    // Drapeau refermé entre l'enqueue et l'exécution : rien n'est exécuté.
    vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "false");
    expect(await dispatch.DISPATCH_RESOLVER.resolve({ delivery: delivery as never, event: delivery.event, now })).toEqual({
      eligible: false,
      reason: "not_configured",
    });
  });

  it("file : une communauté sans serveur Discord relié n'enfile rien", async () => {
    enableQueue();
    await db.community.update({ where: { id: ids.community }, data: { discordGuildId: null } });
    expect(await queue.enqueueTeamSpaceSync({ teamId: ids.team, communityId: ids.community, intent: "provision" })).toBe("unavailable");
    expect(await db.notificationEvent.count()).toBe(0);
  });

  it("executor : création, adhésion, départ et archivage avec le vrai store SQL", async () => {
    vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "true");
    const calls = { roles: 0, channels: 0, added: [] as string[], removed: [] as string[], renamed: [] as string[] };
    const created: Array<{ id: string; name: string; type: number }> = [];
    const api = {
      // Reflète l'état Discord simulé : les ressources créées existent ensuite (reconcile ne recrée jamais).
      snapshot: async () => ({
        channels: [...created],
        roles: calls.roles > 0 ? [{ id: "role-flow", name: "GN · Les Dragons" }] : [],
      }),
      createRole: async () => {
        calls.roles += 1;
        return "role-flow";
      },
      createChannel: async (_guildId: string, name: string, type: number) => {
        calls.channels += 1;
        const id = type === 2 ? "voice-flow" : "chan-flow";
        created.push({ id, name, type });
        return id;
      },
      renameChannel: async (channelId: string) => {
        calls.renamed.push(channelId);
      },
      addMemberRole: async (_g: string, userId: string) => {
        calls.added.push(userId);
      },
      removeMemberRole: async (_g: string, userId: string) => {
        calls.removed.push(userId);
      },
    };
    const run = (input: Parameters<typeof runner.runTeamSpaceAction>[0]) => runner.runTeamSpaceAction(input, new Date(Date.now() + 20_000), api);
    const base = { teamId: ids.team, communityId: ids.community };

    expect(await run({ ...base, intent: "provision" })).toEqual({ ok: true, data: {} });
    expect(await run({ ...base, intent: "provision" })).toEqual({ ok: true, data: {} });
    // Option A : un rôle, un salon textuel ET un salon vocal par équipe.
    expect({ roles: calls.roles, channels: calls.channels }).toEqual({ roles: 1, channels: 2 });
    expect(created.map((channel) => channel.type).sort()).toEqual([0, 2]);
    expect(await db.discordTeamSpace.findUniqueOrThrow({ where: { teamId: ids.team } })).toMatchObject({
      channelId: "chan-flow",
      voiceChannelId: "voice-flow",
      roleId: "role-flow",
      guildId: GUILD,
    });
    expect(calls.added.sort()).toEqual([CREATOR_DISCORD, MEMBER_DISCORD]);

    // Départ : l'état courant décide, le rôle de cette seule équipe est retiré, aucune progression écrite.
    await db.communityTeamMember.deleteMany({ where: { teamId: ids.team, userId: ids.member } });
    const xpBefore = await db.xpEvent.count();
    expect(await run({ ...base, intent: "member", discordId: MEMBER_DISCORD })).toEqual({ ok: true, data: {} });
    expect(calls.removed).toEqual([MEMBER_DISCORD]);
    expect(await db.xpEvent.count()).toBe(xpBefore);

    // Dissolution : plus aucun membre, les DEUX salons associés (et eux seuls) sont archivés par renommage.
    await db.communityTeamMember.deleteMany({ where: { teamId: ids.team } });
    expect(await run({ ...base, intent: "reconcile" })).toEqual({ ok: true, data: {} });
    expect(calls.renamed).toEqual(["chan-flow", "voice-flow"]);
    expect((await db.discordTeamSpace.findUniqueOrThrow({ where: { teamId: ids.team } })).archived).toBe(true);
  });

  it("executor : flag fermé ou migration absente ne produit aucune écriture Discord", async () => {
    const touched: string[] = [];
    const api = new Proxy({}, { get: (_target, name) => async () => { touched.push(String(name)); return ""; } }) as never;
    const result = await runner.runTeamSpaceAction({ teamId: ids.team, communityId: ids.community, intent: "provision" }, new Date(Date.now() + 20_000), api);
    expect(result).toMatchObject({ ok: false, retryable: false });
    expect(touched).toEqual([]);
  });
});
