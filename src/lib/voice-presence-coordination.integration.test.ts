import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const COMMUNITY_ID = "voice-control-community";
const USER_ID = "voice-control-user";
const SESSION_ID = "voice-control-session";

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

describe.skipIf(!TEST_DATABASE_URL)("coordination durable du worker de présence vocale", () => {
  let db: import("@prisma/client").PrismaClient;
  let otherDb: import("@prisma/client").PrismaClient;
  let coordination: typeof import("./voice-presence-coordination");
  let retention: typeof import("./voice-presence-retention");

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    otherDb = new (await import("@prisma/client")).PrismaClient({ datasourceUrl: TEST_DATABASE_URL! });
    coordination = await import("./voice-presence-coordination");
    retention = await import("./voice-presence-retention");
  });

  afterAll(async () => { await Promise.all([db.$disconnect(), otherDb.$disconnect()]); });

  beforeEach(async () => {
    await db.sessionVoicePresenceControl.deleteMany({ where: { sessionId: SESSION_ID } });
    await db.sessionVoicePresenceInterval.deleteMany({ where: { sessionId: SESSION_ID } });
    await db.sessionVoicePresenceConsent.deleteMany({ where: { sessionId: SESSION_ID } });
    await db.session.deleteMany({ where: { id: SESSION_ID } });
    await db.communityChannelConfig.deleteMany({ where: { communityId: COMMUNITY_ID } });
    await db.community.deleteMany({ where: { id: COMMUNITY_ID } });
    await db.user.deleteMany({ where: { id: { in: [USER_ID, `${USER_ID}-active`] } } });
    await db.community.create({ data: { id: COMMUNITY_ID, slug: COMMUNITY_ID, name: "Voice control", status: "ACTIVE" } });
    await db.user.create({ data: { id: USER_ID, discordId: "891234567890123456", discordName: "Voice member" } });
    await db.session.create({ data: {
      id: SESSION_ID,
      communityId: COMMUNITY_ID,
      createdById: USER_ID,
      date: new Date("2026-10-22T10:00:00.000Z"),
      status: "SCHEDULED",
    } });
  });

  it("fences a second worker and records a gap when an expired lease is taken over", async () => {
    const now = new Date("2026-10-22T20:00:00.000Z");
    const [first, concurrent] = await Promise.all([
      coordination.claimSessionVoicePresenceLease(SESSION_ID, "worker-a", now, 30_000),
      coordination.claimSessionVoicePresenceLease(SESSION_ID, "worker-b", now, 30_000),
    ]);
    expect([first.claimed, concurrent.claimed].filter(Boolean)).toHaveLength(1);
    const initialGeneration = first.claimed ? first.generation : concurrent.generation;

    const takeover = await coordination.claimSessionVoicePresenceLease(
      SESSION_ID,
      first.claimed ? "worker-b" : "worker-a",
      new Date(now.getTime() + 31_000),
      30_000,
    );

    expect(takeover).toMatchObject({ claimed: true, generation: initialGeneration! + 1, gapDetected: true });
    const state = await db.sessionVoicePresenceControl.findUniqueOrThrow({ where: { sessionId: SESSION_ID } });
    expect(state.gapDetected).toBe(true);
    expect(state.gapStartedAt).toEqual(now);
    expect(state.lastGapAt).toBeNull();
    expect(await db.sessionVoicePresenceInterval.count({ where: { sessionId: SESSION_ID } })).toBe(0);

    const recoveredAt = new Date(now.getTime() + 36_000);
    await coordination.markSessionVoicePresenceGapRecovered(
      SESSION_ID,
      first.claimed ? "worker-b" : "worker-a",
      initialGeneration! + 1,
      recoveredAt,
    );
    const recovered = await db.sessionVoicePresenceControl.findUniqueOrThrow({ where: { sessionId: SESSION_ID } });
    expect(recovered.gapStartedAt).toEqual(now);
    expect(recovered.lastGapAt).toEqual(recoveredAt);
    expect(await db.sessionVoicePresenceInterval.count({ where: { sessionId: SESSION_ID } })).toBe(0);
  });

  it("commits a session cutoff without waiting for the worker", async () => {
    const at = new Date("2026-10-22T20:15:00.000Z");
    const consent = await db.sessionVoicePresenceConsent.create({ data: { sessionId: SESSION_ID, userId: USER_ID } });
    await db.sessionVoicePresenceInterval.create({ data: {
      sessionId: SESSION_ID,
      userId: USER_ID,
      consentId: consent.id,
      channelId: "456789012345678901",
      startedAt: new Date(at.getTime() - 60_000),
      endedAt: new Date(at.getTime() - 30_000),
      durationSeconds: 30,
      expiresAt: new Date(at.getTime() + 29 * 24 * 60 * 60_000),
    } });
    await db.sessionVoicePresenceControl.create({ data: {
      sessionId: SESSION_ID,
      leaseOwner: "worker-a",
      leaseExpiresAt: new Date(at.getTime() + 30_000),
      heartbeatAt: at,
    } });

    await db.$transaction(async tx => {
      await tx.session.update({ where: { id: SESSION_ID }, data: { status: "DONE" } });
      await coordination.requestSessionVoicePresenceStop(tx, SESSION_ID, "FINALIZE", at);
    });

    expect(await db.session.findUniqueOrThrow({ where: { id: SESSION_ID } })).toMatchObject({ status: "DONE" });
    expect(await db.sessionVoicePresenceControl.findUniqueOrThrow({ where: { sessionId: SESSION_ID } }))
      .toMatchObject({ status: "STOP_REQUESTED", stopAt: at, leaseOwner: "worker-a" });

    expect(await coordination.finalizeSessionVoicePresenceCommand(SESSION_ID)).toBe(true);
    expect(await db.sessionVoicePresenceConsent.findUniqueOrThrow({ where: { sessionId_userId: { sessionId: SESSION_ID, userId: USER_ID } } }))
      .toMatchObject({ expiresAt: new Date(at.getTime() + 30 * 24 * 60 * 60_000) });
    expect(await db.sessionVoicePresenceInterval.findFirstOrThrow({ where: { sessionId: SESSION_ID } }))
      .toMatchObject({ expiresAt: new Date(at.getTime() + 30 * 24 * 60 * 60_000) });
  });

  it("purges existing consent and intervals in the cancellation transaction", async () => {
    const consent = await db.sessionVoicePresenceConsent.create({ data: { sessionId: SESSION_ID, userId: USER_ID } });
    const start = new Date("2026-10-22T20:00:00.000Z");
    await db.sessionVoicePresenceInterval.create({ data: {
      sessionId: SESSION_ID,
      userId: USER_ID,
      consentId: consent.id,
      channelId: "456789012345678901",
      startedAt: start,
      endedAt: new Date(start.getTime() + 60_000),
      durationSeconds: 60,
      expiresAt: new Date(start.getTime() + 30 * 24 * 60 * 60_000),
    } });

    await db.$transaction(async tx => {
      await tx.session.update({ where: { id: SESSION_ID }, data: { status: "CANCELLED" } });
      await coordination.requestSessionVoicePresenceStop(tx, SESSION_ID, "PURGE", new Date());
    });

    expect(await db.sessionVoicePresenceInterval.count({ where: { sessionId: SESSION_ID } })).toBe(0);
    expect(await db.sessionVoicePresenceConsent.count({ where: { sessionId: SESSION_ID } })).toBe(0);
    expect(await db.sessionVoicePresenceControl.findUniqueOrThrow({ where: { sessionId: SESSION_ID } }))
      .toMatchObject({ status: "PURGE_REQUESTED" });
  });

  it("purges only expired voice intervals and consent rows in bounded batches", async () => {
    const now = new Date("2026-10-22T20:00:00.000Z");
    await db.user.create({ data: { id: `${USER_ID}-active`, discordId: "789012345678901235", discordName: "Active member" } });
    const expiredConsent = await db.sessionVoicePresenceConsent.create({ data: {
      sessionId: SESSION_ID,
      userId: USER_ID,
      expiresAt: new Date(now.getTime() - 1),
    } });
    const activeConsent = await db.sessionVoicePresenceConsent.create({ data: {
      sessionId: SESSION_ID,
      userId: `${USER_ID}-active`,
      expiresAt: new Date(now.getTime() + 1),
    } });
    await db.sessionVoicePresenceInterval.create({ data: {
      sessionId: SESSION_ID,
      userId: USER_ID,
      consentId: expiredConsent.id,
      channelId: "456789012345678901",
      startedAt: new Date(now.getTime() - 31 * 24 * 60 * 60_000),
      endedAt: new Date(now.getTime() - 30 * 24 * 60 * 60_000 - 1),
      durationSeconds: 60,
      expiresAt: new Date(now.getTime() - 1),
    } });

    const preview = await retention.purgeExpiredVoicePresenceBatch({ now, limit: 1, dryRun: true });
    expect(preview).toMatchObject({ expiredIntervals: 1, expiredConsents: 1, intervalsDeleted: 0, consentsDeleted: 0 });
    expect(await db.sessionVoicePresenceInterval.count({ where: { sessionId: SESSION_ID } })).toBe(1);

    const purged = await retention.purgeExpiredVoicePresenceBatch({ now, limit: 1, dryRun: false });
    expect(purged).toMatchObject({ expiredIntervals: 1, expiredConsents: 1, intervalsDeleted: 1, consentsDeleted: 1 });
    expect(await db.sessionVoicePresenceInterval.count({ where: { sessionId: SESSION_ID } })).toBe(0);
    expect(await db.sessionVoicePresenceConsent.findUnique({ where: { id: activeConsent.id } })).not.toBeNull();
  });
});
