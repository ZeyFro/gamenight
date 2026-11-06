import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Durcissement de la présence vocale (phase 2A) : borne dure de collecte de 12 h après Session.date (D7), lecture
 * réservée au créateur et aux admins INVITÉS (D6), rétention des soirées restées SCHEDULED sans clôture.
 * Nécessite TEST_DATABASE_URL (Postgres local jetable) ; sinon la suite est SKIPPÉE. Données isolées par préfixe, aucun TRUNCATE.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const P = "vhard";
const COMMUNITY_ID = `${P}-community`;
const GUILD_ID = "223456789012345678";
const CHANNEL_ID = "556789012345678901";
const WORKER = "synthetic-worker";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const USERS = {
  creator: { id: `${P}-creator`, discordId: "991111111111111101", role: "USER" as const, membership: "MEMBER" as const },
  guest: { id: `${P}-guest`, discordId: "991111111111111102", role: "USER" as const, membership: "MEMBER" as const },
  invitedSiteAdmin: { id: `${P}-invited-site-admin`, discordId: "991111111111111103", role: "ADMIN" as const, membership: "MEMBER" as const },
  otherSiteAdmin: { id: `${P}-other-site-admin`, discordId: "991111111111111104", role: "ADMIN" as const, membership: "MEMBER" as const },
  invitedCommunityAdmin: { id: `${P}-invited-community-admin`, discordId: "991111111111111105", role: "USER" as const, membership: "ADMIN" as const },
  otherCommunityAdmin: { id: `${P}-other-community-admin`, discordId: "991111111111111106", role: "USER" as const, membership: "ADMIN" as const },
};
const INVITED = [USERS.guest, USERS.invitedSiteAdmin, USERS.invitedCommunityAdmin];

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : ({} as unknown) };
});
vi.mock("@/lib/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

if (!TEST_DATABASE_URL) console.warn("[voice-presence-hardening] TEST_DATABASE_URL absente : suite IGNOREE (skipped).");

describe.skipIf(!TEST_DATABASE_URL)("présence vocale : borne de 12 h, lecture D6 et rétention des soirées sans clôture", () => {
  let db: import("@prisma/client").PrismaClient;
  let presence: typeof import("./session-voice-presence");
  let coordination: typeof import("./voice-presence-coordination");
  let retention: typeof import("./voice-presence-retention");
  let sessionsLib: typeof import("./sessions");
  let wall: typeof import("./wallclock");
  let currentUser: typeof import("@/lib/current-user");
  let n = 0;

  async function cleanup() {
    const where = { sessionId: { startsWith: P } };
    await db.sessionVoicePresenceInterval.deleteMany({ where });
    await db.sessionVoicePresenceGap.deleteMany({ where });
    await db.sessionVoicePresenceControl.deleteMany({ where });
    await db.sessionVoicePresenceConsent.deleteMany({ where });
    await db.sessionInvite.deleteMany({ where });
    await db.session.deleteMany({ where: { id: { startsWith: P } } });
  }

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    presence = await import("./session-voice-presence");
    coordination = await import("./voice-presence-coordination");
    retention = await import("./voice-presence-retention");
    sessionsLib = await import("./sessions");
    wall = await import("./wallclock");
    currentUser = await import("@/lib/current-user");
    await cleanup();
    await db.communityChannelConfig.deleteMany({ where: { communityId: COMMUNITY_ID } });
    await db.membership.deleteMany({ where: { communityId: COMMUNITY_ID } });
    await db.community.deleteMany({ where: { id: COMMUNITY_ID } });
    await db.user.deleteMany({ where: { id: { startsWith: P } } });
    await db.community.create({ data: { id: COMMUNITY_ID, slug: COMMUNITY_ID, name: "Voice hardening", discordGuildId: GUILD_ID, status: "ACTIVE" } });
    await db.communityChannelConfig.create({ data: { communityId: COMMUNITY_ID, category: "VOICE", discordChannelId: CHANNEL_ID, enabled: true } });
    for (const user of Object.values(USERS)) {
      await db.user.create({ data: { id: user.id, discordId: user.discordId, discordName: user.id, role: user.role } });
      await db.membership.create({ data: { communityId: COMMUNITY_ID, userId: user.id, role: user.membership, status: "ACTIVE" } });
    }
  }, 60_000);

  afterAll(async () => {
    await cleanup();
    await db.communityChannelConfig.deleteMany({ where: { communityId: COMMUNITY_ID } });
    await db.membership.deleteMany({ where: { communityId: COMMUNITY_ID } });
    await db.community.deleteMany({ where: { id: COMMUNITY_ID } });
    await db.user.deleteMany({ where: { id: { startsWith: P } } });
    await db.$disconnect();
  });

  beforeEach(async () => {
    vi.stubEnv("VOICE_PRESENCE_ENABLED", "true");
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    vi.stubEnv("ADMIN_DISCORD_IDS", "");
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "");
    await cleanup();
  }, 60_000);
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  async function seedSession(opts: { date: Date; status?: "SCHEDULED" | "DONE" | "CANCELLED"; invited?: boolean }) {
    n += 1;
    const id = `${P}-session-${n}`;
    await db.session.create({ data: {
      id,
      communityId: COMMUNITY_ID,
      createdById: USERS.creator.id,
      date: opts.date,
      status: opts.status ?? "SCHEDULED",
      ...(opts.invited === false ? {} : { invites: { create: INVITED.map(user => ({ userId: user.id, invitedById: USERS.creator.id, status: "ACTIVE" as const })) } }),
    } });
    return id;
  }
  const consentFor = (sessionId: string, userId: string, consentedAt?: Date, expiresAt?: Date | null) =>
    db.sessionVoicePresenceConsent.create({ data: { sessionId, userId, ...(consentedAt ? { consentedAt } : {}), ...(expiresAt !== undefined ? { expiresAt } : {}) } });
  const config = (sessionId: string) => ({ guildId: GUILD_ID, channelIds: [CHANNEL_ID], sessionId, workerId: WORKER, generation: 1 });
  const activeLease = (sessionId: string, over: Record<string, unknown> = {}) => db.sessionVoicePresenceControl.create({ data: {
    sessionId, leaseOwner: WORKER, generation: 1, leaseExpiresAt: new Date(Date.now() + 6 * HOUR), ...over,
  } });
  /** Début d'intervalle à la seconde entière : l'heure murale (Paris) tronque les millisecondes. */
  const startInstant = () => Math.floor((Date.now() - 60_000) / 1_000) * 1_000;
  /** Chemins (href) de tous les liens d'un arbre d'éléments React, sans le sérialiser (références circulaires). */
  function hrefs(node: unknown, found: string[] = []): string[] {
    if (Array.isArray(node)) node.forEach(child => hrefs(child, found));
    else if (node && typeof node === "object" && "props" in node) {
      const props = (node as { props: { href?: unknown; children?: unknown } }).props;
      if (typeof props.href === "string") found.push(props.href);
      hrefs(props.children, found);
    }
    return found;
  }
  const wallOf = (instant: number) => wall.toWallClock(new Date(instant));

  // ───────────── (a) collecte refusée au-delà de 12 h, sans close-sessions ─────────────

  describe("borne dure de collecte de 12 h après Session.date, soirée restée SCHEDULED (cron close-sessions absent)", () => {
    it("refuse la revendication du bail 12 h + 1 s après la date de la soirée, l'accepte à 12 h pile", async () => {
      const wallNow = new Date("2026-10-24T20:00:00.000Z");
      const stale = await seedSession({ date: new Date(wallNow.getTime() - 12 * HOUR - 1_000) });
      const edge = await seedSession({ date: new Date(wallNow.getTime() - 12 * HOUR) });
      await consentFor(stale, USERS.creator.id);
      await consentFor(edge, USERS.creator.id);

      expect(await coordination.claimSessionVoicePresenceLease(stale, WORKER, wallNow)).toEqual({ claimed: false });
      expect(await db.sessionVoicePresenceControl.count({ where: { sessionId: stale } })).toBe(0);
      expect(await coordination.claimSessionVoicePresenceLease(edge, WORKER, wallNow)).toMatchObject({ claimed: true });
    });

    it("la validation du bail avant construction du collecteur échoue passé la borne même avec un bail encore valide", async () => {
      const date = new Date("2026-10-24T18:00:00.000Z");
      const sessionId = await seedSession({ date });
      await consentFor(sessionId, USERS.creator.id);
      const claimAt = new Date(date.getTime() + HOUR);
      expect(await coordination.claimSessionVoicePresenceLease(sessionId, WORKER, claimAt, 13 * HOUR)).toMatchObject({ claimed: true, generation: 1 });

      expect(await coordination.validateSessionVoicePresenceLease(sessionId, WORKER, 1, new Date(date.getTime() + 12 * HOUR))).toBe(true);
      expect(await coordination.validateSessionVoicePresenceLease(sessionId, WORKER, 1, new Date(date.getTime() + 12 * HOUR + 1_000))).toBe(false);
    });

    it("n'écrit aucun intervalle débutant après la borne, et plafonne à la borne un intervalle qui la chevauche (partiel)", async () => {
      const startedAt = startInstant();
      const afterBound = await seedSession({ date: new Date(wallOf(startedAt).getTime() - 12 * HOUR - 1_000) });
      const straddling = await seedSession({ date: new Date(wallOf(startedAt).getTime() - 12 * HOUR + 300_000) });
      for (const sessionId of [afterBound, straddling]) {
        await consentFor(sessionId, USERS.creator.id, new Date(startedAt - 60_000));
        await activeLease(sessionId);
      }
      const interval = { memberKey: USERS.creator.discordId, channelId: CHANNEL_ID, startedAt, endedAt: startedAt + 2 * HOUR };

      expect(await presence.storeSessionVoiceInterval(config(afterBound), interval)).toBe(false);
      expect(await db.sessionVoicePresenceInterval.count({ where: { sessionId: afterBound } })).toBe(0);

      expect(await presence.storeSessionVoiceInterval(config(straddling), interval)).toBe(true);
      const stored = await db.sessionVoicePresenceInterval.findFirstOrThrow({ where: { sessionId: straddling } });
      expect(stored).toMatchObject({ durationSeconds: 300, partial: true });
      expect(stored.endedAt.getTime()).toBe(startedAt + 300_000);
    });

    it("un intervalle commençant exactement à la borne ne crée aucune durée", async () => {
      const startedAt = startInstant();
      const sessionId = await seedSession({ date: new Date(wallOf(startedAt).getTime() - 12 * HOUR) });
      await consentFor(sessionId, USERS.creator.id, new Date(startedAt - 60_000));
      await activeLease(sessionId);
      expect(await presence.storeSessionVoiceInterval(config(sessionId), {
        memberKey: USERS.creator.discordId, channelId: CHANNEL_ID, startedAt, endedAt: startedAt + HOUR,
      })).toBe(false);
      expect(await db.sessionVoicePresenceInterval.count({ where: { sessionId } })).toBe(0);
    });

    it("une clôture tardive (stopAt au-delà de la borne) ne prolonge pas la collecte : la borne l'emporte sur stopAt", async () => {
      const startedAt = startInstant();
      const sessionId = await seedSession({ date: new Date(wallOf(startedAt).getTime() - 12 * HOUR + 300_000), status: "DONE" });
      await consentFor(sessionId, USERS.creator.id, new Date(startedAt - 60_000));
      await activeLease(sessionId, { status: "STOP_REQUESTED", stopAt: new Date(startedAt + 2 * HOUR) });
      expect(await presence.storeSessionVoiceInterval(config(sessionId), {
        memberKey: USERS.creator.discordId, channelId: CHANNEL_ID, startedAt, endedAt: startedAt + 3 * HOUR,
      })).toBe(true);
      const stored = await db.sessionVoicePresenceInterval.findFirstOrThrow({ where: { sessionId } });
      expect(stored.endedAt.getTime()).toBe(startedAt + 300_000);
    });
  });

  // ───────────── (b) consentement expiré à la borne ─────────────

  describe("consentement à la borne de 12 h", () => {
    it("refuse un nouvel accord au-delà de la borne et ne présente plus l'accord existant comme actif (retrait toujours possible)", async () => {
      const stale = await seedSession({ date: new Date(wall.wallClockNow().getTime() - 13 * HOUR) });
      expect(await presence.grantSessionVoiceConsent(stale, USERS.creator.id)).toBe(false);
      expect(await db.sessionVoicePresenceConsent.count({ where: { sessionId: stale } })).toBe(0);

      await consentFor(stale, USERS.creator.id);
      expect(await presence.readSessionVoicePresence(stale, USERS.creator.id))
        .toMatchObject({ consented: false, canConsent: false, canWithdraw: true });
      expect(await presence.withdrawSessionVoiceConsent(stale, USERS.creator.id)).toBe(true);
      expect(await db.sessionVoicePresenceConsent.count({ where: { sessionId: stale } })).toBe(0);

      const fresh = await seedSession({ date: new Date(wall.wallClockNow().getTime() - 2 * HOUR) });
      expect(await presence.grantSessionVoiceConsent(fresh, USERS.creator.id)).toBe(true);
      expect(await presence.readSessionVoicePresence(fresh, USERS.creator.id)).toMatchObject({ consented: true, canConsent: true });
    });

    it("la découverte du worker ne retient pas une soirée de plus de 12 h : revendication impossible malgré l'accord", async () => {
      const stale = await seedSession({ date: new Date(wall.wallClockNow().getTime() - 12 * HOUR - 60_000) });
      await consentFor(stale, USERS.creator.id);
      expect(await coordination.claimSessionVoicePresenceLease(stale, WORKER, wall.wallClockNow())).toEqual({ claimed: false });
    });
  });

  // ───────────── (f) rétention ─────────────

  describe("rétention des données vocales", () => {
    it("soirée restée SCHEDULED sans clôture : accords, lacunes sans échéance et contrôle ACTIVE purgés 30 jours après la borne, pas avant", async () => {
      const date = new Date("2026-09-01T18:00:00.000Z");
      const stale = await seedSession({ date });
      const neighbour = await seedSession({ date: new Date(date.getTime() + 2 * DAY) }); // plus récente : encore dans la fenêtre
      const done = await seedSession({ date, status: "DONE" }); // clôturée : relève de stopAt, pas de cette règle
      for (const sessionId of [stale, neighbour, done]) {
        await consentFor(sessionId, USERS.creator.id);
        await db.sessionVoicePresenceGap.create({ data: { sessionId, generation: 1, startedAt: date } });
        await db.sessionVoicePresenceControl.create({ data: { sessionId } });
      }
      const boundPlus30 = date.getTime() + 12 * HOUR + 30 * DAY;

      const before = new Date(boundPlus30 - 1_000);
      const early = await retention.purgeExpiredVoicePresenceBatch({ now: before, leaseNow: before, dryRun: false });
      expect(early).toMatchObject({ consentsDeleted: 0, gapsDeleted: 0, controlsDeleted: 0 });

      const at = new Date(boundPlus30);
      const preview = await retention.purgeExpiredVoicePresenceBatch({ now: at, leaseNow: at, dryRun: true });
      expect(preview).toMatchObject({ expiredConsents: 1, expiredGaps: 1, expiredControls: 1, consentsDeleted: 0 });
      const purged = await retention.purgeExpiredVoicePresenceBatch({ now: at, leaseNow: at, dryRun: false });
      expect(purged).toMatchObject({ consentsDeleted: 1, gapsDeleted: 1, controlsDeleted: 1 });

      expect(await db.sessionVoicePresenceConsent.count({ where: { sessionId: stale } })).toBe(0);
      expect(await db.sessionVoicePresenceGap.count({ where: { sessionId: stale } })).toBe(0);
      expect(await db.sessionVoicePresenceControl.count({ where: { sessionId: stale } })).toBe(0);
      for (const kept of [neighbour, done]) {
        expect(await db.sessionVoicePresenceConsent.count({ where: { sessionId: kept } })).toBe(1);
        expect(await db.sessionVoicePresenceGap.count({ where: { sessionId: kept } })).toBe(1);
        expect(await db.sessionVoicePresenceControl.count({ where: { sessionId: kept } })).toBe(1);
      }
    });

    it("ne supprime pas la ligne de contrôle d'une soirée périmée tant qu'un bail est valide", async () => {
      const date = new Date("2026-09-01T18:00:00.000Z");
      const sessionId = await seedSession({ date });
      const at = new Date(date.getTime() + 12 * HOUR + 30 * DAY);
      await db.sessionVoicePresenceControl.create({ data: { sessionId, leaseOwner: WORKER, generation: 1, leaseExpiresAt: new Date(at.getTime() + 60_000) } });
      const purged = await retention.purgeExpiredVoicePresenceBatch({ now: at, leaseNow: at, dryRun: false });
      expect(purged.controlsDeleted).toBe(0);
      expect(await db.sessionVoicePresenceControl.count({ where: { sessionId } })).toBe(1);
    });

    it("purge intervalles, accords et lacunes à leur expiresAt exacte (instant réel), pas une milliseconde avant", async () => {
      const sessionId = await seedSession({ date: new Date("2026-10-20T18:00:00.000Z"), status: "DONE" });
      const at = new Date("2026-11-20T12:00:00.000Z");
      // Supprimer un accord supprime en cascade ses intervalles : l'intervalle « pas encore échu » est donc rattaché à un autre accord.
      const expiring = await consentFor(sessionId, USERS.creator.id, undefined, at);
      const surviving = await consentFor(sessionId, USERS.guest.id, undefined, new Date(at.getTime() + 1));
      const interval = (consentId: string, userId: string, expiresAt: Date, startedAt: Date) => db.sessionVoicePresenceInterval.create({ data: {
        sessionId, userId, consentId, channelId: CHANNEL_ID, startedAt,
        endedAt: new Date(startedAt.getTime() + 60_000), durationSeconds: 60, expiresAt,
      } });
      await interval(expiring.id, USERS.creator.id, at, new Date("2026-10-20T19:00:00.000Z"));
      await interval(surviving.id, USERS.guest.id, new Date(at.getTime() + 1), new Date("2026-10-20T20:00:00.000Z"));
      await db.sessionVoicePresenceGap.create({ data: { sessionId, generation: 1, startedAt: new Date("2026-10-20T19:30:00.000Z"), resumedAt: new Date("2026-10-20T19:31:00.000Z"), expiresAt: at } });
      await db.sessionVoicePresenceGap.create({ data: { sessionId, generation: 2, startedAt: new Date("2026-10-20T20:30:00.000Z"), expiresAt: new Date(at.getTime() + 1) } });

      const purged = await retention.purgeExpiredVoicePresenceBatch({ now: at, leaseNow: at, dryRun: false });
      expect(purged).toMatchObject({ intervalsDeleted: 1, consentsDeleted: 1, gapsDeleted: 1 });
      expect(await db.sessionVoicePresenceConsent.count({ where: { sessionId } })).toBe(1);
      expect(await db.sessionVoicePresenceInterval.count({ where: { sessionId } })).toBe(1);
      expect(await db.sessionVoicePresenceGap.count({ where: { sessionId } })).toBe(1);
    });

    it("annulation d'une soirée, drapeau ON : accords, intervalles, lacunes et contrôle sans bail disparaissent immédiatement", async () => {
      const sessionId = await seedSession({ date: new Date(wall.wallClockNow().getTime() + 2 * HOUR) });
      const consent = await consentFor(sessionId, USERS.creator.id);
      const startedAt = new Date(Date.now() - 10 * 60_000);
      await db.sessionVoicePresenceInterval.create({ data: {
        sessionId, userId: USERS.creator.id, consentId: consent.id, channelId: CHANNEL_ID, startedAt,
        endedAt: new Date(startedAt.getTime() + 60_000), durationSeconds: 60, expiresAt: new Date(Date.now() + 30 * DAY),
      } });
      await db.sessionVoicePresenceGap.create({ data: { sessionId, generation: 1, startedAt } });
      await db.sessionVoicePresenceControl.create({ data: { sessionId } });

      await sessionsLib.cancelSession(sessionId);

      expect((await db.session.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe("CANCELLED");
      expect(await db.sessionVoicePresenceInterval.count({ where: { sessionId } })).toBe(0);
      expect(await db.sessionVoicePresenceConsent.count({ where: { sessionId } })).toBe(0);
      expect(await db.sessionVoicePresenceGap.count({ where: { sessionId } })).toBe(0);
      expect(await db.sessionVoicePresenceControl.count({ where: { sessionId } })).toBe(0);
    });
  });

  // ───────────── (g) retrait du consentement ─────────────

  describe("retrait du consentement", () => {
    it("supprime l'accord et les intervalles de la personne, laisse ceux des autres", async () => {
      const sessionId = await seedSession({ date: new Date(wall.wallClockNow().getTime() - HOUR) });
      const mine = await consentFor(sessionId, USERS.creator.id);
      const theirs = await consentFor(sessionId, USERS.guest.id);
      const startedAt = new Date(Date.now() - 20 * 60_000);
      for (const [userId, consent] of [[USERS.creator.id, mine], [USERS.guest.id, theirs]] as const) {
        await db.sessionVoicePresenceInterval.create({ data: {
          sessionId, userId, consentId: consent.id, channelId: CHANNEL_ID, startedAt,
          endedAt: new Date(startedAt.getTime() + 60_000), durationSeconds: 60, expiresAt: new Date(Date.now() + 30 * DAY),
        } });
      }

      expect(await presence.withdrawSessionVoiceConsent(sessionId, USERS.creator.id)).toBe(true);

      expect(await db.sessionVoicePresenceInterval.count({ where: { sessionId, userId: USERS.creator.id } })).toBe(0);
      expect(await db.sessionVoicePresenceConsent.count({ where: { sessionId, userId: USERS.creator.id } })).toBe(0);
      expect(await db.sessionVoicePresenceInterval.count({ where: { sessionId, userId: USERS.guest.id } })).toBe(1);
      expect(await db.sessionVoicePresenceConsent.count({ where: { sessionId, userId: USERS.guest.id } })).toBe(1);
      expect(await presence.withdrawSessionVoiceConsent(sessionId, USERS.creator.id)).toBe(false);
    });
  });

  // ───────────── (h) D6 : créateur et admins invités seulement ─────────────

  describe("D6 : durées lisibles par le créateur et les admins invités à la soirée", () => {
    async function seedWithDurations(opts: { invited?: boolean } = {}) {
      const sessionId = await seedSession({ date: new Date(wall.wallClockNow().getTime() - HOUR), invited: opts.invited });
      const startedAt = new Date(Date.now() - 20 * 60_000);
      for (const user of [USERS.creator, USERS.guest]) {
        const consent = await consentFor(sessionId, user.id);
        await db.sessionVoicePresenceInterval.create({ data: {
          sessionId, userId: user.id, consentId: consent.id, channelId: CHANNEL_ID, startedAt,
          endedAt: new Date(startedAt.getTime() + 90_000), durationSeconds: 90, expiresAt: new Date(Date.now() + 30 * DAY),
        } });
      }
      return sessionId;
    }

    it("le créateur et les admins (site ou communauté) invités lisent les durées de tous", async () => {
      const sessionId = await seedWithDurations();
      for (const viewer of [USERS.creator, USERS.invitedSiteAdmin, USERS.invitedCommunityAdmin]) {
        const result = await presence.readSessionVoicePresence(sessionId, viewer.id);
        expect(result, viewer.id).toMatchObject({ canReadAll: true });
        expect(result?.entries.map(entry => entry.userId).sort(), viewer.id).toEqual([USERS.creator.id, USERS.guest.id].sort());
      }
    });

    it("un invité non admin ne lit que ses propres durées", async () => {
      const sessionId = await seedWithDurations();
      const result = await presence.readSessionVoicePresence(sessionId, USERS.guest.id);
      expect(result).toMatchObject({ canReadAll: false });
      expect(result?.entries.map(entry => entry.userId)).toEqual([USERS.guest.id]);
    });

    it("un admin de site ou de communauté NON invité à la soirée privée ne lit rien (null)", async () => {
      const sessionId = await seedWithDurations();
      for (const viewer of [USERS.otherSiteAdmin, USERS.otherCommunityAdmin]) {
        expect(await presence.readSessionVoicePresence(sessionId, viewer.id), viewer.id).toBeNull();
      }
    });

    it("un admin dont l'invitation a été révoquée ne lit plus rien", async () => {
      const sessionId = await seedWithDurations();
      await db.sessionInvite.updateMany({ where: { sessionId, userId: USERS.invitedSiteAdmin.id }, data: { status: "REVOKED", revokedAt: new Date() } });
      expect(await presence.readSessionVoicePresence(sessionId, USERS.invitedSiteAdmin.id)).toBeNull();
    });

    it("pages admin : le détail répond 404 à un admin non invité et s'affiche pour un admin invité ; la liste ne contient que les soirées autorisées", async () => {
      const sessionId = await seedWithDurations();
      const authorizedOnlyForCreator = await seedWithDurations({ invited: false });
      const detail = await import("@/app/admin/voice-presence/[sessionId]/page");
      const list = await import("@/app/admin/voice-presence/page");
      const as = async (viewer: (typeof USERS)[keyof typeof USERS]) => {
        vi.mocked(currentUser.getCurrentUser).mockResolvedValue(await db.user.findUniqueOrThrow({ where: { id: viewer.id } }) as never);
      };
      const detailFor = (id: string) => detail.default({ params: Promise.resolve({ sessionId: id }) });
      const notFound = { digest: expect.stringContaining("404") };

      await as(USERS.otherSiteAdmin);
      await expect(detailFor(sessionId)).rejects.toMatchObject(notFound);
      expect(hrefs(await list.default())).not.toContain(`/admin/voice-presence/${sessionId}`);
      await as(USERS.otherCommunityAdmin);
      await expect(detailFor(sessionId)).rejects.toMatchObject(notFound);
      expect(hrefs(await list.default())).not.toContain(`/admin/voice-presence/${sessionId}`);

      for (const viewer of [USERS.invitedSiteAdmin, USERS.invitedCommunityAdmin]) {
        await as(viewer);
        expect(await detailFor(sessionId), viewer.id).toBeTruthy();
        const listing = hrefs(await list.default());
        expect(listing, viewer.id).toContain(`/admin/voice-presence/${sessionId}`);
        expect(listing, viewer.id).not.toContain(`/admin/voice-presence/${authorizedOnlyForCreator}`);
        await expect(detailFor(authorizedOnlyForCreator), viewer.id).rejects.toMatchObject(notFound);
      }

      // Un utilisateur non admin n'a pas accès à la page admin, même créateur : 404 (page réservée aux admins).
      await as(USERS.creator);
      await expect(detailFor(sessionId)).rejects.toMatchObject(notFound);
    });

    it("drapeau éteint : détail et liste admin répondent 404 avant toute lecture de l'utilisateur", async () => {
      vi.stubEnv("VOICE_PRESENCE_ENABLED", "");
      vi.mocked(currentUser.getCurrentUser).mockClear();
      const detail = await import("@/app/admin/voice-presence/[sessionId]/page");
      const list = await import("@/app/admin/voice-presence/page");
      await expect(detail.default({ params: Promise.resolve({ sessionId: "any" }) })).rejects.toMatchObject({ digest: expect.stringContaining("404") });
      await expect(list.default()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
      expect(currentUser.getCurrentUser).not.toHaveBeenCalled();
    });
  });
});
