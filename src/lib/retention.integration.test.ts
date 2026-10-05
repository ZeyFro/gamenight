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
  let sessionsLib: typeof import("./sessions");
  let homeLib: typeof import("./home");
  let achievementsLib: typeof import("./group-achievements");
  let defaultCommunityLib: typeof import("./default-community");
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const prismaModule = await import("@/lib/prisma");
    db = prismaModule.prisma as unknown as import("@prisma/client").PrismaClient;
    retention = await import("./retention");
    runner = await import("./retention-runner");
    announceLib = await import("./session-announce");
    executorLib = await import("./notification-executor");
    sessionsLib = await import("./sessions");
    homeLib = await import("./home");
    achievementsLib = await import("./group-achievements");
    defaultCommunityLib = await import("./default-community");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      `TRUNCATE "NotificationDelivery", "NotificationEvent", "ChatReaction", "ChatMessage", "SessionInvite", "Vote", "Proposal", "Session", "Notification", "SeasonSnapshot", "Season", "Tournament", "Game", "User", "GroupAchievement", "GroupActiveWeek", "GroupSessionStats", "GroupGameStat", "Community" CASCADE`
    );
    await db.$executeRawUnsafe(`UPDATE "CronLock" SET "lockedAt" = NULL, "token" = NULL WHERE name = 'retention-cleanup'`);
    // GroupSessionStats est un singleton SANS FK vers Session/Game/User —
    // jamais nettoyé par le TRUNCATE ci-dessus (contrairement à
    // GroupGameStat, dont la FK CASCADE vers "Game" le vide déjà) : remis
    // à zéro explicitement, même logique que le reset CronLock ci-dessus.
    // GroupAchievement/GroupActiveWeek n'ont elles-mêmes AUCUNE FK sortante
    // (contrairement à GroupGameStat) — ajoutées explicitement à la liste
    // TRUNCATE ci-dessus, jamais nettoyées par une CASCADE existante.
    // PR9 : les compteurs sont par communauté (TRUNCATE ci-dessus) ; l'identifiant mis en cache de la
    // communauté par défaut doit être oublié avec la table `Community`.
    defaultCommunityLib.resetDefaultCommunityIdCache();
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
    overrides: Partial<{
      status: "VOTING" | "SCHEDULED" | "DONE" | "CANCELLED";
      date: Date;
      announceViaBot: boolean;
      superlativeVotingClosed: boolean;
      decidedGameId: string;
    }> = {}
  ) {
    return db.session.create({
      data: {
        date: overrides.date ?? new Date("2026-09-01T20:00:00.000Z"),
        status: overrides.status ?? "DONE",
        createdById: creatorId,
        announceViaBot: overrides.announceViaBot ?? false,
        // Bloquant par défaut (`false`, valeur par défaut du schéma) sauf
        // demande explicite — la plupart des tests de purge de ligne
        // veulent une soirée réellement purgeable, donc `true` par défaut
        // ICI (contrairement au schéma) pour ne pas alourdir chaque appel.
        superlativeVotingClosed: overrides.superlativeVotingClosed ?? true,
        decidedGameId: overrides.decidedGameId,
      },
    });
  }

  async function makeGame(addedById: string) {
    return db.game.create({ data: { name: uniq("game"), source: "MANUAL", addedById } });
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
        data: {
          community: { connectOrCreate: { where: { slug: "default" }, create: { slug: "default", name: "GameNight", status: "ACTIVE" } } }, number: 2, name: "Saison 2", startDate: new Date("2026-09-01T00:00:00.000Z"), endDate: new Date("2026-10-01T00:00:00.000Z"), isActive: true },
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
        data: {
          community: { connectOrCreate: { where: { slug: "default" }, create: { slug: "default", name: "GameNight", status: "ACTIVE" } } }, number: 2, name: "Saison 2", startDate: new Date("2026-09-01T00:00:00.000Z"), endDate: new Date("2026-10-01T00:00:00.000Z"), isActive: true },
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
        data: {
          community: { connectOrCreate: { where: { slug: "default" }, create: { slug: "default", name: "GameNight", status: "ACTIVE" } } }, number: 2, name: "Saison 2", startDate: new Date("2026-09-01T00:00:00.000Z"), endDate: new Date("2026-10-01T00:00:00.000Z"), isActive: true },
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

  describe("purgeEligibleSessionsBatch — purge RÉELLE de la ligne Session (V2, suite)", () => {
    it("dry-run : compte sans jamais muter, ni la ligne Session ni les résumés durables", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const user = await makeUser();
      const session = await makeSession(user.id, { date: new Date("2026-09-01T00:00:00.000Z") });
      await db.sessionResult.create({
        data: { sessionId: session.id, userId: user.id, placement: 1, gameId: "g1", gameName: "Catan", sessionDate: session.date },
      });

      const dryRun = await retention.purgeEligibleSessionsBatch({ dryRun: true, now });
      expect(dryRun.purgedSessionIds).toEqual([session.id]);
      expect(await db.session.findUnique({ where: { id: session.id } })).not.toBeNull();
      expect(await db.sessionResult.count({ where: { sessionId: session.id } })).toBe(1);
    });

    it("session ACTIVE (VOTING) : jamais purgée, quel que soit l'âge — jamais sur son seul âge", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const user = await makeUser();
      const session = await makeSession(user.id, { status: "VOTING", date: new Date("2020-01-01T00:00:00.000Z") });
      const result = await retention.purgeEligibleSessionsBatch({ dryRun: false, now });
      expect(result.candidateSessionIds).toEqual([]);
      expect(await db.session.findUnique({ where: { id: session.id } })).not.toBeNull();
    });

    it("DONE mais ENCORE DANS la fenêtre de 7 jours : jamais purgée avant son terme", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const user = await makeUser();
      const session = await makeSession(user.id, { date: new Date("2026-09-15T00:00:00.000Z") }); // 5 jours
      const result = await retention.purgeEligibleSessionsBatch({ dryRun: false, now });
      expect(result.candidateSessionIds).toEqual([]);
      expect(await db.session.findUnique({ where: { id: session.id } })).not.toBeNull();
    });

    describe("blocages explicites — jamais une récompense/obligation non finalisée effacée silencieusement", () => {
      it("dette IMPAYÉE liée à la soirée : bloque la purge, remontée avec la bonne raison", async () => {
        const now = new Date("2026-09-20T00:00:00.000Z");
        const user = await makeUser();
        const debtor = await makeUser();
        const session = await makeSession(user.id, { date: new Date("2026-09-01T00:00:00.000Z") });
        await db.debt.create({
          data: { debtorId: debtor.id, sessionId: session.id, reason: "test", paidAt: null },
        });

        const result = await retention.purgeEligibleSessionsBatch({ dryRun: false, now });
        expect(result.candidateSessionIds).toEqual([session.id]);
        expect(result.purgedSessionIds).toEqual([]);
        expect(result.blockedSessions).toEqual([{ sessionId: session.id, reason: "debt_unpaid" }]);
        expect(await db.session.findUnique({ where: { id: session.id } })).not.toBeNull();
      });

      it("dette SOLDÉE : ne bloque plus, purge normalement (la dette payée cascade avec la soirée, plus jamais affichée nulle part)", async () => {
        const now = new Date("2026-09-20T00:00:00.000Z");
        const user = await makeUser();
        const debtor = await makeUser();
        const session = await makeSession(user.id, { date: new Date("2026-09-01T00:00:00.000Z") });
        await db.debt.create({
          data: { debtorId: debtor.id, sessionId: session.id, reason: "test", paidAt: now },
        });

        const result = await retention.purgeEligibleSessionsBatch({ dryRun: false, now });
        expect(result.purgedSessionIds).toEqual([session.id]);
        expect(await db.session.findUnique({ where: { id: session.id } })).toBeNull();
        expect(await db.debt.count()).toBe(0); // soldée, cascadée avec la soirée — plus jamais lue
      });

      it("vote de superlatifs PAS ENCORE clôturé : bloque la purge (pronostics/paris/récompenses pas encore résolus)", async () => {
        const now = new Date("2026-09-20T00:00:00.000Z");
        const user = await makeUser();
        const session = await makeSession(user.id, {
          date: new Date("2026-09-01T00:00:00.000Z"),
          superlativeVotingClosed: false,
        });

        const result = await retention.purgeEligibleSessionsBatch({ dryRun: false, now });
        expect(result.blockedSessions).toEqual([{ sessionId: session.id, reason: "superlative_voting_pending" }]);
        expect(await db.session.findUnique({ where: { id: session.id } })).not.toBeNull();
      });

      it("une fois clôturé, la même soirée devient purgeable au passage suivant — aucun rattrapage manuel nécessaire", async () => {
        const now = new Date("2026-09-20T00:00:00.000Z");
        const user = await makeUser();
        const session = await makeSession(user.id, {
          date: new Date("2026-09-01T00:00:00.000Z"),
          superlativeVotingClosed: false,
        });
        await retention.purgeEligibleSessionsBatch({ dryRun: false, now });
        expect(await db.session.findUnique({ where: { id: session.id } })).not.toBeNull();

        await db.session.update({ where: { id: session.id }, data: { superlativeVotingClosed: true } });
        const result = await retention.purgeEligibleSessionsBatch({ dryRun: false, now });
        expect(result.purgedSessionIds).toEqual([session.id]);
        expect(await db.session.findUnique({ where: { id: session.id } })).toBeNull();
      });
    });

    describe("préservation des résultats/récompenses/statistiques — résumé durable, jamais une table d'archive séparée", () => {
      it("SessionResult SURVIT (sessionId devient null, placement/gameId/gameName/sessionDate intacts) — /profil/historique et revanche.ts continuent de fonctionner", async () => {
        const now = new Date("2026-09-20T00:00:00.000Z");
        const user = await makeUser();
        const session = await makeSession(user.id, { date: new Date("2026-09-01T00:00:00.000Z") });
        const sessionDate = session.date;
        const result = await db.sessionResult.create({
          data: {
            sessionId: session.id,
            userId: user.id,
            placement: 1,
            gameId: "game-1",
            gameName: "Catan",
            sessionDate,
          },
        });

        await retention.purgeEligibleSessionsBatch({ dryRun: false, now });
        expect(await db.session.findUnique({ where: { id: session.id } })).toBeNull();

        const survived = await db.sessionResult.findUniqueOrThrow({ where: { id: result.id } });
        expect(survived.sessionId).toBeNull();
        expect(survived.placement).toBe(1);
        expect(survived.gameId).toBe("game-1");
        expect(survived.gameName).toBe("Catan");
        expect(survived.sessionDate).toEqual(sessionDate);
      });

      it("SuperlativeAward SURVIT (gameName/sessionDate intacts) — vitrine /profil/superlatifs continue de fonctionner", async () => {
        const now = new Date("2026-09-20T00:00:00.000Z");
        const user = await makeUser();
        const session = await makeSession(user.id, { date: new Date("2026-09-01T00:00:00.000Z") });
        const category = await db.superlativeCategory.create({
          data: { name: uniq("MVP"), icon: "🏆", modifiedById: user.id },
        });
        const award = await db.superlativeAward.create({
          data: {
            sessionId: session.id,
            categoryId: category.id,
            winnerUserId: user.id,
            voteCount: 3,
            gameName: "Catan",
            sessionDate: session.date,
          },
        });

        await retention.purgeEligibleSessionsBatch({ dryRun: false, now });

        const survived = await db.superlativeAward.findUniqueOrThrow({ where: { id: award.id } });
        expect(survived.sessionId).toBeNull();
        expect(survived.gameName).toBe("Catan");
        expect(survived.voteCount).toBe(3);
      });

      it("Pronostic SURVIT — taux de réussite À VIE (/profil) jamais sous-compté après purge", async () => {
        const now = new Date("2026-09-20T00:00:00.000Z");
        const user = await makeUser();
        const voter = await makeUser();
        const oldSession = await makeSession(user.id, { date: new Date("2026-08-01T00:00:00.000Z") });
        const recentSession = await makeSession(user.id, { date: new Date("2026-09-18T00:00:00.000Z") }); // dans la fenêtre
        await db.pronostic.create({
          data: { sessionId: oldSession.id, voterId: voter.id, predictedUserId: user.id, correct: true },
        });
        await db.pronostic.create({
          data: { sessionId: recentSession.id, voterId: voter.id, predictedUserId: user.id, correct: false },
        });

        const before = await db.pronostic.groupBy({
          by: ["correct"],
          where: { voterId: voter.id, correct: { not: null } },
          _count: { _all: true },
        });
        expect(before.reduce((sum, g) => sum + g._count._all, 0)).toBe(2);

        await retention.purgeEligibleSessionsBatch({ dryRun: false, now }); // purge oldSession seulement

        expect(await db.session.findUnique({ where: { id: oldSession.id } })).toBeNull();
        const after = await db.pronostic.groupBy({
          by: ["correct"],
          where: { voterId: voter.id, correct: { not: null } },
          _count: { _all: true },
        });
        // Toujours 2 au total — la purge de la soirée n'a fait disparaître
        // AUCUN pronostic résolu, jamais un sous-comptage.
        expect(after.reduce((sum, g) => sum + g._count._all, 0)).toBe(2);
      });

      it("XpBet SURVIT (gameName intact) — historique et somme des gains À VIE (/profil) jamais sous-comptés après purge", async () => {
        const now = new Date("2026-09-20T00:00:00.000Z");
        const user = await makeUser();
        const voter = await makeUser();
        const session = await makeSession(user.id, { date: new Date("2026-09-01T00:00:00.000Z") });
        const bet = await db.xpBet.create({
          data: { sessionId: session.id, voterId: voter.id, targetUserId: user.id, amount: 50, won: true, gameName: "Catan" },
        });

        await retention.purgeEligibleSessionsBatch({ dryRun: false, now });

        const survived = await db.xpBet.findUniqueOrThrow({ where: { id: bet.id } });
        expect(survived.sessionId).toBeNull();
        expect(survived.gameName).toBe("Catan");
        expect(survived.won).toBe(true);
        const sum = await db.xpBet.aggregate({ where: { voterId: voter.id, won: true }, _sum: { amount: true } });
        expect(sum._sum.amount).toBe(50);
      });

      it("checkSessionsCreatedBadges — compte les XpEvent CREATE_SESSION, JAMAIS sous-compté après purge des soirées créées", async () => {
        const badgesLib = await import("./badges");
        const now = new Date("2026-09-20T00:00:00.000Z");
        const user = await makeUser();
        const badge = await db.badge.create({
          data: {
            name: uniq("badge"),
            icon: "🥇",
            description: "test",
            category: "PARTICIPATION",
            rarity: "COMMON",
            criteria: { type: "SESSIONS_CREATED", count: 2 },
            modifiedById: user.id,
          },
        });

        const s1 = await makeSession(user.id, { date: new Date("2026-08-01T00:00:00.000Z") });
        const s2 = await makeSession(user.id, { date: new Date("2026-08-02T00:00:00.000Z") });
        await db.xpEvent.createMany({
          data: [
            { userId: user.id, reason: "CREATE_SESSION", sourceId: s1.id, amount: 20 },
            { userId: user.id, reason: "CREATE_SESSION", sourceId: s2.id, amount: 20 },
          ],
        });

        // AVANT toute purge — le badge (seuil 2) doit déjà se débloquer.
        await badgesLib.checkSessionsCreatedBadges(user.id);
        expect(await db.userBadge.count({ where: { userId: user.id, badgeId: badge.id } })).toBe(1);

        // Purge des deux soirées créées — le badge reste débloqué (jamais
        // retiré, cf. commentaire du modèle UserBadge) ET un NOUVEL appel
        // (ex. après une 3e création) compterait toujours correctement.
        await retention.purgeEligibleSessionsBatch({ dryRun: false, now });
        expect(await db.session.count()).toBe(0);
        expect(await db.xpEvent.count({ where: { userId: user.id, reason: "CREATE_SESSION" } })).toBe(2);
        await badgesLib.checkSessionsCreatedBadges(user.id); // rappel — toujours cohérent, aucune erreur
        expect(await db.userBadge.count({ where: { userId: user.id, badgeId: badge.id } })).toBe(1);
      });
    });

    describe("isolation entre soirées de créateurs différents — purger l'une ne touche jamais les résumés d'une autre", () => {
      it("SessionResult d'un AUTRE user, sur une soirée encore active, reste intact", async () => {
        const now = new Date("2026-09-20T00:00:00.000Z");
        const userA = await makeUser();
        const userB = await makeUser();
        const eligible = await makeSession(userA.id, { date: new Date("2026-09-01T00:00:00.000Z") });
        const active = await makeSession(userB.id, { status: "VOTING", date: new Date("2026-09-25T00:00:00.000Z") });
        await db.sessionResult.create({
          data: { sessionId: eligible.id, userId: userA.id, placement: 1, gameId: "g1", gameName: "A", sessionDate: eligible.date },
        });
        const untouched = await db.sessionResult.create({
          data: { sessionId: active.id, userId: userB.id, placement: 2, gameId: "g2", gameName: "B", sessionDate: active.date },
        });

        await retention.purgeEligibleSessionsBatch({ dryRun: false, now });

        expect(await db.session.findUnique({ where: { id: active.id } })).not.toBeNull();
        const stillLinked = await db.sessionResult.findUniqueOrThrow({ where: { id: untouched.id } });
        expect(stillLinked.sessionId).toBe(active.id); // jamais touché
      });
    });

    describe("reprise après interruption — sans curseur persisté", () => {
      it("deux soirées éligibles, lot de taille 1 : le premier passage n'en purge qu'une, le second l'autre, le troisième ne trouve plus rien", async () => {
        const now = new Date("2026-09-20T00:00:00.000Z");
        const user = await makeUser();
        const a = await makeSession(user.id, { date: new Date("2026-09-01T00:00:00.000Z") });
        const b = await makeSession(user.id, { date: new Date("2026-09-02T00:00:00.000Z") });

        const first = await retention.purgeEligibleSessionsBatch({ dryRun: false, limit: 1, now });
        expect(first.purgedSessionIds).toHaveLength(1);
        expect(await db.session.count()).toBe(1);

        const second = await retention.purgeEligibleSessionsBatch({ dryRun: false, limit: 1, now });
        expect(second.purgedSessionIds).toHaveLength(1);
        expect(second.purgedSessionIds[0]).not.toBe(first.purgedSessionIds[0]);
        expect(await db.session.count()).toBe(0);
        expect([a.id, b.id].sort()).toEqual([first.purgedSessionIds[0], second.purgedSessionIds[0]].sort());

        const third = await retention.purgeEligibleSessionsBatch({ dryRun: false, limit: 1, now });
        expect(third.purgedSessionIds).toEqual([]);
      });
    });

    describe("course concurrente — nouvelle dette détectée entre la sélection et la suppression réelle", () => {
      it("la transaction revérifie sous verrou : une dette créée juste avant l'exécution bloque, jamais une suppression sur un état périmé", async () => {
        const now = new Date("2026-09-20T00:00:00.000Z");
        const user = await makeUser();
        const debtor = await makeUser();
        const session = await makeSession(user.id, { date: new Date("2026-09-01T00:00:00.000Z") });

        // Pas de dette au moment de la sélection des candidats — mais on
        // en crée une AVANT que la fonction ne s'exécute (elle n'a pas
        // encore progressé assez loin dans notre test synchrone pour
        // qu'il y ait une vraie fenêtre réseau ; ce test vérifie la
        // revérification EN TRANSACTION plutôt qu'une vraie course
        // temporelle — voir les tests d'entrelacement `fetchMock` des
        // autres suites pour la vraie technique de race).
        await db.debt.create({ data: { debtorId: debtor.id, sessionId: session.id, reason: "urgent", paidAt: null } });

        const result = await retention.purgeEligibleSessionsBatch({ dryRun: false, now });
        expect(result.purgedSessionIds).toEqual([]);
        expect(await db.session.findUnique({ where: { id: session.id } })).not.toBeNull();
      });
    });
  });

  describe("purgeEligibleTournamentsBatch — purge RÉELLE de la ligne Tournament (V2, suite)", () => {
    async function makeTournament(
      creatorId: string,
      gameId: string,
      overrides: Partial<{ status: "REGISTRATION" | "IN_PROGRESS" | "DONE" | "CANCELLED"; championId: string | null; cancelledAt: Date | null }> = {}
    ) {
      return db.tournament.create({
        data: {
          name: uniq("tournoi"),
          gameId,
          createdById: creatorId,
          maxPlayers: 4,
          status: overrides.status ?? "DONE",
          championId: overrides.championId ?? null,
          cancelledAt: overrides.cancelledAt ?? null,
          announceViaBot: false,
        },
      });
    }

    it("dry-run : compte sans jamais supprimer", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const creator = await makeUser();
      const game = await makeGame(creator.id);
      const tournament = await makeTournament(creator.id, game.id, { championId: creator.id });
      await db.tournamentMatch.create({
        data: { tournamentId: tournament.id, round: 1, position: 0, completedAt: new Date("2026-09-01T00:00:00.000Z") },
      });

      const result = await retention.purgeEligibleTournamentsBatch({ dryRun: true, now });
      expect(result.purgedTournamentIds).toEqual([tournament.id]);
      expect(await db.tournament.findUnique({ where: { id: tournament.id } })).not.toBeNull();
    });

    it("tournoi ACTIF (IN_PROGRESS) : jamais purgé, quel que soit l'âge de ses matchs déjà joués", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const creator = await makeUser();
      const game = await makeGame(creator.id);
      const tournament = await makeTournament(creator.id, game.id, { status: "IN_PROGRESS" });
      await db.tournamentMatch.create({
        data: { tournamentId: tournament.id, round: 1, position: 0, completedAt: new Date("2020-01-01T00:00:00.000Z") },
      });

      const result = await retention.purgeEligibleTournamentsBatch({ dryRun: false, now });
      expect(result.candidateTournamentIds).toEqual([]);
      expect(await db.tournament.findUnique({ where: { id: tournament.id } })).not.toBeNull();
    });

    it("préservation — XpEvent(TOURNAMENT_RESULT) et UserLifetimeStats survivent, checkTournamentBadges reste exact après purge", async () => {
      const badgesLib = await import("./badges");
      const now = new Date("2026-09-20T00:00:00.000Z");
      const champion = await makeUser();
      const runnerUp = await makeUser();
      const game = await makeGame(champion.id);

      const wonBadge = await db.badge.create({
        data: {
          name: uniq("won-badge"),
          icon: "🏆",
          description: "test",
          category: "PARTICIPATION",
          rarity: "COMMON",
          criteria: { type: "TOURNAMENTS_WON", count: 1 },
          modifiedById: champion.id,
        },
      });
      const participatedBadge = await db.badge.create({
        data: {
          name: uniq("participated-badge"),
          icon: "🎮",
          description: "test",
          category: "PARTICIPATION",
          rarity: "COMMON",
          criteria: { type: "TOURNAMENTS_PARTICIPATED", count: 1 },
          modifiedById: champion.id,
        },
      });

      const tournament = await makeTournament(champion.id, game.id, { championId: champion.id });
      await db.tournamentMatch.create({
        data: {
          tournamentId: tournament.id,
          round: 1,
          position: 0,
          player1Id: champion.id,
          player2Id: runnerUp.id,
          winnerId: champion.id,
          completedAt: new Date("2026-09-01T00:00:00.000Z"),
        },
      });
      await db.tournamentParticipant.createMany({
        data: [
          { tournamentId: tournament.id, userId: champion.id },
          { tournamentId: tournament.id, userId: runnerUp.id },
        ],
      });
      // Simule ce que `announceTournamentFinalization`/`registerForTournamentAction`
      // ont déjà écrit durablement AVANT que ce test ne purge le tournoi.
      await db.xpEvent.create({
        data: { userId: champion.id, reason: "TOURNAMENT_RESULT", sourceId: `${tournament.id}:1st`, amount: 200 },
      });
      await db.xpEvent.create({
        data: { userId: runnerUp.id, reason: "TOURNAMENT_RESULT", sourceId: `${tournament.id}:2nd`, amount: 100 },
      });
      await db.userLifetimeStats.createMany({
        data: [
          { userId: champion.id, tournamentsParticipatedCount: 1 },
          { userId: runnerUp.id, tournamentsParticipatedCount: 1 },
        ],
      });

      await badgesLib.checkTournamentBadges(champion.id);
      expect(await db.userBadge.count({ where: { userId: champion.id, badgeId: wonBadge.id } })).toBe(1);
      expect(await db.userBadge.count({ where: { userId: champion.id, badgeId: participatedBadge.id } })).toBe(1);

      const result = await retention.purgeEligibleTournamentsBatch({ dryRun: false, now });
      expect(result.purgedTournamentIds).toEqual([tournament.id]);
      expect(await db.tournament.count()).toBe(0);
      expect(await db.tournamentParticipant.count()).toBe(0); // cascadé, aucune autre lecture durable n'en dépend
      expect(await db.tournamentMatch.count()).toBe(0);

      // Les résumés durables, eux, survivent intégralement.
      expect(await db.xpEvent.count({ where: { reason: "TOURNAMENT_RESULT" } })).toBe(2);
      const stats = await db.userLifetimeStats.findUniqueOrThrow({ where: { userId: champion.id } });
      expect(stats.tournamentsParticipatedCount).toBe(1);

      // Rappel de checkTournamentBadges APRÈS la purge — toujours cohérent.
      await badgesLib.checkTournamentBadges(runnerUp.id);
      expect(await db.userBadge.count({ where: { userId: runnerUp.id, badgeId: participatedBadge.id } })).toBe(1);
      expect(await db.userBadge.count({ where: { userId: runnerUp.id, badgeId: wonBadge.id } })).toBe(0); // jamais champion
    });

    it("reprise après interruption : deux tournois éligibles, lot de taille 1, les deux finissent purgés sur deux passages", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const creator = await makeUser();
      const game = await makeGame(creator.id);
      const t1 = await makeTournament(creator.id, game.id, { championId: creator.id });
      await db.tournamentMatch.create({
        data: { tournamentId: t1.id, round: 1, position: 0, completedAt: new Date("2026-09-01T00:00:00.000Z") },
      });
      const t2 = await makeTournament(creator.id, game.id, { championId: creator.id });
      await db.tournamentMatch.create({
        data: { tournamentId: t2.id, round: 1, position: 0, completedAt: new Date("2026-09-02T00:00:00.000Z") },
      });

      const first = await retention.purgeEligibleTournamentsBatch({ dryRun: false, limit: 1, now });
      expect(first.purgedTournamentIds).toHaveLength(1);
      expect(await db.tournament.count()).toBe(1);

      const second = await retention.purgeEligibleTournamentsBatch({ dryRun: false, limit: 1, now });
      expect(second.purgedTournamentIds).toHaveLength(1);
      expect(await db.tournament.count()).toBe(0);
    });
  });

  describe("runRetentionCleanup — inclut désormais la purge réelle des lignes Session/Tournament", () => {
    it("mode effectif : purge la soirée éligible dans le même passage que le nettoyage Discord programmé", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const user = await makeUser();
      const session = await makeSession(user.id, { date: new Date("2026-09-01T00:00:00.000Z"), announceViaBot: true });

      const report = await runner.runRetentionCleanup({ dryRun: false, now });
      expect(report.sessionRowPurge?.purgedSessionIds).toEqual([session.id]);
      expect(await db.session.findUnique({ where: { id: session.id } })).toBeNull();
      // Le nettoyage Discord a été programmé (enqueue), jamais un appel réel.
      expect(fetchMock).not.toHaveBeenCalled();
      expect(await announceLib.getSessionThreadDeleteStatus(session.id)).toBe("pending");
    });

    it("dry-run : le rapport reflète la purge qui SERAIT faite, sans jamais muter", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const user = await makeUser();
      const session = await makeSession(user.id, { date: new Date("2026-09-01T00:00:00.000Z") });

      const report = await runner.runRetentionCleanup({ dryRun: true, now });
      expect(report.sessionRowPurge?.purgedSessionIds).toEqual([session.id]);
      expect(await db.session.findUnique({ where: { id: session.id } })).not.toBeNull();
    });
  });

  describe("Stats du groupe (Home) — GroupSessionStats/GroupGameStat, résumé durable jamais retouché par la purge", () => {
    it("markSessionDone incrémente les compteurs UNE SEULE FOIS par soirée — rappel idempotent sans double comptage", async () => {
      const user = await makeUser();
      const game = await makeGame(user.id);
      const session = await makeSession(user.id, { status: "SCHEDULED", decidedGameId: game.id });

      await sessionsLib.markSessionDone(session.id);
      expect((await db.groupSessionStats.findFirstOrThrow()).totalSessionsPlayed).toBe(1);
      expect((await db.groupGameStat.findFirstOrThrow({ where: { gameId: game.id } })).playCount).toBe(1);

      // Rappel sur une soirée DÉJÀ DONE (bouton créateur cliqué deux fois,
      // ou passage cron qui retombe sur une soirée déjà clôturée) — le
      // `updateMany` conditionnel sur `status: "SCHEDULED"` ne matche plus
      // rien (`count: 0`), la fonction retourne avant même d'atteindre
      // l'incrément : jamais un second comptage pour la même soirée.
      await sessionsLib.markSessionDone(session.id);
      expect((await db.groupSessionStats.findFirstOrThrow()).totalSessionsPlayed).toBe(1);
      expect((await db.groupGameStat.findFirstOrThrow({ where: { gameId: game.id } })).playCount).toBe(1);
    });

    it("exécution CONCURRENTE de markSessionDone sur la même soirée — un seul incrément, jamais un double comptage", async () => {
      const user = await makeUser();
      const game = await makeGame(user.id);
      const session = await makeSession(user.id, { status: "SCHEDULED", decidedGameId: game.id });

      // Deux appels concurrents (ex. double clic, cron + bouton créateur en
      // même temps) — le verrou de ligne Postgres sur le `updateMany`
      // conditionnel sérialise les deux : un seul obtient `count: 1` et
      // incrémente, l'autre voit `count: 0` et ressort sans rien toucher.
      await Promise.all([sessionsLib.markSessionDone(session.id), sessionsLib.markSessionDone(session.id)]);

      expect((await db.groupSessionStats.findFirstOrThrow()).totalSessionsPlayed).toBe(1);
      expect((await db.groupGameStat.findFirstOrThrow({ where: { gameId: game.id } })).playCount).toBe(1);
      expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).status).toBe("DONE");
    });

    it("getGroupStats() reste IDENTIQUE avant/après purge, sur les MÊMES données — aucune perte, aucun double comptage", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const user = await makeUser();
      const catan = await makeGame(user.id);
      const wingspan = await makeGame(user.id);

      // 3 soirées Catan (purgeables, hors fenêtre de 7 jours) + 1 soirée
      // Wingspan récente (encore dans la fenêtre, jamais purgée) — Catan
      // doit rester "jeu le plus joué" (3 > 1) même APRÈS la purge des 3
      // soirées Catan, puisque le compteur durable ne recule jamais.
      for (let i = 1; i <= 3; i++) {
        const s = await makeSession(user.id, {
          status: "SCHEDULED",
          decidedGameId: catan.id,
          date: new Date(`2026-09-0${i}T20:00:00.000Z`),
        });
        await sessionsLib.markSessionDone(s.id);
      }
      const recent = await makeSession(user.id, {
        status: "SCHEDULED",
        decidedGameId: wingspan.id,
        date: new Date("2026-09-18T20:00:00.000Z"), // dans la fenêtre, jamais purgée
      });
      await sessionsLib.markSessionDone(recent.id);

      const before = await homeLib.getGroupStats("viewer");
      expect(before.totalSessionsPlayed).toBe(4);
      expect(before.mostPlayedGame).toEqual({ name: catan.name, coverUrl: catan.coverUrl, count: 3 });

      const purgeResult = await retention.purgeEligibleSessionsBatch({ dryRun: false, now });
      expect(purgeResult.purgedSessionIds).toHaveLength(3); // les 3 soirées Catan, jamais la récente
      expect(await db.session.count()).toBe(1); // seule la soirée Wingspan récente reste

      const after = await homeLib.getGroupStats("viewer");
      expect(after).toEqual(before); // STRICTEMENT identique — mêmes données, avant et après purge
    });

    it("reprise après interruption — deux passages bornés (limit: 1), les compteurs de groupe restent stables", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const user = await makeUser();
      const game = await makeGame(user.id);

      for (let i = 1; i <= 2; i++) {
        const s = await makeSession(user.id, {
          status: "SCHEDULED",
          decidedGameId: game.id,
          date: new Date(`2026-09-0${i}T20:00:00.000Z`),
        });
        await sessionsLib.markSessionDone(s.id);
      }

      const before = await homeLib.getGroupStats("viewer");
      expect(before.totalSessionsPlayed).toBe(2);
      expect(before.mostPlayedGame).toEqual({ name: game.name, coverUrl: game.coverUrl, count: 2 });

      // La purge elle-même n'écrit JAMAIS dans GroupSessionStats/
      // GroupGameStat (seul `markSessionDone` le fait) — deux passages
      // bornés, ou un seul, ou une interruption entre les deux, ne peuvent
      // donc jamais faire varier ces compteurs.
      const first = await retention.purgeEligibleSessionsBatch({ dryRun: false, limit: 1, now });
      expect(first.purgedSessionIds).toHaveLength(1);
      expect(await homeLib.getGroupStats("viewer")).toEqual(before); // stable après le 1er passage (reprise simulée)

      const second = await retention.purgeEligibleSessionsBatch({ dryRun: false, limit: 1, now });
      expect(second.purgedSessionIds).toHaveLength(1);
      expect(await db.session.count()).toBe(0);
      expect(await homeLib.getGroupStats("viewer")).toEqual(before); // stable après le 2e passage aussi
    });
  });

  describe("Migration 20260924150000_add_group_session_stats + 20260924090000_add_durable_result_summaries — backfill d'une ANCIENNE soirée déjà existante", () => {
    it("gameId/gameName/sessionDate sont renseignés par le backfill de migration AVANT toute purge — pas seulement pour les nouvelles écritures (résultats, récompenses, pronostics, paris)", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const creator = await makeUser();
      const winner = await makeUser();
      const voter = await makeUser();
      const game = await makeGame(creator.id);
      // Soirée "ancienne" — représente une soirée qui existait déjà en
      // production AVANT ce chantier, `decidedGameId` déjà connu :
      // exactement l'état réel au moment où la migration se serait
      // exécutée (la soirée existe encore, la jointure vers elle est
      // encore fiable à 100%).
      const session = await makeSession(creator.id, {
        date: new Date("2026-09-01T20:00:00.000Z"),
        decidedGameId: game.id,
      });
      const category = await db.superlativeCategory.create({
        data: { name: uniq("MVP"), icon: "🏆", modifiedById: creator.id },
      });

      // Les 4 lignes "résultat" créées comme l'ANCIEN code les aurait
      // laissées (avant ce chantier) : `sessionId` posé, colonnes
      // dénormalisées explicitement NULL — l'état exact juste après
      // `ALTER TABLE ... ADD COLUMN`, AVANT que le `UPDATE` de backfill de
      // la migration ne tourne. Une dénormalisation limitée aux nouvelles
      // écritures laisserait ces 4 lignes dans cet état pour toujours.
      const result = await db.sessionResult.create({
        data: { sessionId: session.id, userId: winner.id, placement: 1, gameId: null, gameName: null, sessionDate: null },
      });
      const award = await db.superlativeAward.create({
        data: {
          sessionId: session.id,
          categoryId: category.id,
          winnerUserId: winner.id,
          voteCount: 2,
          gameName: null,
          sessionDate: null,
        },
      });
      const pronostic = await db.pronostic.create({
        data: { sessionId: session.id, voterId: voter.id, predictedUserId: winner.id, correct: true },
      });
      const bet = await db.xpBet.create({
        data: { sessionId: session.id, voterId: voter.id, targetUserId: winner.id, amount: 30, won: true, gameName: null },
      });

      // Avant backfill — exactement l'état qu'une dénormalisation limitée
      // aux nouvelles écritures laisserait indéfiniment.
      expect((await db.sessionResult.findUniqueOrThrow({ where: { id: result.id } })).gameId).toBeNull();

      // Rejoue le UPDATE de backfill EXACT de la migration
      // `20260924090000_add_durable_result_summaries` (copié tel quel
      // depuis prisma/migrations/.../migration.sql, jamais une
      // réimplémentation qui pourrait diverger silencieusement du fichier
      // de migration réellement appliqué en production).
      await db.$executeRawUnsafe(`
        UPDATE "SessionResult" AS sr
        SET "gameId" = s."decidedGameId",
            "gameName" = g."name",
            "sessionDate" = s."date"
        FROM "Session" AS s
        LEFT JOIN "Game" AS g ON g."id" = s."decidedGameId"
        WHERE s."id" = sr."sessionId"
      `);
      await db.$executeRawUnsafe(`
        UPDATE "SuperlativeAward" AS sa
        SET "gameName" = g."name",
            "sessionDate" = s."date"
        FROM "Session" AS s
        LEFT JOIN "Game" AS g ON g."id" = s."decidedGameId"
        WHERE s."id" = sa."sessionId"
      `);
      await db.$executeRawUnsafe(`
        UPDATE "XpBet" AS xb
        SET "gameName" = g."name"
        FROM "Session" AS s
        LEFT JOIN "Game" AS g ON g."id" = s."decidedGameId"
        WHERE s."id" = xb."sessionId"
      `);

      const resultAfterBackfill = await db.sessionResult.findUniqueOrThrow({ where: { id: result.id } });
      expect(resultAfterBackfill.gameId).toBe(game.id);
      expect(resultAfterBackfill.gameName).toBe(game.name);
      expect(resultAfterBackfill.sessionDate).toEqual(session.date);

      const awardAfterBackfill = await db.superlativeAward.findUniqueOrThrow({ where: { id: award.id } });
      expect(awardAfterBackfill.gameName).toBe(game.name);
      expect(awardAfterBackfill.sessionDate).toEqual(session.date);

      const betAfterBackfill = await db.xpBet.findUniqueOrThrow({ where: { id: bet.id } });
      expect(betAfterBackfill.gameName).toBe(game.name);

      // Maintenant que le backfill a tourné — EXACTEMENT comme en
      // production, où la migration s'exécute avant tout déploiement du
      // code de purge —, la soirée est purgée : les 4 lignes doivent
      // survivre avec leurs données correctement renseignées. Une
      // ANCIENNE soirée se comporte désormais exactement comme une
      // nouvelle.
      const purgeResult = await retention.purgeEligibleSessionsBatch({ dryRun: false, now });
      expect(purgeResult.purgedSessionIds).toEqual([session.id]);
      expect(await db.session.findUnique({ where: { id: session.id } })).toBeNull();

      const survivedResult = await db.sessionResult.findUniqueOrThrow({ where: { id: result.id } });
      expect(survivedResult.sessionId).toBeNull();
      expect(survivedResult.gameId).toBe(game.id);
      expect(survivedResult.gameName).toBe(game.name);
      expect(survivedResult.sessionDate).toEqual(session.date);

      const survivedAward = await db.superlativeAward.findUniqueOrThrow({ where: { id: award.id } });
      expect(survivedAward.sessionId).toBeNull();
      expect(survivedAward.gameName).toBe(game.name);
      expect(survivedAward.sessionDate).toEqual(session.date);

      const survivedPronostic = await db.pronostic.findUniqueOrThrow({ where: { id: pronostic.id } });
      expect(survivedPronostic.sessionId).toBeNull();
      expect(survivedPronostic.correct).toBe(true);

      const survivedBet = await db.xpBet.findUniqueOrThrow({ where: { id: bet.id } });
      expect(survivedBet.sessionId).toBeNull();
      expect(survivedBet.gameName).toBe(game.name);
    });
  });

  describe("Trophées de groupe (GroupAchievement) — progression/attribution durables, jamais retouchées par la purge", () => {
    async function makeGroupAchievement(key: string) {
      const def = achievementsLib.GROUP_ACHIEVEMENT_DEFS.find((d) => d.key === key);
      if (!def) throw new Error(`définition de trophée inconnue: ${key}`);
      return db.groupAchievement.create({
        data: { ...def, communityId: await defaultCommunityLib.getDefaultCommunityId() },
      });
    }

    it("« marathoniens » (10 soirées cumulées) se débloque même quand les 9 soirées les plus anciennes ont DÉJÀ été purgées — l'ancien calcul (Session.findMany direct) ne l'aurait jamais vu", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const user = await makeUser();
      const game = await makeGame(user.id);
      await makeGroupAchievement("marathoniens");
      await makeGroupAchievement("century"); // même mécanisme (totalDone), seuil 100 — doit rester verrouillé

      // 9 soirées ANCIENNES, closes puis purgées AVANT que la 10e ne
      // ferme. Avec l'ancien calcul (Session.findMany({status:"DONE"})
      // EN DIRECT), `totalDone` n'aurait alors compté QUE la 10e soirée
      // encore vivante (1 < 10) — jamais assez pour débloquer ce trophée,
      // quel que soit le nombre de soirées jouées au total dans l'histoire
      // du groupe.
      for (let i = 1; i <= 9; i++) {
        const s = await makeSession(user.id, {
          status: "SCHEDULED",
          decidedGameId: game.id,
          date: new Date(`2026-08-0${i}T20:00:00.000Z`),
        });
        await sessionsLib.markSessionDone(s.id);
      }
      const purgeOld = await retention.purgeEligibleSessionsBatch({ dryRun: false, now });
      expect(purgeOld.purgedSessionIds).toHaveLength(9);
      expect(await db.session.count()).toBe(0); // AUCUNE des 9 premières soirées ne survit

      // La 10e soirée, récente — encore dans la fenêtre de rétention.
      const tenth = await makeSession(user.id, {
        status: "SCHEDULED",
        decidedGameId: game.id,
        date: new Date("2026-09-19T20:00:00.000Z"),
      });
      const { unlockedAchievements } = await sessionsLib.markSessionDone(tenth.id);

      expect(unlockedAchievements.map((a) => a.key)).toEqual(["marathoniens"]); // "century" reste verrouillé (10 < 100)
      const marathoniens = await db.groupAchievement.findFirstOrThrow({ where: { key: "marathoniens" } });
      expect(marathoniens.unlockedAt).not.toBeNull();
      const century = await db.groupAchievement.findFirstOrThrow({ where: { key: "century" } });
      expect(century.unlockedAt).toBeNull();
    });

    it("« diversité » (10 jeux distincts cumulés) se débloque même quand les soirées des 9 premiers jeux ont déjà été purgées", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const user = await makeUser();
      await makeGroupAchievement("diversite");

      for (let i = 1; i <= 9; i++) {
        const g = await makeGame(user.id);
        const s = await makeSession(user.id, {
          status: "SCHEDULED",
          decidedGameId: g.id,
          date: new Date(`2026-08-0${i}T20:00:00.000Z`),
        });
        await sessionsLib.markSessionDone(s.id);
      }
      const purgeOld = await retention.purgeEligibleSessionsBatch({ dryRun: false, now });
      expect(purgeOld.purgedSessionIds).toHaveLength(9);
      expect(await db.session.count()).toBe(0);

      const tenthGame = await makeGame(user.id);
      const tenth = await makeSession(user.id, {
        status: "SCHEDULED",
        decidedGameId: tenthGame.id,
        date: new Date("2026-09-19T20:00:00.000Z"),
      });
      const { unlockedAchievements } = await sessionsLib.markSessionDone(tenth.id);
      expect(unlockedAchievements.map((a) => a.key)).toContain("diversite");
    });

    it("« squad » (5 participants distincts cumulés) se débloque même quand TOUTES les soirées où ils ont voté ont déjà été purgées — XpEvent PARTICIPATE survit sans FK vers Session", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const creator = await makeUser();
      const game = await makeGame(creator.id);
      await makeGroupAchievement("squad");

      const participants = [];
      for (let i = 0; i < 5; i++) participants.push(await makeUser());

      // Une soirée par participant, même définition EXACTE de
      // "participant" que closeSession (XpEvent reason: PARTICIPATE) —
      // toutes purgées avant toute nouvelle vérification.
      for (let i = 0; i < 5; i++) {
        const s = await makeSession(creator.id, {
          status: "SCHEDULED",
          decidedGameId: game.id,
          date: new Date(`2026-08-0${i + 1}T20:00:00.000Z`),
        });
        await sessionsLib.markSessionDone(s.id);
        await db.xpEvent.create({
          data: { userId: participants[i].id, reason: "PARTICIPATE", sourceId: s.id, amount: 20 },
        });
      }
      const purgeOld = await retention.purgeEligibleSessionsBatch({ dryRun: false, now });
      expect(purgeOld.purgedSessionIds).toHaveLength(5);
      expect(await db.session.count()).toBe(0); // AUCUNE soirée vivante

      // Aucune nouvelle soirée nécessaire — en production ce serait la
      // clôture de la PROCHAINE soirée qui redéclencherait le check.
      const unlocked = await achievementsLib.checkGroupAchievements(await defaultCommunityLib.getDefaultCommunityId());
      expect(unlocked.map((a) => a.key)).toContain("squad");
      expect(await db.xpEvent.count({ where: { reason: "PARTICIPATE" } })).toBe(5); // survivent intacts
    });

    it("« réguliers » (4 semaines calendaires consécutives) se débloque même quand les 3 premières semaines ont déjà été purgées AVANT que la 4e ne ferme — l'ancien calcul (Session.findMany direct) n'aurait vu que la 4e", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const user = await makeUser();
      const game = await makeGame(user.id);
      await makeGroupAchievement("reguliers");

      // 3 premières semaines consécutives, closes puis purgées AVANT que
      // la 4e ne ferme.
      const firstThreeMondays = ["2026-07-06", "2026-07-13", "2026-07-20"];
      for (const d of firstThreeMondays) {
        const s = await makeSession(user.id, {
          status: "SCHEDULED",
          decidedGameId: game.id,
          date: new Date(`${d}T20:00:00.000Z`),
        });
        await sessionsLib.markSessionDone(s.id);
      }
      const purgeOld = await retention.purgeEligibleSessionsBatch({ dryRun: false, now });
      expect(purgeOld.purgedSessionIds).toHaveLength(3);
      expect(await db.session.count()).toBe(0); // les 3 premières soirées ne survivent pas
      expect(await db.groupActiveWeek.count()).toBe(3); // mais leurs 3 semaines durables, si

      // 4e semaine consécutive (2026-07-27, lundi suivant), fermée APRÈS
      // que les 3 premières soirées ont déjà disparu — avec l'ancien
      // calcul (`doneSessions` EN DIRECT à CE check précis), seule cette
      // 4e semaine serait visible (1 semaine < 4), jamais assez pour
      // débloquer ce trophée.
      const fourth = await makeSession(user.id, {
        status: "SCHEDULED",
        decidedGameId: game.id,
        date: new Date("2026-07-27T20:00:00.000Z"),
      });
      const { unlockedAchievements } = await sessionsLib.markSessionDone(fourth.id);

      expect(unlockedAchievements.map((a) => a.key)).toContain("reguliers");
      expect(await db.groupActiveWeek.count()).toBe(4); // les 4 lignes durables, jamais retouchées par la purge
    });

    it("« noctambules »/« full-house » restent corrects après purge — seuil unique vérifié à la clôture de LA soirée qualifiante elle-même, jamais affecté par la purge d'une AUTRE soirée (progression/attribution identiques avant/après)", async () => {
      const now = new Date("2026-09-20T00:00:00.000Z");
      const creator = await makeUser();
      const otherUser = await makeUser(); // totalUserCount = 2, pour "full-house"
      const game = await makeGame(creator.id);
      await makeGroupAchievement("noctambules");
      await makeGroupAchievement("full-house");

      // La soirée qualifiante : commence après 23h ET réunit TOUS les
      // membres du groupe (2/2) — les deux prédicats se vérifient à SA
      // PROPRE clôture, avant que quoi que ce soit ne puisse être purgé.
      const nightSession = await makeSession(creator.id, {
        status: "SCHEDULED",
        decidedGameId: game.id,
        date: new Date("2026-09-19T23:30:00.000Z"),
      });
      const proposal = await db.proposal.create({
        data: { sessionId: nightSession.id, gameId: game.id, proposedById: creator.id },
      });
      await db.vote.createMany({
        data: [
          { proposalId: proposal.id, userId: creator.id },
          { proposalId: proposal.id, userId: otherUser.id },
        ],
      });

      const { unlockedAchievements } = await sessionsLib.markSessionDone(nightSession.id);
      expect(unlockedAchievements.map((a) => a.key).sort()).toEqual(["full-house", "noctambules"]);

      const before = await db.groupAchievement.findMany({
        where: { key: { in: ["noctambules", "full-house"] } },
        orderBy: { key: "asc" },
        select: { key: true, unlockedAt: true },
      });

      // Purge de PLUSIEURS AUTRES vieilles soirées — jamais un
      // re-verrouillage des deux trophées déjà acquis.
      for (let i = 1; i <= 3; i++) {
        const s = await makeSession(creator.id, {
          status: "SCHEDULED",
          decidedGameId: game.id,
          date: new Date(`2026-08-0${i}T20:00:00.000Z`),
        });
        await sessionsLib.markSessionDone(s.id);
      }
      const purgeResult = await retention.purgeEligibleSessionsBatch({ dryRun: false, now });
      expect(purgeResult.purgedSessionIds).toHaveLength(3); // les 3 vieilles soirées — nightSession encore dans la fenêtre

      const after = await db.groupAchievement.findMany({
        where: { key: { in: ["noctambules", "full-house"] } },
        orderBy: { key: "asc" },
        select: { key: true, unlockedAt: true },
      });
      expect(after).toEqual(before); // STRICTEMENT identiques — ni re-verrouillés, ni re-débloqués
    });

    it("aucune double attribution — un rappel de checkGroupAchievements ne redébloque ni ne renvoie deux fois le même trophée, aucune notification dupliquée", async () => {
      const user = await makeUser();
      const game = await makeGame(user.id);
      await makeGroupAchievement("premiere-soiree");

      const session = await makeSession(user.id, { status: "SCHEDULED", decidedGameId: game.id });
      const { unlockedAchievements: first } = await sessionsLib.markSessionDone(session.id);
      expect(first.map((a) => a.key)).toContain("premiere-soiree");

      const unlockedAt1 = (
        await db.groupAchievement.findFirstOrThrow({ where: { key: "premiere-soiree" } })
      ).unlockedAt;
      expect(await db.notification.count({ where: { type: "ACHIEVEMENT" } })).toBe(1); // 1 seul membre du groupe ici

      // Rappel explicite (ex. clôture d'une AUTRE soirée juste après) — le
      // trophée n'est plus dans `locked` (unlockedAt déjà posé), jamais
      // réévalué ni réannoncé.
      const second = await achievementsLib.checkGroupAchievements(await defaultCommunityLib.getDefaultCommunityId());
      expect(second).toEqual([]);

      const unlockedAt2 = (
        await db.groupAchievement.findFirstOrThrow({ where: { key: "premiere-soiree" } })
      ).unlockedAt;
      expect(unlockedAt2).toEqual(unlockedAt1); // jamais réécrit
      expect(await db.notification.count({ where: { type: "ACHIEVEMENT" } })).toBe(1); // jamais une 2e notification
    });

    it("exécution CONCURRENTE de checkGroupAchievements — un trophée n'est jamais débloqué/annoncé deux fois", async () => {
      const user = await makeUser();
      await makeGroupAchievement("premiere-soiree");
      // Pose directement le compteur durable (équivalent à une clôture
      // déjà survenue) pour isoler ce test sur la concurrence de
      // `checkGroupAchievements` lui-même, plutôt que sur `markSessionDone`
      // (déjà testé séparément ci-dessus, "Stats du groupe").
      const communityId = await defaultCommunityLib.getDefaultCommunityId();
      await db.groupSessionStats.upsert({
        where: { communityId },
        create: { communityId, totalSessionsPlayed: 1 },
        update: { totalSessionsPlayed: 1 },
      });

      const [r1, r2] = await Promise.all([
        achievementsLib.checkGroupAchievements(await defaultCommunityLib.getDefaultCommunityId()),
        achievementsLib.checkGroupAchievements(await defaultCommunityLib.getDefaultCommunityId()),
      ]);
      const totalUnlocked = [...r1, ...r2].filter((a) => a.key === "premiere-soiree");
      expect(totalUnlocked).toHaveLength(1); // un seul des deux appels concurrents l'a réellement débloqué

      expect(await db.notification.count({ where: { type: "ACHIEVEMENT", userId: user.id } })).toBe(1);
    });
  });
});
