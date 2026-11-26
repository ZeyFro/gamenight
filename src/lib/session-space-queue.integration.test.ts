import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
if (!TEST_DATABASE_URL) console.warn("[session-space-queue] TEST_DATABASE_URL absente : tests PostgreSQL SKIPPÉS, espace temporaire NON validé sur SQL réel.");

/**
 * C080 — le fil et le vocal temporaires sont créés à T-30 min et nettoyés
 * après la fin, uniquement par la file puis l'executor. Ce test couvre le
 * chaînon absent des tests unitaires : le balayage réel (`scheduleSessionSpaces`)
 * et le résolveur qui autorise l'action Discord, sans aucun appel réseau.
 */
describe.skipIf(!TEST_DATABASE_URL)("file d'espace temporaire de soirée : PostgreSQL isolé", () => {
  let db: import("@prisma/client").PrismaClient;
  let queue: typeof import("./session-space-queue");
  const ids: Record<string, string> = {};
  const GUILD = "100000000000000001";
  const CHANNEL = "100000000000000002";
  const START = new Date("2026-12-05T20:00:00.000Z");

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    queue = await import("./session-space-queue");
  });
  afterAll(async () => {
    await db?.$disconnect();
    vi.unstubAllEnvs();
  });
  beforeEach(async () => {
    vi.stubEnv("SESSION_VISIBILITY_ENABLED", "true");
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-bot-token");
    vi.stubEnv("DISCORD_BOT_GUILD_ID", GUILD);
    vi.stubEnv("DISCORD_BOT_SESSION_CHANNEL_ID", CHANNEL);
    vi.stubEnv("COMMUNITY_CHANNELS_ENABLED", "false");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Réseau interdit dans cette intégration."); }));
    await db.$executeRawUnsafe(
      'TRUNCATE "NotificationDelivery", "NotificationEvent", "SessionDiscordSpace", "SessionInvite", "Session", "Membership", "User", "Community" CASCADE',
    );
    ids.community = (await db.community.create({
      data: { slug: "default", name: "Défaut", status: "ACTIVE" },
    })).id;
    ids.creator = (await db.user.create({
      data: { discordId: "200000000000000001", discordName: "Créateur", activeCommunityId: ids.community },
    })).id;
    ids.guest = (await db.user.create({
      data: { discordId: "200000000000000002", discordName: "Invité" },
    })).id;
    await db.membership.createMany({
      data: [
        { communityId: ids.community, userId: ids.creator, status: "ACTIVE" },
        { communityId: ids.community, userId: ids.guest, status: "ACTIVE" },
      ],
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function makeSession(status: "SCHEDULED" | "DONE" = "SCHEDULED", date = START, visibility: "PUBLIC" | "APPLICATION" | "PRIVATE" = "APPLICATION") {
    const session = await db.session.create({
      data: {
        communityId: ids.community,
        createdById: ids.creator,
        date,
        status,
        visibility,
        announceViaBot: true,
      },
    });
    await db.sessionInvite.create({
      data: { sessionId: session.id, userId: ids.guest, invitedById: ids.creator, status: "ACTIVE" },
    });
    return session;
  }

  async function resolveQueued(sessionId: string, intent: "provision" | "cleanup") {
    const delivery = await db.notificationDelivery.findFirstOrThrow({
      where: { targetSlot: `${GUILD}:ADMIN:${sessionId}:session-space-${intent}` },
      include: { event: true },
    });
    const result = await queue.sessionSpaceSyncResolver.resolve({
      delivery: { ...delivery, targetMessage: null },
      event: delivery.event,
      now: new Date("2026-12-05T19:40:00.000Z"),
    });
    return { delivery, result };
  }

  it("met en file la création à T-30, une seule fois par fenêtre, puis le résolveur autorise l'action", async () => {
    const session = await makeSession();
    const now = new Date(START.getTime() - 20 * 60_000);

    const first = await queue.scheduleSessionSpaces(now, now.getTime());
    expect(first).toMatchObject({ enabled: true, provisionQueued: 1, cleanupQueued: 0 });
    const { delivery, result } = await resolveQueued(session.id, "provision");
    expect(delivery).toMatchObject({
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: `session:${session.id}`,
    });
    expect(result).toEqual({
      eligible: true,
      action: { kind: "sync_session_space", intent: "provision", sessionId: session.id, communityId: ids.community },
    });

    // Même fenêtre de 10 min : la clé d'occurrence et le targetSlot sont idempotents.
    const replay = await queue.scheduleSessionSpaces(now, now.getTime() + 60_000);
    expect(replay.provisionQueued).toBe(1);
    expect(await db.notificationDelivery.count({ where: { targetSlot: `${GUILD}:ADMIN:${session.id}:session-space-provision` } })).toBe(1);

    // Un espace déjà complet n'est plus balayé et le résolveur refuse un éventuel rejeu.
    await db.sessionDiscordSpace.create({
      data: {
        sessionId: session.id,
        communityId: ids.community,
        guildId: GUILD,
        parentChannelId: CHANNEL,
        threadId: "300000000000000001",
        voiceChannelId: "400000000000000001",
      },
    });
    const another = await queue.scheduleSessionSpaces(now, now.getTime() + 20 * 60_000);
    expect(another.provisionQueued).toBe(0);
    expect(await queue.sessionSpaceSyncResolver.resolve({
      delivery: { ...delivery, targetMessage: null },
      event: delivery.event,
      now,
    })).toEqual({ eligible: false, reason: "expired" });
  });

  it("ne met en file les espaces temporaires que pour les soirées APPLICATION et PRIVATE", async () => {
    const publicSession = await makeSession("SCHEDULED", START, "PUBLIC");
    const applicationSession = await makeSession("SCHEDULED", START, "APPLICATION");
    const privateSession = await makeSession("SCHEDULED", START, "PRIVATE");
    const now = new Date(START.getTime() - 20 * 60_000);

    const scan = await queue.scheduleSessionSpaces(now, now.getTime());
    expect(scan).toMatchObject({ enabled: true, provisionQueued: 2, cleanupQueued: 0 });
    const slots = (await db.notificationDelivery.findMany({ select: { targetSlot: true } })).map(row => row.targetSlot);
    expect(slots.some(slot => slot.includes(`:${publicSession.id}:session-space-provision`))).toBe(false);
    expect(slots.some(slot => slot.includes(`:${applicationSession.id}:session-space-provision`))).toBe(true);
    expect(slots.some(slot => slot.includes(`:${privateSession.id}:session-space-provision`))).toBe(true);
  });

  it("le résolveur refuse un provisionnement en attente si la soirée est devenue publique", async () => {
    const session = await makeSession("SCHEDULED", START, "APPLICATION");
    const now = new Date(START.getTime() - 20 * 60_000);
    await queue.scheduleSessionSpaces(now, now.getTime());
    await db.session.update({ where: { id: session.id }, data: { visibility: "PUBLIC" } });

    const { result } = await resolveQueued(session.id, "provision");
    expect(result).toEqual({ eligible: false, reason: "expired" });
  });

  it("met en file le nettoyage après la fin et le résolveur l'autorise, jamais avant", async () => {
    const session = await makeSession("SCHEDULED", new Date(START.getTime() - 7 * 3_600_000));
    const beforeEnd = new Date(START.getTime() - 3_600_000);
    const before = await queue.scheduleSessionSpaces(beforeEnd, beforeEnd.getTime());
    expect(before.cleanupQueued).toBe(0);

    await db.sessionDiscordSpace.create({
      data: {
        sessionId: session.id,
        communityId: ids.community,
        guildId: GUILD,
        parentChannelId: CHANNEL,
        threadId: "300000000000000001",
        voiceChannelId: "400000000000000001",
      },
    });
    const afterEnd = new Date(START.getTime() + 3_600_000);
    const after = await queue.scheduleSessionSpaces(afterEnd, afterEnd.getTime());
    expect(after.cleanupQueued).toBe(1);
    const { result } = await resolveQueued(session.id, "cleanup");
    expect(result).toEqual({
      eligible: true,
      action: { kind: "sync_session_space", intent: "cleanup", sessionId: session.id, communityId: ids.community },
    });
  });

  it("reste inerte sans executor ou sans jeton, sans aucune écriture", async () => {
    await makeSession();
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "false");
    const noExecutor = await queue.scheduleSessionSpaces(new Date(START.getTime() - 20 * 60_000), Date.now());
    expect(noExecutor).toEqual({ enabled: false, provisionQueued: 0, cleanupQueued: 0 });
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_TOKEN", "");
    const noToken = await queue.scheduleSessionSpaces(new Date(START.getTime() - 20 * 60_000), Date.now());
    expect(noToken).toEqual({ enabled: false, provisionQueued: 0, cleanupQueued: 0 });
    expect(await db.notificationEvent.count()).toBe(0);
    expect(await db.notificationDelivery.count()).toBe(0);
  });
});
