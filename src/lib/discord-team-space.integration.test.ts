import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * Recette SQL isolée : PostgreSQL jetable (`TEST_DATABASE_URL`), jamais Neon ni
 * Production. Prérequis : `prisma migrate deploy` (migration
 * `20261118110000_discord_team_space`). Ignorée sans `TEST_DATABASE_URL`, ce qui
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
    await spaceStore.createPrismaSpaceLinkStore(ids.community).save({ teamId: ids.team, communityId: ids.community, guildId: GUILD, channelId: "chan-1", voiceChannelId: "voice-1", roleId: "role-1" });
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
    const calls = { channels: 0, permissions: [] as string[], removed: [] as string[], renamed: [] as string[] };
    const created: Array<{ id: string; name: string; type: number }> = [];
    const api = {
      // Reflète l'état Discord simulé : les ressources créées existent ensuite (reconcile ne recrée jamais).
      snapshot: async () => ({ channels: [...created], roles: [] }),
      createChannel: async (_guildId: string, name: string, type: number) => {
        calls.channels += 1;
        const id = type === 2 ? "voice-flow" : "chan-flow";
        created.push({ id, name, type });
        return id;
      },
      setMemberPermission: async (channelId: string, userId: string, _allow: string, action: string) => {
        (action === "remove" ? calls.removed : calls.permissions).push(`${channelId}:${userId}`);
      },
      renameChannel: async (channelId: string) => {
        calls.renamed.push(channelId);
      },
      deleteChannel: async () => undefined,
      createRole: async () => "legacy-role",
      addMemberRole: async () => undefined,
      removeMemberRole: async () => undefined,
    };
    const run = (input: Parameters<typeof runner.runTeamSpaceAction>[0]) => runner.runTeamSpaceAction(input, new Date(Date.now() + 20_000), api);
    const base = { teamId: ids.team, communityId: ids.community };

    expect(await run({ ...base, intent: "provision" })).toEqual({ ok: true, data: {} });
    expect(await run({ ...base, intent: "provision" })).toEqual({ ok: true, data: {} });
    // D5 : aucun rôle d'équipe, un salon textuel et un vocal, permissions nominatives par membre.
    expect(calls.channels).toBe(2);
    expect(created.map((channel) => channel.type).sort()).toEqual([0, 2]);
    expect(await db.discordTeamSpace.findUniqueOrThrow({ where: { teamId: ids.team } })).toMatchObject({
      channelId: "chan-flow",
      voiceChannelId: "voice-flow",
      roleId: null,
      guildId: GUILD,
    });
    expect([...new Set(calls.permissions)].sort()).toEqual([
      `chan-flow:${CREATOR_DISCORD}`, `chan-flow:${MEMBER_DISCORD}`,
      `voice-flow:${CREATOR_DISCORD}`, `voice-flow:${MEMBER_DISCORD}`,
    ]);

    // Départ : les permissions nominatives des deux salons sont retirées, aucune progression écrite.
    await db.communityTeamMember.deleteMany({ where: { teamId: ids.team, userId: ids.member } });
    const xpBefore = await db.xpEvent.count();
    expect(await run({ ...base, intent: "member", discordId: MEMBER_DISCORD })).toEqual({ ok: true, data: {} });
    expect([...new Set(calls.removed)].sort()).toEqual([`chan-flow:${MEMBER_DISCORD}`, `voice-flow:${MEMBER_DISCORD}`]);
    expect(await db.xpEvent.count()).toBe(xpBefore);

    // Dissolution : plus aucun membre, les DEUX salons associés (et eux seuls) sont archivés par renommage.
    await db.communityTeamMember.deleteMany({ where: { teamId: ids.team } });
    expect(await run({ ...base, intent: "reconcile" })).toEqual({ ok: true, data: {} });
    expect(calls.renamed).toEqual(["chan-flow", "voice-flow"]);
    expect((await db.discordTeamSpace.findUniqueOrThrow({ where: { teamId: ids.team } })).archived).toBe(true);
  });

  it("executor D5 : suppression revérifiée à l'exécution (équipe repeuplée, contestation ouverte), accès retirés AVANT les salons, identifiants enregistrés seulement", async () => {
    vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "true");
    // Le journal n'est pas vidé par le TRUNCATE de beforeEach : on repart d'un journal propre pour compter exactement les traces de CE test.
    await db.sensitiveOperationLog.deleteMany({ where: { action: "discord.team_space_delete" } });
    await db.discordTeamSpace.create({ data: { teamId: ids.team, communityId: ids.community, guildId: GUILD, channelId: "chan-del", voiceChannelId: "voice-del" } });
    const present = [
      { id: "chan-del", name: "les-dragons", type: 0 }, { id: "voice-del", name: "vocal-les-dragons", type: 2 },
      // Même nom, identifiants non enregistrés : ne doit JAMAIS être touché.
      { id: "intrus", name: "les-dragons", type: 0 },
    ];
    const log: string[] = [];
    const api = {
      snapshot: async () => ({ channels: [...present], roles: [] }),
      setMemberPermission: async (channelId: string, userId: string, _allow: string, action: string) => { log.push(`${action}:${channelId}:${userId}`); },
      deleteChannel: async (channelId: string) => { log.push(`delete:${channelId}`); present.splice(present.findIndex((c) => c.id === channelId), 1); },
      createRole: async () => "r", createChannel: async () => "c", renameChannel: async () => undefined, addMemberRole: async () => undefined, removeMemberRole: async () => undefined,
    };
    const run = () => runner.runTeamSpaceAction({ teamId: ids.team, communityId: ids.community, intent: "delete", actorUserId: ids.creator,
      formerMemberDiscordIds: [CREATOR_DISCORD, MEMBER_DISCORD] }, new Date(Date.now() + 20_000), api as never);
    const deletedAt = async () => (await db.discordTeamSpace.findUniqueOrThrow({ where: { teamId: ids.team } })).deletedAt;

    // 1) L'équipe a été repeuplée depuis la demande : abandon AVANT tout appel Discord, trace au journal, lien intact.
    expect(await run()).toEqual({ ok: true, data: {} });
    expect(log).toEqual([]);
    expect(await deletedAt()).toBeNull();
    expect(await db.sensitiveOperationLog.count({ where: { action: "discord.team_space_delete", outcome: "not_dissolved" } })).toBe(1);

    // 2) Équipe vidée, mais une contestation Tower s'est ouverte entre la demande et l'exécution : abandon, trace, lien intact.
    await db.communityTeamMember.deleteMany({ where: { teamId: ids.team } });
    const definition = await db.towerChallengeDefinition.create({ data: { communityId: ids.community, title: "Défi", instructions: "Réaliser le défi.", rewardFloors: 1 } });
    const attempt = await db.towerChallengeAttempt.create({ data: { communityId: ids.community, userId: ids.creator, teamId: ids.team, definitionId: definition.id, requestKey: "k-del",
      title: "Défi", instructions: "Réaliser le défi.", rewardFloors: 1, assignedAt: new Date("2030-01-01T00:00:00Z"), expiresAt: new Date("2030-01-03T00:00:00Z"),
      status: "REJECTED", rejectedAt: new Date("2030-01-03T01:00:00Z") } });
    const appeal = await db.towerChallengeAppeal.create({ data: { communityId: ids.community, attemptId: attempt.id, authorUserId: ids.creator, reason: "Contestation du verdict.", dueAt: new Date("2030-01-08") } });
    expect(await run()).toEqual({ ok: true, data: {} });
    // I1 : l'abandon est terminal ; les accès nominatifs des anciens membres sont retirés (réversible) AVANT, aucun salon n'est supprimé.
    expect(log).toHaveLength(4);
    expect(log.every((line) => line.startsWith("remove:"))).toBe(true);
    expect(await deletedAt()).toBeNull();
    expect(await db.sensitiveOperationLog.count({ where: { action: "discord.team_space_delete", outcome: "blocked" } })).toBe(1);
    log.length = 0;

    // 3) Contestation close : les accès nominatifs sont retirés AVANT toute suppression, puis les deux salons enregistrés (et eux seuls) disparaissent.
    await db.towerChallengeAppeal.update({ where: { id: appeal.id }, data: { status: "UPHELD", decidedAt: new Date() } });
    expect(await run()).toEqual({ ok: true, data: {} });
    const firstDelete = log.findIndex((line) => line.startsWith("delete:"));
    expect(firstDelete).toBeGreaterThan(0);
    expect(log.slice(0, firstDelete).every((line) => line.startsWith("remove:"))).toBe(true);
    expect(log.slice(0, firstDelete)).toHaveLength(4);
    expect(log.filter((line) => line.startsWith("delete:")).sort()).toEqual(["delete:chan-del", "delete:voice-del"]);
    expect(present.map((channel) => channel.id)).toEqual(["intrus"]);
    expect(await deletedAt()).toBeInstanceOf(Date);
    expect(await db.sensitiveOperationLog.count({ where: { action: "discord.team_space_delete", outcome: "ok" } })).toBe(1);

    // 4) Rejeu : état cible atteint, aucune nouvelle écriture Discord.
    const before = log.length;
    expect(await run()).toEqual({ ok: true, data: {} });
    expect(log).toHaveLength(before);
  });

  it("executor D5 : sans liste d'anciens membres, les surcharges nominatives des salons ENREGISTRÉS sont relues et retirées ; les identifiants Discord sont purgés de l'événement après un traitement terminal, conservés si l'échec est rejouable", async () => {
    enableQueue();
    await db.discordTeamSpace.create({ data: { teamId: ids.team, communityId: ids.community, guildId: GUILD, channelId: "chan-ov", voiceChannelId: "voice-ov" } });
    await db.communityTeamMember.deleteMany({ where: { teamId: ids.team } });
    const log: string[] = [];
    let failDelete = true;
    const present = [
      { id: "chan-ov", name: "a", type: 0, memberOverwriteIds: [CREATOR_DISCORD, MEMBER_DISCORD] },
      { id: "voice-ov", name: "b", type: 2, memberOverwriteIds: [CREATOR_DISCORD] },
      { id: "etranger", name: "a", type: 0, memberOverwriteIds: ["100000000000000099"] },
    ];
    const api = {
      snapshot: async () => ({ channels: [...present], roles: [] }),
      setMemberPermission: async (channelId: string, userId: string) => { log.push(`remove:${channelId}:${userId}`); },
      deleteChannel: async (channelId: string) => {
        if (failDelete) throw new Error("discord_server_error");
        log.push(`delete:${channelId}`);
      },
      createRole: async () => "r", createChannel: async () => "c", renameChannel: async () => undefined, addMemberRole: async () => undefined, removeMemberRole: async () => undefined,
    };
    const payloadIds = async () => (await db.notificationEvent.findFirstOrThrow({ where: { eventType: "TEAM_SPACE_SYNC", sourceId: ids.team } })).payload as { formerMemberDiscordIds?: string[] };
    expect(await queue.enqueueTeamSpaceSync({ teamId: ids.team, communityId: ids.community, intent: "delete", actorUserId: ids.creator, formerMemberDiscordIds: [CREATOR_DISCORD, MEMBER_DISCORD] })).toBe("queued");
    expect((await payloadIds()).formerMemberDiscordIds).toHaveLength(2);
    // Aucune liste transportée (cas « liste perdue ») : les accès viennent des surcharges réellement posées.
    const run = () => runner.runTeamSpaceAction({ teamId: ids.team, communityId: ids.community, intent: "delete", actorUserId: ids.creator }, new Date(Date.now() + 20_000), api as never);

    // Échec rejouable (suppression refusée par Discord) : les accès sont DÉJÀ retirés, les identifiants restent pour le rejeu.
    expect((await run()).ok).toBe(false);
    expect(log.filter((line) => line.startsWith("remove:")).sort()).toEqual([
      `remove:chan-ov:${CREATOR_DISCORD}`, `remove:chan-ov:${MEMBER_DISCORD}`, `remove:voice-ov:${CREATOR_DISCORD}`, `remove:voice-ov:${MEMBER_DISCORD}`,
    ]);
    expect(log.some((line) => line.includes("etranger") || line.includes("100000000000000099"))).toBe(false);
    expect((await payloadIds()).formerMemberDiscordIds).toHaveLength(2);

    // Succès : salons supprimés (enregistrés seulement) puis identifiants Discord purgés de la charge de l'événement.
    failDelete = false;
    expect(await run()).toEqual({ ok: true, data: {} });
    expect(log.filter((line) => line.startsWith("delete:")).sort()).toEqual(["delete:chan-ov", "delete:voice-ov"]);
    expect((await payloadIds()).formerMemberDiscordIds).toBeUndefined();
    expect(await payloadIds()).toMatchObject({ intent: "delete", actorUserId: ids.creator });
  });

  it("executor : flag fermé ou migration absente ne produit aucune écriture Discord", async () => {
    const touched: string[] = [];
    const api = new Proxy({}, { get: (_target, name) => async () => { touched.push(String(name)); return ""; } }) as never;
    const result = await runner.runTeamSpaceAction({ teamId: ids.team, communityId: ids.community, intent: "provision" }, new Date(Date.now() + 20_000), api);
    expect(result).toMatchObject({ ok: false, retryable: false });
    expect(touched).toEqual([]);
  });
});
