import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeDiscordGateway } from "./test-helpers/fake-discord-gateway";

/**
 * Simulation de bout en bout (Postgres local + FAUX Gateway WebSocket local).
 * Aucune connexion à Discord, aucun jeton réel : le jeton est synthétique et le
 * transport du collecteur est redirigé vers 127.0.0.1.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const GUILD_ID = "123456789012345001";
const CHANNEL_ID = "223456789012345001";
const ALICE_DISCORD = "323456789012345001";
const BOB_DISCORD = "323456789012345002";
const COMMUNITY_ID = "voice-sim-community";
const SESSION_ID = "voice-sim-session";
const ALICE_ID = "voice-sim-alice";
const BOB_ID = "voice-sim-bob";

const hold = vi.hoisted(() => ({ url: "" }));

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
vi.mock("@/lib/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("./discord-voice-gateway", async importOriginal => {
  const actual = await importOriginal<typeof import("./discord-voice-gateway")>();
  return {
    ...actual,
    createVoiceGatewayCollector: (config: Parameters<typeof actual.createVoiceGatewayCollector>[0], options: Parameters<typeof actual.createVoiceGatewayCollector>[1]) =>
      actual.createVoiceGatewayCollector(config, {
        ...options,
        // Les URL wss://*.discord.gg restent validées par le collecteur, puis redirigées localement.
        fetchGatewayUrl: async () => "wss://gateway.discord.gg",
        createSocket: () => new WebSocket(hold.url) as never,
      }),
  };
});

if (!TEST_DATABASE_URL) console.warn("[voice-gateway-simulation] TEST_DATABASE_URL absent : simulation IGNOREE (skipped).");

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe.skipIf(!TEST_DATABASE_URL)("simulation du Gateway vocal (faux serveur WebSocket local + Postgres)", () => {
  let db: import("@prisma/client").PrismaClient;
  let fake: Awaited<ReturnType<typeof startFakeDiscordGateway>>;
  let runtimeModule: typeof import("./voice-presence-worker-runtime");
  let presence: typeof import("./session-voice-presence");
  let coordination: typeof import("./voice-presence-coordination");
  let retention: typeof import("./voice-presence-retention");
  let runtime: Awaited<ReturnType<typeof import("./voice-presence-worker-runtime").startVoicePresenceWorkerRuntime>> | null = null;
  const onFatal = vi.fn();
  const processLike = { once: vi.fn(), removeListener: vi.fn() };

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    runtimeModule = await import("./voice-presence-worker-runtime");
    presence = await import("./session-voice-presence");
    coordination = await import("./voice-presence-coordination");
    retention = await import("./voice-presence-retention");
  });
  afterAll(async () => { await db.$disconnect(); });

  async function cleanup() {
    await db.sessionVoicePresenceGap.deleteMany({ where: { sessionId: SESSION_ID } });
    await db.sessionVoicePresenceControl.deleteMany({ where: { sessionId: SESSION_ID } });
    await db.sessionVoicePresenceInterval.deleteMany({ where: { sessionId: SESSION_ID } });
    await db.sessionVoicePresenceConsent.deleteMany({ where: { sessionId: SESSION_ID } });
    await db.sessionInvite.deleteMany({ where: { sessionId: SESSION_ID } });
    await db.session.deleteMany({ where: { id: SESSION_ID } });
    await db.communityChannelConfig.deleteMany({ where: { communityId: COMMUNITY_ID } });
    await db.membership.deleteMany({ where: { communityId: COMMUNITY_ID } });
    await db.community.deleteMany({ where: { id: COMMUNITY_ID } });
    await db.user.deleteMany({ where: { id: { in: [ALICE_ID, BOB_ID] } } });
  }

  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    vi.stubEnv("VOICE_PRESENCE_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "");
    onFatal.mockClear();
    await cleanup();
    fake = await startFakeDiscordGateway({ guildId: GUILD_ID });
    hold.url = fake.url;
    await db.community.create({ data: { id: COMMUNITY_ID, slug: COMMUNITY_ID, name: "Voice sim", discordGuildId: GUILD_ID, status: "ACTIVE" } });
    await db.user.create({ data: { id: ALICE_ID, discordId: ALICE_DISCORD, discordName: "Alice" } });
    await db.user.create({ data: { id: BOB_ID, discordId: BOB_DISCORD, discordName: "Bob" } });
    await db.communityChannelConfig.create({ data: { communityId: COMMUNITY_ID, category: "VOICE", discordChannelId: CHANNEL_ID, enabled: true } });
    await db.session.create({ data: {
      id: SESSION_ID,
      communityId: COMMUNITY_ID,
      createdById: ALICE_ID,
      date: new Date(Date.now() - 24 * 60 * 60 * 1000),
      status: "SCHEDULED",
      invites: { create: { user: { connect: { id: BOB_ID } }, invitedBy: { connect: { id: ALICE_ID } }, status: "ACTIVE" } },
    } });
  });

  afterEach(async () => {
    await runtime?.stop().catch(() => undefined);
    runtime = null;
    await fake.close();
    vi.unstubAllEnvs();
    await cleanup();
  });

  async function startWorker() {
    runtime = await runtimeModule.startVoicePresenceWorkerRuntime(
      { token: "synthetic-token-not-a-secret", pollIntervalMs: 60_000 },
      { processLike, onFatal },
    );
    return runtime;
  }
  /** Accord via le chemin applicatif réel (aucun antidatage de consentedAt). */
  async function grant(userId: string) {
    expect(await presence.grantSessionVoiceConsent(SESSION_ID, userId)).toBe(true);
  }
  const intervalsFor =(userId: string) => db.sessionVoicePresenceInterval.findMany({ where: { sessionId: SESSION_ID, userId } });

  it("ne se connecte pas sans opt-in, puis se connecte et ne compte que les personnes consentantes", async () => {
    await startWorker();
    expect(fake.accepted).toBe(0);

    await grant(ALICE_ID);
    await runtime!.refresh();
    await vi.waitFor(() => expect(fake.received.some(p => p.op === 2)).toBe(true), { timeout: 10_000 });
    expect(fake.received.find(p => p.op === 2)?.d).toMatchObject({ token: "synthetic-token-not-a-secret", intents: 129 });
    await vi.waitFor(async () => expect(await db.sessionVoicePresenceControl.count({ where: { sessionId: SESSION_ID, status: "ACTIVE" } })).toBe(1));

    // Bob n'a pas donné son accord : ses passages ne sont jamais écrits.
    fake.voiceState(BOB_DISCORD, CHANNEL_ID);
    fake.voiceState(ALICE_DISCORD, CHANNEL_ID);
    await sleep(1_300);
    fake.voiceState(BOB_DISCORD, null);
    fake.voiceState(ALICE_DISCORD, null);
    await vi.waitFor(async () => expect((await intervalsFor(ALICE_ID)).length).toBe(1), { timeout: 10_000 });
    const [alice] = await intervalsFor(ALICE_ID);
    expect(alice.durationSeconds).toBeGreaterThanOrEqual(1);
    expect(alice.channelId).toBe(CHANNEL_ID);
    expect(await intervalsFor(BOB_ID)).toHaveLength(0);

    // Opt-in individuel de Bob : seuls les passages ULTERIEURS sont comptés.
    await grant(BOB_ID);
    fake.voiceState(BOB_DISCORD, CHANNEL_ID);
    await sleep(1_300);
    fake.voiceState(BOB_DISCORD, null);
    await vi.waitFor(async () => expect((await intervalsFor(BOB_ID)).length).toBe(1), { timeout: 10_000 });
    expect(onFatal).not.toHaveBeenCalled();
  }, 40_000);

  // Régression : consentedAt est un instant réel, pas une heure murale décalée de 1-2 h
  // (sinon toute présence dans les 1-2 h suivant l'accord était écartée).
  it.each([[1_000, "1 s"], [60 * 60_000, "1 h"], [2 * 60 * 60_000, "2 h"]])(
    "compte une présence arrivant %d ms (%s) après l'accord réel",
    async offset => {
      const consentAt = Date.now();
      await grant(ALICE_ID);
      const consent = await db.sessionVoicePresenceConsent.findFirstOrThrow({ where: { sessionId: SESSION_ID, userId: ALICE_ID } });
      expect(Math.abs(consent.consentedAt.getTime() - consentAt)).toBeLessThan(5_000);
      // Seul Date est simulé (minuteries réelles conservées) : la présence a lieu `offset` ms après l'accord.
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(consentAt + offset);
        await startWorker();
        await vi.waitFor(() => expect(fake.received.some(p => p.op === 2)).toBe(true), { timeout: 10_000 });
        fake.voiceState(ALICE_DISCORD, CHANNEL_ID);
        await sleep(100);
        vi.setSystemTime(consentAt + offset + 2_000);
        fake.voiceState(ALICE_DISCORD, null);
        await vi.waitFor(async () => expect((await intervalsFor(ALICE_ID)).length).toBe(1), { timeout: 10_000 });
        const [stored] = await intervalsFor(ALICE_ID);
        expect(stored.durationSeconds).toBeGreaterThanOrEqual(1);
        expect(stored.durationSeconds).toBeLessThanOrEqual(2);
        expect(stored.startedAt.getTime()).toBeGreaterThanOrEqual(consentAt + offset);
      } finally {
        vi.useRealTimers();
      }
    },
    40_000,
  );

  it("une coupure réseau est reprise par RESUME et la lacune est refermée sans créer de durée", async () => {
    await grant(ALICE_ID);
    await startWorker();
    await vi.waitFor(() => expect(fake.received.some(p => p.op === 2)).toBe(true), { timeout: 10_000 });
    await vi.waitFor(() => expect(fake.open).toBe(1));

    fake.dropConnections();
    // Backoff de 1 s puis reconnexion sur l'URL de reprise : RESUME avec session et séquence.
    await vi.waitFor(() => expect(fake.received.some(p => p.op === 6)).toBe(true), { timeout: 10_000 });
    const resume = fake.received.find(p => p.op === 6)!;
    expect(resume.d).toMatchObject({ token: "synthetic-token-not-a-secret", session_id: "fake-session-1" });
    expect((resume.d as { seq: number }).seq).toBeGreaterThanOrEqual(2);
    expect(fake.received.filter(p => p.op === 2)).toHaveLength(1);

    await vi.waitFor(async () => {
      const gaps = await db.sessionVoicePresenceGap.findMany({ where: { sessionId: SESSION_ID } });
      expect(gaps).toHaveLength(1);
      expect(gaps[0].resumedAt).not.toBeNull();
    }, { timeout: 10_000 });
    expect(await db.sessionVoicePresenceInterval.count({ where: { sessionId: SESSION_ID } })).toBe(0);

    // La collecte continue sur la connexion reprise.
    fake.voiceState(ALICE_DISCORD, CHANNEL_ID);
    await sleep(1_300);
    fake.voiceState(ALICE_DISCORD, null);
    await vi.waitFor(async () => expect((await intervalsFor(ALICE_ID)).length).toBe(1), { timeout: 10_000 });
  }, 40_000);

  it("une session de reprise refusée (op 9) repasse par Identify et referme la lacune au snapshot", async () => {
    await grant(ALICE_ID);
    await startWorker();
    await vi.waitFor(() => expect(fake.received.some(p => p.op === 2)).toBe(true), { timeout: 10_000 });
    fake.setResumeMode("invalid");
    fake.setSnapshot([{ user_id: ALICE_DISCORD, channel_id: CHANNEL_ID }]);
    fake.dropConnections();
    await vi.waitFor(() => expect(fake.received.filter(p => p.op === 2)).toHaveLength(2), { timeout: 15_000 });
    expect(fake.received.some(p => p.op === 6)).toBe(true);
    await vi.waitFor(async () => {
      const gaps = await db.sessionVoicePresenceGap.findMany({ where: { sessionId: SESSION_ID } });
      expect(gaps.length).toBeGreaterThanOrEqual(1);
      expect(gaps.every(gap => gap.resumedAt !== null)).toBe(true);
    }, { timeout: 15_000 });
    // Un snapshot n'a pas d'heure d'entrée : la visite repart de l'instant du snapshot, en partiel.
    await sleep(1_300);
    fake.voiceState(ALICE_DISCORD, null);
    await vi.waitFor(async () => expect((await intervalsFor(ALICE_ID)).length).toBe(1), { timeout: 10_000 });
    expect((await intervalsFor(ALICE_ID))[0].partial).toBe(true);
  }, 40_000);

  it("un redémarrage du worker ne persiste pas la session Gateway : Identify, nouvelle génération, lacune conservée puis refermée", async () => {
    await grant(ALICE_ID);
    await startWorker();
    await vi.waitFor(() => expect(fake.received.some(p => p.op === 2)).toBe(true), { timeout: 10_000 });
    const first = await db.sessionVoicePresenceControl.findUniqueOrThrow({ where: { sessionId: SESSION_ID } });

    await runtime!.stop();
    runtime = null;
    await vi.waitFor(() => expect(fake.open).toBe(0));
    const released = await db.sessionVoicePresenceControl.findUniqueOrThrow({ where: { sessionId: SESSION_ID } });
    expect(released.leaseOwner).toBeNull();

    await startWorker();
    await vi.waitFor(() => expect(fake.received.filter(p => p.op === 2)).toHaveLength(2), { timeout: 10_000 });
    expect(fake.received.some(p => p.op === 6)).toBe(false);
    const second = await db.sessionVoicePresenceControl.findUniqueOrThrow({ where: { sessionId: SESSION_ID } });
    expect(second.generation).toBeGreaterThan(first.generation);
    expect(second.leaseOwner).not.toBe(first.leaseOwner);
    expect(await db.sessionVoicePresenceInterval.count({ where: { sessionId: SESSION_ID } })).toBe(0);
  }, 40_000);

  it("un arrêt propre avec une personne encore en vocal enregistre l'intervalle ouvert, une lacune « shutdown » et libère le bail", async () => {
    await grant(ALICE_ID);
    await startWorker();
    await vi.waitFor(() => expect(fake.received.some(p => p.op === 2)).toBe(true), { timeout: 10_000 });
    fake.voiceState(ALICE_DISCORD, CHANNEL_ID);
    await sleep(1_300);

    await runtime!.stop();
    runtime = null;

    const intervals = await intervalsFor(ALICE_ID);
    expect(intervals).toHaveLength(1);
    expect(intervals[0].endedAt.getTime()).toBeGreaterThan(intervals[0].startedAt.getTime());
    const control = await db.sessionVoicePresenceControl.findUniqueOrThrow({ where: { sessionId: SESSION_ID } });
    expect(control.leaseOwner).toBeNull();
    expect(await db.sessionVoicePresenceGap.count({ where: { sessionId: SESSION_ID } })).toBe(1);
    await vi.waitFor(() => expect(fake.open).toBe(0));
  }, 40_000);

  it("un code de fermeture fatal (4004) arrête le worker sans boucle de reconnexion", async () => {
    await grant(ALICE_ID);
    await startWorker();
    await vi.waitFor(() => expect(fake.received.some(p => p.op === 2)).toBe(true), { timeout: 10_000 });
    fake.closeWithCode(4004);
    await vi.waitFor(() => expect(onFatal).toHaveBeenCalled(), { timeout: 10_000 });
    await sleep(2_500);
    expect(fake.accepted).toBe(1);
  }, 40_000);

  it("le retrait du consentement efface les durées, révoque la génération et ferme la socket au poll suivant", async () => {
    await grant(ALICE_ID);
    await grant(BOB_ID);
    await startWorker();
    await vi.waitFor(() => expect(fake.received.some(p => p.op === 2)).toBe(true), { timeout: 10_000 });
    const before = await db.sessionVoicePresenceControl.findUniqueOrThrow({ where: { sessionId: SESSION_ID } });

    fake.voiceState(ALICE_DISCORD, CHANNEL_ID);
    fake.voiceState(BOB_DISCORD, CHANNEL_ID);
    await sleep(1_300);
    fake.voiceState(ALICE_DISCORD, null);
    await vi.waitFor(async () => expect((await intervalsFor(ALICE_ID)).length).toBe(1), { timeout: 10_000 });

    // Alice retire son accord : ses durées disparaissent immédiatement, celles de Bob restent.
    expect(await presence.withdrawSessionVoiceConsent(SESSION_ID, ALICE_ID)).toBe(true);
    expect(await intervalsFor(ALICE_ID)).toHaveLength(0);
    expect(await db.sessionVoicePresenceConsent.count({ where: { sessionId: SESSION_ID, userId: ALICE_ID } })).toBe(0);
    // Bob est encore consentant : la génération n'est pas révoquée.
    expect((await db.sessionVoicePresenceControl.findUniqueOrThrow({ where: { sessionId: SESSION_ID } })).generation).toBe(before.generation);

    // Un événement tardif d'Alice, reçu en mémoire après le retrait, n'écrit rien.
    fake.voiceState(ALICE_DISCORD, CHANNEL_ID);
    await sleep(1_300);
    fake.voiceState(ALICE_DISCORD, null);
    await sleep(300);
    expect(await intervalsFor(ALICE_ID)).toHaveLength(0);

    // Bob retire le dernier accord : génération révoquée, bail libéré.
    expect(await presence.withdrawSessionVoiceConsent(SESSION_ID, BOB_ID)).toBe(true);
    const revoked = await db.sessionVoicePresenceControl.findUniqueOrThrow({ where: { sessionId: SESSION_ID } });
    expect(revoked.generation).toBe(before.generation + 1);
    expect(revoked.leaseOwner).toBeNull();
    expect(await intervalsFor(BOB_ID)).toHaveLength(0);

    // L'ancien collecteur (génération révoquée) ne peut plus rien écrire.
    expect(await presence.storeSessionVoiceInterval(
      { guildId: GUILD_ID, channelIds: [CHANNEL_ID], sessionId: SESSION_ID, workerId: before.leaseOwner!, generation: before.generation },
      { memberKey: BOB_DISCORD, channelId: CHANNEL_ID, startedAt: Date.now() - 5_000, endedAt: Date.now() - 1_000 },
    )).toBe(false);

    // Le poll suivant ferme la socket (code 1000), sans nouvelle connexion.
    await runtime!.refresh();
    await vi.waitFor(() => expect(fake.open).toBe(0), { timeout: 10_000 });
    expect(fake.closedWith.some(entry => entry.code === 1000)).toBe(true);
    expect(fake.accepted).toBe(1);
  }, 40_000);

  it("la clôture finalise via le worker avec un TTL fixe de 30 jours, puis la purge ne retire qu'après l'échéance", async () => {
    await grant(ALICE_ID);
    await startWorker();
    await vi.waitFor(() => expect(fake.received.some(p => p.op === 2)).toBe(true), { timeout: 10_000 });
    fake.voiceState(ALICE_DISCORD, CHANNEL_ID);
    await sleep(1_300);
    fake.voiceState(ALICE_DISCORD, null);
    await vi.waitFor(async () => expect((await intervalsFor(ALICE_ID)).length).toBe(1), { timeout: 10_000 });

    const stopAt = new Date();
    await db.$transaction(async tx => {
      await tx.session.update({ where: { id: SESSION_ID }, data: { status: "DONE" } });
      await coordination.requestSessionVoicePresenceStop(tx, SESSION_ID, "FINALIZE", stopAt);
    });
    await runtime!.refresh();
    await vi.waitFor(async () =>
      expect((await db.sessionVoicePresenceControl.findUniqueOrThrow({ where: { sessionId: SESSION_ID } })).status).toBe("FINALIZED"),
    { timeout: 10_000 });
    await vi.waitFor(() => expect(fake.open).toBe(0), { timeout: 10_000 });

    const ttlMs = 30 * 24 * 60 * 60 * 1_000;
    const [interval] = await intervalsFor(ALICE_ID);
    expect(interval.expiresAt!.getTime()).toBe(stopAt.getTime() + ttlMs);
    const consent = await db.sessionVoicePresenceConsent.findFirstOrThrow({ where: { sessionId: SESSION_ID } });
    expect(consent.expiresAt!.getTime()).toBe(stopAt.getTime() + ttlMs);

    // Avant l'échéance : le dry-run ne compte rien et la purge réelle ne supprime rien.
    const early = new Date(stopAt.getTime() + ttlMs - 1);
    expect(await retention.purgeExpiredVoicePresenceBatch({ now: early, dryRun: true })).toMatchObject({ expiredIntervals: 0, expiredConsents: 0 });
    expect(await retention.purgeExpiredVoicePresenceBatch({ now: early, dryRun: false })).toMatchObject({ intervalsDeleted: 0, consentsDeleted: 0 });
    expect(await intervalsFor(ALICE_ID)).toHaveLength(1);

    // À l'échéance : le dry-run annonce, la purge supprime.
    const due = new Date(stopAt.getTime() + ttlMs);
    expect(await retention.purgeExpiredVoicePresenceBatch({ now: due, dryRun: true })).toMatchObject({ expiredIntervals: 1, expiredConsents: 1, intervalsDeleted: 0 });
    expect(await intervalsFor(ALICE_ID)).toHaveLength(1);
    expect(await retention.purgeExpiredVoicePresenceBatch({ now: due, dryRun: false })).toMatchObject({ intervalsDeleted: 1, consentsDeleted: 1 });
    expect(await intervalsFor(ALICE_ID)).toHaveLength(0);
    expect(await db.sessionVoicePresenceConsent.count({ where: { sessionId: SESSION_ID } })).toBe(0);
  }, 40_000);

  it("l'annulation purge immédiatement accords et durées et arrête la collecte", async () => {
    await grant(ALICE_ID);
    await startWorker();
    await vi.waitFor(() => expect(fake.received.some(p => p.op === 2)).toBe(true), { timeout: 10_000 });
    fake.voiceState(ALICE_DISCORD, CHANNEL_ID);
    await sleep(1_300);
    fake.voiceState(ALICE_DISCORD, null);
    await vi.waitFor(async () => expect((await intervalsFor(ALICE_ID)).length).toBe(1), { timeout: 10_000 });

    await db.$transaction(async tx => {
      await tx.session.update({ where: { id: SESSION_ID }, data: { status: "CANCELLED" } });
      await coordination.requestSessionVoicePresenceStop(tx, SESSION_ID, "PURGE", new Date());
    });
    expect(await intervalsFor(ALICE_ID)).toHaveLength(0);
    expect(await db.sessionVoicePresenceConsent.count({ where: { sessionId: SESSION_ID } })).toBe(0);
    await runtime!.refresh();
    await vi.waitFor(() => expect(fake.open).toBe(0), { timeout: 10_000 });
    await vi.waitFor(async () =>
      expect((await db.sessionVoicePresenceControl.findUniqueOrThrow({ where: { sessionId: SESSION_ID } })).status).toBe("PURGED"),
    { timeout: 10_000 });
  }, 40_000);
});
