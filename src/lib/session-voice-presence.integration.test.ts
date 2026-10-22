import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const COMMUNITY_ID = "voice-race-community";
const USER_ID = "voice-race-user";
const GUEST_USER_ID = "voice-race-guest";
const SESSION_ID = "voice-race-session";
const DISCORD_ID = "998877665544332211";
const GUEST_DISCORD_ID = "998877665544332212";
const GUILD_ID = "123456789012345678";
const CHANNEL_ID = "456789012345678901";

type TransactionClient = import("@prisma/client").Prisma.TransactionClient;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
vi.mock("@/lib/current-user", () => ({ getCurrentUser: vi.fn() }));

if (!TEST_DATABASE_URL) console.warn("[session-voice-presence] Postgres absent : test de course ignoré.");

describe.skipIf(!TEST_DATABASE_URL)("session voice presence : course de révocation Postgres", () => {
  let db: import("@prisma/client").PrismaClient;
  let revocationDb: import("@prisma/client").PrismaClient;
  let voicePresence: typeof import("./session-voice-presence");
  let coordination: typeof import("./voice-presence-coordination");

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    revocationDb = new (await import("@prisma/client")).PrismaClient({ datasourceUrl: TEST_DATABASE_URL! });
    voicePresence = await import("./session-voice-presence");
    coordination = await import("./voice-presence-coordination");
  });

  afterAll(async () => {
    await Promise.all([db.$disconnect(), revocationDb.$disconnect()]);
  });

  const cleanup = async () => {
    await db.sessionVoicePresenceInterval.deleteMany({ where: { sessionId: SESSION_ID } });
    await db.session.deleteMany({ where: { id: SESSION_ID } });
    await db.communityChannelConfig.deleteMany({ where: { communityId: COMMUNITY_ID } });
    await db.membership.deleteMany({ where: { communityId: COMMUNITY_ID } });
    await db.community.deleteMany({ where: { id: COMMUNITY_ID } });
    await db.user.deleteMany({ where: { id: { in: [USER_ID, GUEST_USER_ID] } } });
  };

  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    await cleanup();
    const priorStart = new Date(Date.now() - 10 * 60 * 1000);
    await db.community.create({ data: {
      id: COMMUNITY_ID,
      slug: COMMUNITY_ID,
      name: "Voice race test",
      discordGuildId: GUILD_ID,
      status: "ACTIVE",
    } });
    await db.user.create({ data: { id: USER_ID, discordId: DISCORD_ID, discordName: "Voice race member" } });
    await db.membership.create({ data: { communityId: COMMUNITY_ID, userId: USER_ID, status: "ACTIVE" } });
    await db.communityChannelConfig.create({ data: {
      communityId: COMMUNITY_ID,
      category: "VOICE",
      discordChannelId: CHANNEL_ID,
      enabled: true,
    } });
    await db.session.create({ data: {
      id: SESSION_ID,
      communityId: COMMUNITY_ID,
      createdById: USER_ID,
      date: new Date(priorStart.getTime() - 24 * 60 * 60 * 1000),
      status: "SCHEDULED",
    } });
    await db.sessionVoicePresenceControl.create({ data: {
      sessionId: SESSION_ID,
      leaseOwner: "synthetic-worker",
      generation: 1,
      leaseExpiresAt: new Date(Date.now() + 6 * 60 * 60_000),
    } });
    await db.sessionVoicePresenceConsent.create({
      data: { sessionId: SESSION_ID, userId: USER_ID, consentedAt: new Date(priorStart.getTime() - 60_000) },
    });
  });

  async function assertWriterWinsRace(
    table: "Session" | "Community" | "CommunityChannelConfig" | "SessionInvite" | "Membership",
    mutate: (tx: TransactionClient) => Promise<unknown>,
    memberKey = DISCORD_ID,
  ) {
    let releaseWriter!: () => void;
    let announceWriterReady!: () => void;
    let writerPid = 0;
    const holdWriter = new Promise<void>(resolve => { releaseWriter = resolve; });
    const writerReady = new Promise<void>(resolve => { announceWriterReady = resolve; });
    const writer = revocationDb.$transaction(async tx => {
      await mutate(tx);
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
      writerPid = backend.pid;
      announceWriterReady();
      await holdWriter;
    }, { timeout: 15_000 });
    await writerReady;

    const startedAt = Date.now() - 10 * 60 * 1000;
    const store = voicePresence.storeSessionVoiceInterval(
      { guildId: GUILD_ID, channelIds: [CHANNEL_ID], sessionId: SESSION_ID, workerId: "synthetic-worker", generation: 1 },
      { memberKey, channelId: CHANNEL_ID, startedAt, endedAt: startedAt + 60_000 },
    );
    let waitError: unknown;
    try {
      await vi.waitFor(async () => {
        const waiting = await db.$queryRaw<{ pid: number }[]>`
          SELECT pid
          FROM pg_stat_activity
          WHERE wait_event_type = 'Lock'
            AND query ILIKE ${`%"${table}"%`}
            AND query ILIKE '%FOR SHARE%'
            AND pg_blocking_pids(pid) @> ARRAY[${writerPid}]::int[]
        `;
        expect(waiting.length).toBeGreaterThan(0);
      }, { timeout: 4_000 });
    } catch (error) {
      waitError = error;
    } finally {
      releaseWriter();
      await writer;
    }

    let stored: boolean | undefined;
    let storeError: unknown;
    try {
      stored = await store;
    } catch (error) {
      storeError = error;
    }
    expect(waitError).toBeUndefined();
    expect(storeError).toBeUndefined();
    expect(stored).toBe(false);
    expect(await db.sessionVoicePresenceInterval.count({ where: { sessionId: SESSION_ID } })).toBe(0);
  }

  afterEach(async () => {
    await cleanup();
    vi.unstubAllEnvs();
  });

  it("does not insert when revocation holds the membership lock first", async () => {
    await assertWriterWinsRace("Membership", tx => tx.membership.update({
      where: { communityId_userId: { communityId: COMMUNITY_ID, userId: USER_ID } },
      data: { status: "LEFT" },
    }));
    expect((await db.membership.findUniqueOrThrow({ where: { communityId_userId: { communityId: COMMUNITY_ID, userId: USER_ID } } })).status).toBe("LEFT");
  }, 15_000);

  it("does not insert when the session is marked DONE first", async () => {
    await assertWriterWinsRace("Session", tx => tx.session.update({
      where: { id: SESSION_ID },
      data: { status: "DONE" },
    }));
    expect((await db.session.findUniqueOrThrow({ where: { id: SESSION_ID } })).status).toBe("DONE");
  }, 15_000);

  it("does not insert when the community leaves the active state first", async () => {
    await assertWriterWinsRace("Community", tx => tx.community.update({
      where: { id: COMMUNITY_ID },
      data: { status: "LEFT" },
    }));
    expect((await db.community.findUniqueOrThrow({ where: { id: COMMUNITY_ID } })).status).toBe("LEFT");
  }, 15_000);

  it("does not insert when the VOICE channel is disabled first", async () => {
    await assertWriterWinsRace("CommunityChannelConfig", tx => tx.communityChannelConfig.update({
      where: { communityId_category: { communityId: COMMUNITY_ID, category: "VOICE" } },
      data: { enabled: false },
    }));
    expect((await db.communityChannelConfig.findUniqueOrThrow({ where: { communityId_category: { communityId: COMMUNITY_ID, category: "VOICE" } } })).enabled).toBe(false);
  }, 15_000);

  it("does not insert when the active invite is revoked first", async () => {
    await db.user.create({ data: { id: GUEST_USER_ID, discordId: GUEST_DISCORD_ID, discordName: "Voice race guest" } });
    await db.membership.create({ data: { communityId: COMMUNITY_ID, userId: GUEST_USER_ID, status: "ACTIVE" } });
    await db.sessionInvite.create({ data: { sessionId: SESSION_ID, userId: GUEST_USER_ID, invitedById: USER_ID, status: "ACTIVE" } });
    await assertWriterWinsRace("SessionInvite", tx => tx.sessionInvite.update({
      where: { sessionId_userId: { sessionId: SESSION_ID, userId: GUEST_USER_ID } },
      data: { status: "REVOKED", revokedAt: new Date(), revokedById: USER_ID },
    }), GUEST_DISCORD_ID);
    expect((await db.sessionInvite.findUniqueOrThrow({ where: { sessionId_userId: { sessionId: SESSION_ID, userId: GUEST_USER_ID } } })).status).toBe("REVOKED");
  }, 15_000);

  it("keeps the explicit active-invite path without a membership when isolation is off", async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    await db.user.create({ data: { id: GUEST_USER_ID, discordId: GUEST_DISCORD_ID, discordName: "Voice race guest" } });
    await db.sessionInvite.create({ data: { sessionId: SESSION_ID, userId: GUEST_USER_ID, invitedById: USER_ID, status: "ACTIVE" } });
    const startedAt = Date.now() - 10 * 60 * 1000;
    await db.sessionVoicePresenceConsent.create({
      data: { sessionId: SESSION_ID, userId: GUEST_USER_ID, consentedAt: new Date(startedAt - 1_000) },
    });
    expect(await voicePresence.storeSessionVoiceInterval(
      { guildId: GUILD_ID, channelIds: [CHANNEL_ID], sessionId: SESSION_ID, workerId: "synthetic-worker", generation: 1 },
      { memberKey: GUEST_DISCORD_ID, channelId: CHANNEL_ID, startedAt, endedAt: startedAt + 60_000 },
    )).toBe(true);
    expect(await db.membership.count({ where: { communityId: COMMUNITY_ID, userId: GUEST_USER_ID } })).toBe(0);
    expect(await db.sessionVoicePresenceInterval.count({ where: { sessionId: SESSION_ID, userId: GUEST_USER_ID } })).toBe(1);
  }, 15_000);

  it("deletes the participant's rows on withdrawal and rejects delayed old-consent events after re-consent", async () => {
    const config = { guildId: GUILD_ID, channelIds: [CHANNEL_ID], sessionId: SESSION_ID, workerId: "synthetic-worker", generation: 1 };
    const startedAt = Date.now() - 10 * 60 * 1000;
    expect(await voicePresence.storeSessionVoiceInterval(config, {
      memberKey: DISCORD_ID, channelId: CHANNEL_ID, startedAt, endedAt: startedAt + 60_000,
    })).toBe(true);
    expect(await voicePresence.withdrawSessionVoiceConsent(SESSION_ID, USER_ID)).toBe(true);
    expect(await db.sessionVoicePresenceInterval.count({ where: { sessionId: SESSION_ID, userId: USER_ID } })).toBe(0);
    expect(await db.sessionVoicePresenceControl.findUniqueOrThrow({ where: { sessionId: SESSION_ID } }))
      .toMatchObject({ leaseOwner: null, leaseExpiresAt: null, generation: 2 });
    expect(await voicePresence.storeSessionVoiceInterval(config, {
      memberKey: DISCORD_ID, channelId: CHANNEL_ID, startedAt: startedAt + 60_000, endedAt: startedAt + 120_000,
    })).toBe(false);
    expect(await coordination.claimSessionVoicePresenceLease(SESSION_ID, "synthetic-worker", new Date()))
      .toEqual({ claimed: false });

    const reconsentedAt = new Date();
    expect(await voicePresence.grantSessionVoiceConsent(SESSION_ID, USER_ID, reconsentedAt)).toBe(true);
    expect(await voicePresence.storeSessionVoiceInterval(config, {
      memberKey: DISCORD_ID,
      channelId: CHANNEL_ID,
      startedAt: reconsentedAt.getTime() - 1_000,
      endedAt: reconsentedAt.getTime() + 60_000,
    })).toBe(false);
    expect(await db.sessionVoicePresenceInterval.count({ where: { sessionId: SESSION_ID, userId: USER_ID } })).toBe(0);
  }, 15_000);

  it("keeps the lease when another participant still consents", async () => {
    await db.user.create({ data: { id: GUEST_USER_ID, discordId: GUEST_DISCORD_ID, discordName: "Voice race guest" } });
    await db.sessionVoicePresenceConsent.create({ data: { sessionId: SESSION_ID, userId: GUEST_USER_ID } });

    expect(await voicePresence.withdrawSessionVoiceConsent(SESSION_ID, USER_ID)).toBe(true);
    expect(await db.sessionVoicePresenceControl.findUniqueOrThrow({ where: { sessionId: SESSION_ID } }))
      .toMatchObject({ leaseOwner: "synthetic-worker", generation: 1 });
    expect(await coordination.claimSessionVoicePresenceLease(SESSION_ID, "synthetic-worker", new Date()))
      .toMatchObject({ claimed: true, generation: 1 });
  }, 15_000);

  it("rejects a claimed target when consent is withdrawn before Gateway startup", async () => {
    const now = new Date();
    expect(await coordination.claimSessionVoicePresenceLease(SESSION_ID, "synthetic-worker", now))
      .toMatchObject({ claimed: true, generation: 1 });
    expect(await voicePresence.withdrawSessionVoiceConsent(SESSION_ID, USER_ID)).toBe(true);

    expect(await coordination.validateSessionVoicePresenceLease(SESSION_ID, "synthetic-worker", 1, new Date()))
      .toBe(false);
    expect(await voicePresence.storeSessionVoiceInterval(
      { guildId: GUILD_ID, channelIds: [CHANNEL_ID], sessionId: SESSION_ID, workerId: "synthetic-worker", generation: 1 },
      { memberKey: DISCORD_ID, channelId: CHANNEL_ID, startedAt: now.getTime(), endedAt: now.getTime() + 60_000 },
    )).toBe(false);
    expect(await db.sessionVoicePresenceInterval.count({ where: { sessionId: SESSION_ID } })).toBe(0);
  }, 15_000);

  it("serializes a concurrent interval write and withdrawal so no contribution survives", async () => {
    const config = { guildId: GUILD_ID, channelIds: [CHANNEL_ID], sessionId: SESSION_ID, workerId: "synthetic-worker", generation: 1 };
    const startedAt = Date.now() - 10 * 60 * 1000;
    const [, withdrawn] = await Promise.all([
      voicePresence.storeSessionVoiceInterval(config, {
        memberKey: DISCORD_ID, channelId: CHANNEL_ID, startedAt, endedAt: startedAt + 60_000,
      }),
      voicePresence.withdrawSessionVoiceConsent(SESSION_ID, USER_ID),
    ]);

    expect(withdrawn).toBe(true);
    expect(await db.sessionVoicePresenceConsent.count({ where: { sessionId: SESSION_ID, userId: USER_ID } })).toBe(0);
    expect(await db.sessionVoicePresenceInterval.count({ where: { sessionId: SESSION_ID, userId: USER_ID } })).toBe(0);
  }, 15_000);
});
