import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Chantier nettoyage réel du stockage (V2) — tests d'intégration de
 * `retention.ts`/`retention-runner.ts` contre une base Postgres isolée +
 * Discord entièrement simulé (`fetch` mocké), même discipline que
 * `session-announce.integration.test.ts`/`tournament-announce.integration.test.ts`.
 * Nécessite `TEST_DATABASE_URL` — suite entièrement SKIPPÉE si absente.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn("[retention.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE.");
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe.skipIf(!TEST_DATABASE_URL)("retention (intégration Postgres isolée + Discord HTTP simulé)", () => {
  let db: import("@prisma/client").PrismaClient;
  let retention: typeof import("./retention");
  let runner: typeof import("./retention-runner");
  let announceLib: typeof import("./session-announce");
  let executorLib: typeof import("./notification-executor");
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const prismaModule = await import("@/lib/prisma");
    db = prismaModule.prisma as unknown as import("@prisma/client").PrismaClient;
    retention = await import("./retention");
    runner = await import("./retention-runner");
    announceLib = await import("./session-announce");
    executorLib = await import("./notification-executor");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      `TRUNCATE "NotificationDelivery", "NotificationEvent", "ChatReaction", "ChatMessage", "SessionInvite", "Vote", "Proposal", "Session", "Notification", "SeasonSnapshot", "Season", "Tournament", "Game", "User" CASCADE`
    );
    await db.$executeRawUnsafe(`UPDATE "CronLock" SET "lockedAt" = NULL, "token" = NULL WHERE name = 'retention-cleanup'`);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-bot-token");
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "guild-1");
    vi.stubEnv("DISCORD_BOT_SESSION_CHANNEL_ID", "chan-sessions");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  let counter = 0;
  function uniq(label: string): string {
    counter += 1;
    return `${label}-${counter}`;
  }

  async function makeUser() {
    const id = uniq("user");
    return db.user.create({ data: { discordId: id, discordName: id } });
  }

  async function makeSession(
    creatorId: string,
    overrides: Partial<{ status: "VOTING" | "SCHEDULED" | "DONE" | "CANCELLED"; date: Date; announceViaBot: boolean }> = {}
  ) {
    return db.session.create({
      data: {
        date: overrides.date ?? new Date("2026-09-01T20:00:00.000Z"),
        status: overrides.status ?? "DONE",
        createdById: creatorId,
        announceViaBot: overrides.announceViaBot ?? false,
      },
    });
  }

  describe("purgeEligibleChatMessagesBatch — purge RÉELLE, jamais un simple masquage", () => {
    it("session DONE au-delà de 7 jours : messages RÉELLEMENT supprimés en mode effectif, seulement comptés en dry-run", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const user = await makeUser();
      const oldSession = await makeSession(user.id, { date: new Date("2026-09-01T00:00:00.000Z") }); // 19 jours
      await db.chatMessage.createMany({
        data: [
          { sessionId: oldSession.id, userId: user.id, content: "salut" },
          { sessionId: oldSession.id, userId: user.id, content: "re" },
        ],
      });

      const dryRun = await retention.purgeEligibleChatMessagesBatch({ dryRun: true, now });
      expect(dryRun).toEqual({ candidateSessionIds: [oldSession.id], messagesAffected: 2, dryRun: true });
      expect(await db.chatMessage.count()).toBe(2); // AUCUNE mutation en dry-run

      const effective = await retention.purgeEligibleChatMessagesBatch({ dryRun: false, now });
      expect(effective).toEqual({ candidateSessionIds: [oldSession.id], messagesAffected: 2, dryRun: false });
      expect(await db.chatMessage.count()).toBe(0); // RÉELLEMENT supprimés, pas masqués

      // La session elle-même N'EST JAMAIS supprimée par cette PR (voir le
      // commentaire de fichier de retention.ts).
      expect(await db.session.findUnique({ where: { id: oldSession.id } })).not.toBeNull();
    });

    it("session ENCORE ACTIVE (VOTING) : jamais purgée sur son seul âge, quelle que soit l'ancienneté", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const user = await makeUser();
      const activeOld = await makeSession(user.id, { status: "VOTING", date: new Date("2020-01-01T00:00:00.000Z") });
      await db.chatMessage.create({ data: { sessionId: activeOld.id, userId: user.id, content: "salut" } });

      const result = await retention.purgeEligibleChatMessagesBatch({ dryRun: false, now });
      expect(result.candidateSessionIds).toEqual([]);
      expect(await db.chatMessage.count()).toBe(1); // intact
    });

    it("session DONE mais ENCORE DANS la fenêtre de 7 jours : jamais purgée avant son terme", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const user = await makeUser();
      const recent = await makeSession(user.id, { date: new Date("2026-09-15T00:00:00.000Z") }); // 5 jours
      await db.chatMessage.create({ data: { sessionId: recent.id, userId: user.id, content: "salut" } });

      const result = await retention.purgeEligibleChatMessagesBatch({ dryRun: false, now });
      expect(result.candidateSessionIds).toEqual([]);
      expect(await db.chatMessage.count()).toBe(1);
    });

    it("borné par `limit` — jamais un chargement de toutes les sessions éligibles d'un coup", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const user = await makeUser();
      for (let i = 0; i < 3; i++) {
        const s = await makeSession(user.id, { date: new Date("2026-09-01T00:00:00.000Z") });
        await db.chatMessage.create({ data: { sessionId: s.id, userId: user.id, content: `msg${i}` } });
      }
      const result = await retention.purgeEligibleChatMessagesBatch({ dryRun: true, limit: 2, now });
      expect(result.candidateSessionIds).toHaveLength(2);
    });
  });

  describe("scheduleDiscordCleanupForEligibleEvents — programme le nettoyage Discord des événements ÉLIGIBLES", () => {
    it("soirée DONE éligible, thread jamais nettoyé : enqueue en mode effectif, aucune mutation en dry-run", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const user = await makeUser();
      const session = await makeSession(user.id, { date: new Date("2026-09-01T00:00:00.000Z"), announceViaBot: true });

      const dryRun = await retention.scheduleDiscordCleanupForEligibleEvents({ dryRun: true, now });
      expect(dryRun.sessionsEnqueued).toEqual([session.id]);
      expect(await announceLib.getSessionThreadDeleteStatus(session.id)).toBe("never_enqueued"); // aucune mutation

      const effective = await retention.scheduleDiscordCleanupForEligibleEvents({ dryRun: false, now });
      expect(effective.sessionsEnqueued).toEqual([session.id]);
      expect(await announceLib.getSessionThreadDeleteStatus(session.id)).toBe("pending");
    });

    it("déjà programmé (pending) : jamais réenqueue-é en double par un passage suivant", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const user = await makeUser();
      const session = await makeSession(user.id, { date: new Date("2026-09-01T00:00:00.000Z"), announceViaBot: true });
      await retention.scheduleDiscordCleanupForEligibleEvents({ dryRun: false, now });
      const countAfterFirst = await db.notificationDelivery.count({
        where: { targetSlot: `default-guild:SESSION:${session.id}:thread-delete` },
      });

      await retention.scheduleDiscordCleanupForEligibleEvents({ dryRun: false, now });
      const countAfterSecond = await db.notificationDelivery.count({
        where: { targetSlot: `default-guild:SESSION:${session.id}:thread-delete` },
      });
      expect(countAfterSecond).toBe(countAfterFirst); // aucune nouvelle ligne
    });

    it("soirée sans announceViaBot (webhook) : jamais programmée, rien à nettoyer côté bot", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const user = await makeUser();
      await makeSession(user.id, { date: new Date("2026-09-01T00:00:00.000Z"), announceViaBot: false });
      const result = await retention.scheduleDiscordCleanupForEligibleEvents({ dryRun: false, now });
      expect(result.sessionsEnqueued).toEqual([]);
    });
  });

  describe("purgeClosedSeasonNotificationsBatch — nettoyage à la clôture de saison, cycle RÉEL uniquement", () => {
    it("aucune saison active : expose honnêtement le manque, aucune purge improvisée", async () => {
      const user = await makeUser();
      await db.notification.create({
        data: { userId: user.id, type: "SESSION_CREATED", title: "t", message: "m", read: true },
      });
      const result = await retention.purgeClosedSeasonNotificationsBatch({ dryRun: false });
      expect(result).toEqual({ notificationsAffected: 0, dryRun: false, seasonCycleAvailable: false });
      expect(await db.notification.count()).toBe(1); // intacte
    });

    it("notification LUE créée AVANT la saison active : purgée réellement en mode effectif", async () => {
      const user = await makeUser();
      await db.season.create({
        data: { number: 2, name: "Saison 2", startDate: new Date("2026-09-01T00:00:00.000Z"), endDate: new Date("2026-10-01T00:00:00.000Z"), isActive: true },
      });
      const oldRead = await db.notification.create({
        data: { userId: user.id, type: "SESSION_CREATED", title: "t", message: "m", read: true, createdAt: new Date("2026-08-15T00:00:00.000Z") },
      });

      const dryRun = await retention.purgeClosedSeasonNotificationsBatch({ dryRun: true });
      expect(dryRun).toEqual({ notificationsAffected: 1, dryRun: true, seasonCycleAvailable: true });
      expect(await db.notification.findUnique({ where: { id: oldRead.id } })).not.toBeNull();

      const effective = await retention.purgeClosedSeasonNotificationsBatch({ dryRun: false });
      expect(effective).toEqual({ notificationsAffected: 1, dryRun: false, seasonCycleAvailable: true });
      expect(await db.notification.findUnique({ where: { id: oldRead.id } })).toBeNull();
    });

    it("notification NON LUE, même ancienne : jamais purgée — encore nécessaire tant que l'utilisateur ne l'a pas vue", async () => {
      const user = await makeUser();
      await db.season.create({
        data: { number: 2, name: "Saison 2", startDate: new Date("2026-09-01T00:00:00.000Z"), endDate: new Date("2026-10-01T00:00:00.000Z"), isActive: true },
      });
      const unread = await db.notification.create({
        data: { userId: user.id, type: "SESSION_CREATED", title: "t", message: "m", read: false, createdAt: new Date("2026-08-15T00:00:00.000Z") },
      });
      const result = await retention.purgeClosedSeasonNotificationsBatch({ dryRun: false });
      expect(result.notificationsAffected).toBe(0);
      expect(await db.notification.findUnique({ where: { id: unread.id } })).not.toBeNull();
    });

    it("notification LUE de la saison ACTIVE elle-même (createdAt >= startDate) : jamais purgée par ce passage", async () => {
      const user = await makeUser();
      await db.season.create({
        data: { number: 2, name: "Saison 2", startDate: new Date("2026-09-01T00:00:00.000Z"), endDate: new Date("2026-10-01T00:00:00.000Z"), isActive: true },
      });
      const currentSeasonRead = await db.notification.create({
        data: { userId: user.id, type: "SESSION_CREATED", title: "t", message: "m", read: true, createdAt: new Date("2026-09-10T00:00:00.000Z") },
      });
      const result = await retention.purgeClosedSeasonNotificationsBatch({ dryRun: false });
      expect(result.notificationsAffected).toBe(0);
      expect(await db.notification.findUnique({ where: { id: currentSeasonRead.id } })).not.toBeNull();
    });
  });

  describe("purgeTechnicalDeliveriesBatch — terminal ET retry-safe uniquement, jamais un rejeu d'ancien événement", () => {
    async function makeDelivery(
      overrides: Partial<{
        status: "PENDING" | "RESERVED" | "SENT" | "FAILED" | "SKIPPED";
        occurrence: string;
        createdAt: Date;
      }> = {}
    ) {
      const event = await db.notificationEvent.create({
        data: {
          category: "SESSION",
          eventType: "SESSION_CREATED",
          sourceId: uniq("session"),
          occurrence: overrides.occurrence ?? uniq("occurrence"), // non vide par défaut
        },
      });
      return db.notificationDelivery.create({
        data: {
          eventId: event.id,
          channel: "DISCORD_CHANNEL",
          transport: "BOT",
          operation: "SEND",
          recipientKey: "channel",
          targetSlot: uniq("slot"),
          status: overrides.status ?? "SENT",
          createdAt: overrides.createdAt ?? new Date("2026-08-01T00:00:00.000Z"), // vieux par défaut
        },
      });
    }

    const now = new Date("2026-09-20T00:00:00.000Z"); // 50 jours après createdAt par défaut

    it("SENT, occurrence non vide, vieux : purgé réellement en mode effectif", async () => {
      const delivery = await makeDelivery({ status: "SENT" });
      const result = await retention.purgeTechnicalDeliveriesBatch({ dryRun: false, now });
      expect(result.deliveriesAffected).toBe(1);
      expect(await db.notificationDelivery.findUnique({ where: { id: delivery.id } })).toBeNull();
    });

    it("SKIPPED, occurrence non vide, vieux : purgé réellement", async () => {
      const delivery = await makeDelivery({ status: "SKIPPED" });
      const result = await retention.purgeTechnicalDeliveriesBatch({ dryRun: false, now });
      expect(result.deliveriesAffected).toBe(1);
      expect(await db.notificationDelivery.findUnique({ where: { id: delivery.id } })).toBeNull();
    });

    it("FAILED : JAMAIS purgé automatiquement, même vieux — reste visible pour le réessai admin", async () => {
      const delivery = await makeDelivery({ status: "FAILED" });
      const result = await retention.purgeTechnicalDeliveriesBatch({ dryRun: false, now });
      expect(result.deliveriesAffected).toBe(0);
      expect(await db.notificationDelivery.findUnique({ where: { id: delivery.id } })).not.toBeNull();
    });

    it("PENDING/RESERVED : jamais purgé, même vieux — encore en attente ou en cours", async () => {
      const pending = await makeDelivery({ status: "PENDING" });
      const reserved = await makeDelivery({ status: "RESERVED" });
      const result = await retention.purgeTechnicalDeliveriesBatch({ dryRun: false, now });
      expect(result.deliveriesAffected).toBe(0);
      expect(await db.notificationDelivery.findUnique({ where: { id: pending.id } })).not.toBeNull();
      expect(await db.notificationDelivery.findUnique({ where: { id: reserved.id } })).not.toBeNull();
    });

    it("occurrence FIXE (vide) même SENT et vieux : JAMAIS purgée — garantie d'idempotence contre un rejeu (thread/announce/thread-summary/thread-close)", async () => {
      const delivery = await makeDelivery({ status: "SENT", occurrence: "" });
      const result = await retention.purgeTechnicalDeliveriesBatch({ dryRun: false, now });
      expect(result.deliveriesAffected).toBe(0);
      expect(await db.notificationDelivery.findUnique({ where: { id: delivery.id } })).not.toBeNull();
    });

    it("SENT récent (dans la fenêtre de rétention technique) : pas encore purgé", async () => {
      const delivery = await makeDelivery({ status: "SENT", createdAt: new Date("2026-09-15T00:00:00.000Z") }); // 5 jours
      const result = await retention.purgeTechnicalDeliveriesBatch({ dryRun: false, now });
      expect(result.deliveriesAffected).toBe(0);
      expect(await db.notificationDelivery.findUnique({ where: { id: delivery.id } })).not.toBeNull();
    });

    it("dry-run : compte sans jamais muter", async () => {
      await makeDelivery({ status: "SENT" });
      const dryRun = await retention.purgeTechnicalDeliveriesBatch({ dryRun: true, now });
      expect(dryRun.deliveriesAffected).toBe(1);
      expect(await db.notificationDelivery.count()).toBe(1); // intacte
    });
  });

  describe("préservation des résultats utiles — XP, badges, résultats de soirée jamais touchés par la purge", () => {
    it("purge du chat d'une soirée éligible : XpEvent/UserBadge/SessionResult intacts, jamais cascadés", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const user = await makeUser();
      const oldSession = await makeSession(user.id, { date: new Date("2026-09-01T00:00:00.000Z") });
      await db.chatMessage.create({ data: { sessionId: oldSession.id, userId: user.id, content: "salut" } });
      await db.xpEvent.create({ data: { userId: user.id, reason: "CREATE_SESSION", sourceId: oldSession.id, amount: 20 } });
      await db.sessionResult.create({ data: { sessionId: oldSession.id, userId: user.id, placement: 1 } });

      await retention.purgeEligibleChatMessagesBatch({ dryRun: false, now });

      expect(await db.xpEvent.count()).toBe(1);
      expect(await db.sessionResult.count()).toBe(1);
      expect(await db.session.findUnique({ where: { id: oldSession.id } })).not.toBeNull();
    });
  });

  describe("reprise après interruption — sans curseur persisté, un lot borné laisse le reste pour le passage suivant", () => {
    it("deux sessions éligibles, lot de taille 1 : le premier passage n'en traite qu'une, le second traite l'autre", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const user = await makeUser();
      const sessionA = await makeSession(user.id, { date: new Date("2026-09-01T00:00:00.000Z") });
      const sessionB = await makeSession(user.id, { date: new Date("2026-09-02T00:00:00.000Z") });
      await db.chatMessage.create({ data: { sessionId: sessionA.id, userId: user.id, content: "a" } });
      await db.chatMessage.create({ data: { sessionId: sessionB.id, userId: user.id, content: "b" } });

      const first = await retention.purgeEligibleChatMessagesBatch({ dryRun: false, limit: 1, now });
      expect(first.candidateSessionIds).toHaveLength(1);
      expect(await db.chatMessage.count()).toBe(1); // une seule des deux traitée

      const second = await retention.purgeEligibleChatMessagesBatch({ dryRun: false, limit: 1, now });
      expect(second.candidateSessionIds).toHaveLength(1);
      expect(second.candidateSessionIds[0]).not.toBe(first.candidateSessionIds[0]); // l'AUTRE session
      expect(await db.chatMessage.count()).toBe(0); // les deux traitées au final

      // Un troisième passage ne trouve plus rien — idempotent, jamais
      // d'erreur sur un lot vide.
      const third = await retention.purgeEligibleChatMessagesBatch({ dryRun: false, limit: 1, now });
      expect(third.candidateSessionIds).toEqual([]);
    });
  });

  describe("isolation entre soirées — purger l'une ne touche JAMAIS les messages d'une autre", () => {
    it("soirée A éligible, soirée B (autre créateur) ENCORE ACTIVE : seule A est purgée, B reste intacte", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const userA = await makeUser();
      const userB = await makeUser();
      const eligible = await makeSession(userA.id, { date: new Date("2026-09-01T00:00:00.000Z") });
      const active = await makeSession(userB.id, { status: "VOTING", date: new Date("2026-09-25T00:00:00.000Z") });
      await db.chatMessage.create({ data: { sessionId: eligible.id, userId: userA.id, content: "prive-A" } });
      await db.chatMessage.create({ data: { sessionId: active.id, userId: userB.id, content: "prive-B" } });

      await retention.purgeEligibleChatMessagesBatch({ dryRun: false, now });

      expect(await db.chatMessage.count({ where: { sessionId: eligible.id } })).toBe(0);
      const remaining = await db.chatMessage.findMany({ where: { sessionId: active.id } });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].content).toBe("prive-B");
    });
  });

  describe("runRetentionCleanup — orchestration, concurrence, dry-run partageant les mêmes critères", () => {
    it("dry-run : ne mute AUCUNE table, aucun appel Discord, aucun verrou requis", async () => {
      const user = await makeUser();
      const session = await makeSession(user.id, { date: new Date("2026-09-01T00:00:00.000Z"), announceViaBot: true });
      await db.chatMessage.create({ data: { sessionId: session.id, userId: user.id, content: "salut" } });

      const report = await runner.runRetentionCleanup({ dryRun: true, now: new Date("2026-09-20T00:00:00.000Z") });
      expect(report.stoppedReason).toBe("completed");
      expect(report.chat?.messagesAffected).toBe(1);
      expect(await db.chatMessage.count()).toBe(1); // intact
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("exécution réelle : purge le chat ET programme le nettoyage Discord, respecte le verrou", async () => {
      const user = await makeUser();
      const session = await makeSession(user.id, { date: new Date("2026-09-01T00:00:00.000Z"), announceViaBot: true });
      await db.chatMessage.create({ data: { sessionId: session.id, userId: user.id, content: "salut" } });

      const report = await runner.runRetentionCleanup({ dryRun: false, now: new Date("2026-09-20T00:00:00.000Z") });
      expect(report.stoppedReason).toBe("completed");
      expect(await db.chatMessage.count()).toBe(0);
      expect(await announceLib.getSessionThreadDeleteStatus(session.id)).toBe("pending");
      expect(fetchMock).not.toHaveBeenCalled(); // enqueue seulement, jamais un appel Discord ici
    });

    it("verrou déjà détenu par une autre exécution : s'arrête immédiatement, ne tente RIEN", async () => {
      await db.$executeRawUnsafe(
        `UPDATE "CronLock" SET "lockedAt" = NOW(), "token" = 'autre-execution' WHERE name = 'retention-cleanup'`
      );
      const user = await makeUser();
      await makeSession(user.id, { date: new Date("2026-09-01T00:00:00.000Z"), announceViaBot: true });

      const report = await runner.runRetentionCleanup({ dryRun: false, now: new Date("2026-09-20T00:00:00.000Z") });
      expect(report.stoppedReason).toBe("lock_not_acquired");
      expect(report.chat).toBeNull();
      expect(report.discordCleanup).toBeNull();
    });

    it("un nettoyage Discord déjà FAILED n'est jamais réessayé automatiquement par ce cron (réservé au réessai manuel — voir discord-cleanup-status.ts) : un passage suivant ne le reprogramme pas en double", async () => {
      const user = await makeUser();
      const session = await makeSession(user.id, { date: new Date("2026-08-01T00:00:00.000Z"), announceViaBot: true });
      // Un fil réel existe (SEND traité et réussi), puis son nettoyage
      // échoue de façon terminale (permission refusée).
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
      await announceLib.enqueueSessionCreationDeliveries(session.id);
      await executorLib.processNextDelivery({ resolver: announceLib.sessionAnnounceResolver, owner: "test" });
      await db.notificationDelivery.deleteMany({
        where: {
          targetSlot: {
            in: [`default-guild:SESSION:${session.id}:announce`, `default-guild:SESSION:${session.id}:creator-member`],
          },
        },
      });
      await announceLib.enqueueSessionThreadDelete(session.id);
      fetchMock.mockResolvedValueOnce(jsonResponse(403, { message: "Missing Permissions", code: 50013 }));
      await executorLib.processNextDelivery({ resolver: announceLib.sessionAnnounceResolver, owner: "test" });
      expect(await announceLib.getSessionThreadDeleteStatus(session.id)).toBe("failed");

      const callsBefore = fetchMock.mock.calls.length;
      const report = await runner.runRetentionCleanup({ dryRun: false, now: new Date("2026-09-20T00:00:00.000Z") });
      expect(report.discordCleanup?.sessionsEnqueued).toEqual([]); // pas re-programmé
      expect(fetchMock.mock.calls.length).toBe(callsBefore); // aucun nouvel appel réseau
      expect(await announceLib.getSessionThreadDeleteStatus(session.id)).toBe("failed"); // inchangé, attend le réessai manuel
    });
  });
});
