import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Base coupée plus longtemps que le bail (45 s) puis rétablie : preuve déterministe, sans attente réelle.
 * Le bail est réclamé à un instant passé (paramètre `now` du claim), donc déjà expiré pour l'horloge réelle.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const GUILD_ID = "123456789012345777";
const CHANNEL_ID = "223456789012345777";
const ALICE_DISCORD = "323456789012345777";
const COMMUNITY_ID = "voice-lease-community";
const SESSION_ID = "voice-lease-session";
const ALICE_ID = "voice-lease-alice";
const WORKER = "worker-lease-test";

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
vi.mock("@/lib/current-user", () => ({ getCurrentUser: vi.fn() }));

describe.skipIf(!TEST_DATABASE_URL)("bail expiré pendant une coupure de base", () => {
  let db: import("@prisma/client").PrismaClient;
  let coordination: typeof import("./voice-presence-coordination");
  let presence: typeof import("./session-voice-presence");
  let config: typeof import("./session-voice-config");
  let wallclock: typeof import("./wallclock");

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    coordination = await import("./voice-presence-coordination");
    presence = await import("./session-voice-presence");
    config = await import("./session-voice-config");
    wallclock = await import("./wallclock");
  });
  afterAll(async () => { await db.$disconnect(); });

  async function cleanup() {
    await db.sessionVoicePresenceGap.deleteMany({ where: { sessionId: SESSION_ID } });
    await db.sessionVoicePresenceControl.deleteMany({ where: { sessionId: SESSION_ID } });
    await db.sessionVoicePresenceInterval.deleteMany({ where: { sessionId: SESSION_ID } });
    await db.sessionVoicePresenceConsent.deleteMany({ where: { sessionId: SESSION_ID } });
    await db.session.deleteMany({ where: { id: SESSION_ID } });
    await db.communityChannelConfig.deleteMany({ where: { communityId: COMMUNITY_ID } });
    await db.community.deleteMany({ where: { id: COMMUNITY_ID } });
    await db.user.deleteMany({ where: { id: ALICE_ID } });
  }

  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    vi.stubEnv("VOICE_PRESENCE_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "");
    await cleanup();
    await db.community.create({ data: { id: COMMUNITY_ID, slug: COMMUNITY_ID, name: "Voice lease", discordGuildId: GUILD_ID, status: "ACTIVE" } });
    await db.user.create({ data: { id: ALICE_ID, discordId: ALICE_DISCORD, discordName: "Alice" } });
    await db.communityChannelConfig.create({ data: { communityId: COMMUNITY_ID, category: "VOICE", discordChannelId: CHANNEL_ID, enabled: true } });
    await db.session.create({ data: { id: SESSION_ID, communityId: COMMUNITY_ID, createdById: ALICE_ID, date: new Date(Date.now() - 24 * 3600_000), status: "SCHEDULED" } });
    await db.sessionVoicePresenceConsent.create({ data: { sessionId: SESSION_ID, userId: ALICE_ID, consentedAt: new Date(Date.now() - 2 * 24 * 3600_000) } });
  });

  const cfg = (generation: number) => config.sessionVoiceConfig({
    VOICE_PRESENCE_ENABLED: "true", VOICE_PRESENCE_GUILD_ID: GUILD_ID, VOICE_PRESENCE_CHANNEL_IDS: CHANNEL_ID,
    VOICE_PRESENCE_SESSION_ID: SESSION_ID, VOICE_PRESENCE_WORKER_ID: WORKER, VOICE_PRESENCE_WORKER_GENERATION: String(generation),
  });
  const interval = (fromAgoMs: number, toAgoMs: number) => ({
    memberKey: ALICE_DISCORD, channelId: CHANNEL_ID, startedAt: Date.now() - fromAgoMs, endedAt: Date.now() - toAgoMs,
  });

  it("rejette l'écriture d'un collecteur au bail expiré, ouvre une lacune rétroactive à la reprise et ne compte pas le temps manquant", async () => {
    const leaseStart = new Date(wallclock.wallClockNow().getTime() - 100_000); // bail 45 s : expiré depuis 55 s
    expect(await coordination.claimSessionVoicePresenceLease(SESSION_ID, WORKER, leaseStart)).toMatchObject({ claimed: true, generation: 1 });

    // Coupure : le collecteur encore actif ferme un intervalle, sa transaction voit le bail expiré.
    expect(await presence.storeSessionVoiceInterval(cfg(1), interval(40_000, 20_000))).toBe(false);
    expect(await db.sessionVoicePresenceInterval.count({ where: { sessionId: SESSION_ID } })).toBe(0);

    // La base revient : le poll suivant réclame le bail (même worker, bail expiré = reprise).
    const takeover = await coordination.claimSessionVoicePresenceLease(SESSION_ID, WORKER, wallclock.wallClockNow());
    expect(takeover).toMatchObject({ claimed: true, generation: 2, gapDetected: true });
    expect(await db.sessionVoicePresenceGap.findMany({ where: { sessionId: SESSION_ID } }))
      .toMatchObject([{ generation: 2, startedAt: leaseStart, resumedAt: null }]);

    // L'ancien collecteur (génération 1) est fencé, même pour un flush tardif.
    expect(await presence.storeSessionVoiceInterval(cfg(1), interval(15_000, 5_000))).toBe(false);

    // Le nouveau collecteur confirme un état frais : la lacune se referme sans créer de durée.
    const recoveredAt = wallclock.wallClockNow();
    await coordination.markSessionVoicePresenceGapRecovered(SESSION_ID, WORKER, 2, recoveredAt);
    expect(await db.sessionVoicePresenceGap.findMany({ where: { sessionId: SESSION_ID } }))
      .toMatchObject([{ startedAt: leaseStart, resumedAt: recoveredAt }]);
    expect(await db.sessionVoicePresenceInterval.count({ where: { sessionId: SESSION_ID } })).toBe(0);

    // La collecte reprend avec la nouvelle génération : seul le temps observé après la reprise compte.
    expect(await presence.storeSessionVoiceInterval(cfg(2), interval(4_000, 1_000))).toBe(true);
    const rows = await db.sessionVoicePresenceInterval.findMany({ where: { sessionId: SESSION_ID } });
    expect(rows).toHaveLength(1);
    expect(rows[0].durationSeconds).toBe(3);
  });
});
