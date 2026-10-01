import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Nettoyage automatique des fils Discord (V2) — `discord-thread-cleanup.ts`
 * + résolveurs SESSION/TOURNAMENT + exécuteur, contre une base Postgres
 * isolée et un Discord entièrement simulé (`fetch` mocké, aucun appel
 * réseau réel). Nécessite `TEST_DATABASE_URL` — suite entièrement SKIPPÉE
 * si absente.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn("[discord-thread-cleanup.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE.");
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!TEST_DATABASE_URL)("discord-thread-cleanup (intégration Postgres isolée + Discord HTTP simulé)", () => {
  let db: import("@prisma/client").PrismaClient;
  let cleanup: typeof import("./discord-thread-cleanup");
  let sessionAnnounce: typeof import("./session-announce");
  let tournamentAnnounce: typeof import("./tournament-announce");
  let executorLib: typeof import("./notification-executor");
  let delivery: typeof import("./notification-delivery");
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const prismaModule = await import("@/lib/prisma");
    db = prismaModule.prisma as unknown as import("@prisma/client").PrismaClient;
    cleanup = await import("./discord-thread-cleanup");
    sessionAnnounce = await import("./session-announce");
    tournamentAnnounce = await import("./tournament-announce");
    executorLib = await import("./notification-executor");
    delivery = await import("./notification-delivery");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      `TRUNCATE "NotificationDelivery", "NotificationEvent", "Session", "Tournament", "Game", "User" CASCADE`
    );
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-bot-token");
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "guild-1");
    vi.stubEnv("DISCORD_BOT_SESSION_CHANNEL_ID", "chan-sessions");
    vi.stubEnv("DISCORD_BOT_TOURNAMENT_CHANNEL_ID", "chan-tournois");
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
    overrides: Partial<{ status: "VOTING" | "SCHEDULED" | "DONE" | "CANCELLED"; announceViaBot: boolean }> = {}
  ) {
    return db.session.create({
      data: {
        date: new Date("2026-09-20T20:00:00.000Z"),
        status: overrides.status ?? "DONE",
        createdById: creatorId,
        announceViaBot: overrides.announceViaBot ?? true,
      },
    });
  }

  async function makeTournament(creatorId: string, status: "IN_PROGRESS" | "DONE" | "CANCELLED") {
    const game = await db.game.create({ data: { name: uniq("game"), source: "MANUAL", addedById: creatorId } });
    return db.tournament.create({
      data: {
        name: uniq("tournoi"),
        gameId: game.id,
        createdById: creatorId,
        status,
        maxPlayers: 4,
        announceViaBot: true,
        discordGuildId: "guild-1",
        discordChannelId: "chan-tournois",
      },
    });
  }

  /** Pose directement le SEND `thread` déjà réussi — l'état exact laissé
   * par la création réelle du fil, sans rejouer tout le parcours d'annonce. */
  async function markThreadCreated(kind: "SESSION" | "TOURNAMENT", sourceId: string, threadId: string) {
    const event = await db.notificationEvent.create({
      data: { category: kind, eventType: `${kind}_CREATED`, sourceId },
    });
    await db.notificationDelivery.create({
      data: {
        eventId: event.id,
        channel: "DISCORD_CHANNEL",
        transport: "BOT",
        operation: "SEND",
        recipientKey: "channel",
        targetSlot: `default-guild:${kind}:${sourceId}:thread`,
        status: "SENT",
        sentAt: new Date(),
        discordThreadId: threadId,
      },
    });
  }

  const resolver: import("./notification-executor").DeliveryResolver = {
    resolve: (input) =>
      input.event.category === "SESSION"
        ? sessionAnnounce.sessionAnnounceResolver.resolve(input)
        : tournamentAnnounce.tournamentAnnounceResolver.resolve(input),
  };

  async function processOne() {
    return executorLib.processNextDelivery({ resolver, owner: uniq("worker") });
  }

  function slotRows(targetSlot: string) {
    return db.notificationDelivery.findMany({ where: { targetSlot }, orderBy: { sequence: "asc" } });
  }

  async function backdateArchive(targetSlot: string, ageMs: number) {
    await db.notificationDelivery.updateMany({
      where: { targetSlot, status: "SENT" },
      data: { sentAt: new Date(Date.now() - ageMs) },
    });
  }

  describe("soirée terminée — parcours complet", () => {
    it("archive + verrouille, attend 24 h, puis supprime ; relançable sans doublon", async () => {
      const creator = await makeUser();
      const session = await makeSession(creator.id, { status: "DONE" });
      await markThreadCreated("SESSION", session.id, "thread-s1");
      const slots = sessionAnnounce.sessionThreadCleanupSlots(session.id);

      // Dry-run : même décision, aucune écriture.
      const dry = await cleanup.runDiscordThreadCleanup({ dryRun: true });
      expect(dry.sessions.archiveEnqueued).toEqual([session.id]);
      expect(await slotRows(slots.archive)).toHaveLength(0);

      // Deux passages (y compris concurrents) : une seule intention.
      await Promise.all([
        cleanup.runDiscordThreadCleanup({ dryRun: false }),
        cleanup.runDiscordThreadCleanup({ dryRun: false }),
      ]);
      expect(await slotRows(slots.archive)).toHaveLength(1);

      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { id: "thread-s1", parent_id: "chan-sessions", thread_metadata: { archived: true } })
      );
      expect((await processOne())?.outcome).toBe("sent");
      const [archiveUrl, archiveInit] = fetchMock.mock.calls.at(-1)!;
      expect(String(archiveUrl)).toBe("https://discord.com/api/v10/channels/thread-s1");
      expect(archiveInit.method).toBe("PATCH");
      expect(JSON.parse(String(archiveInit.body))).toEqual({ archived: true, locked: true });

      // Moins de 24 h après l'archivage : aucune suppression.
      const early = await cleanup.runDiscordThreadCleanup({ dryRun: false });
      expect(early.sessions.deleteEnqueued).toEqual([]);
      expect(early.sessions.waiting).toBe(1);
      expect(await slotRows(slots.delete)).toHaveLength(0);

      await backdateArchive(slots.archive, DAY_MS + 60_000);
      const due = await cleanup.runDiscordThreadCleanup({ dryRun: false });
      expect(due.sessions.deleteEnqueued).toEqual([session.id]);

      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      expect((await processOne())?.outcome).toBe("sent");
      const [deleteUrl, deleteInit] = fetchMock.mock.calls.at(-1)!;
      expect(String(deleteUrl)).toBe("https://discord.com/api/v10/channels/thread-s1");
      expect(deleteInit.method).toBe("DELETE");

      // Passage suivant : plus rien à faire, jamais une seconde suppression.
      const after = await cleanup.runDiscordThreadCleanup({ dryRun: false });
      expect(after.sessions).toEqual({ archiveEnqueued: [], deleteEnqueued: [], archiveFailed: [], waiting: 0 });
      expect(await slotRows(slots.delete)).toHaveLength(1);
      expect(await sessionAnnounce.getSessionThreadDeleteStatus(session.id)).toBe("done");
    });

    it("fil déjà supprimé à la main (404) : archivage puis suppression aboutissent, aucun échec bloquant", async () => {
      const creator = await makeUser();
      const session = await makeSession(creator.id, { status: "CANCELLED" });
      await markThreadCreated("SESSION", session.id, "thread-gone");
      const slots = sessionAnnounce.sessionThreadCleanupSlots(session.id);

      await cleanup.runDiscordThreadCleanup({ dryRun: false });
      fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: "Unknown Channel", code: 10003 }));
      expect((await processOne())?.outcome).toBe("sent");

      await backdateArchive(slots.archive, DAY_MS + 60_000);
      await cleanup.runDiscordThreadCleanup({ dryRun: false });
      fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: "Unknown Channel", code: 10003 }));
      expect((await processOne())?.outcome).toBe("sent");
    });

    it("permission manquante (403) à l'archivage : FAILED traçable, suppression bloquée et signalée", async () => {
      const creator = await makeUser();
      const session = await makeSession(creator.id, { status: "DONE" });
      await markThreadCreated("SESSION", session.id, "thread-403");
      const slots = sessionAnnounce.sessionThreadCleanupSlots(session.id);

      await cleanup.runDiscordThreadCleanup({ dryRun: false });
      fetchMock.mockResolvedValueOnce(jsonResponse(403, { message: "Missing Permissions", code: 50013 }));
      expect(await processOne()).toMatchObject({ outcome: "failed", errorClass: "discord:auth_or_permission" });

      const report = await cleanup.runDiscordThreadCleanup({ dryRun: false });
      expect(report.sessions.archiveFailed).toEqual([session.id]);
      expect(report.sessions.deleteEnqueued).toEqual([]);
      expect(await slotRows(slots.delete)).toHaveLength(0);
    });

    it("n'archive jamais pendant qu'une autre livraison doit encore passer par le fil", async () => {
      const creator = await makeUser();
      const session = await makeSession(creator.id, { status: "DONE" });
      await markThreadCreated("SESSION", session.id, "thread-busy");
      await sessionAnnounce.enqueueSessionThreadArchive(session.id);
      const summaryEvent = await db.notificationEvent.create({
        data: { category: "SESSION", eventType: "SESSION_RESULT", sourceId: session.id },
      });
      // Résumé encore en attente, reprise programmée plus tard.
      await db.notificationDelivery.create({
        data: {
          eventId: summaryEvent.id,
          channel: "DISCORD_CHANNEL",
          transport: "BOT",
          operation: "SEND",
          recipientKey: "channel",
          targetSlot: `default-guild:SESSION:${session.id}:thread-summary`,
          status: "PENDING",
          nextAttemptAt: new Date(Date.now() + DAY_MS),
        },
      });

      expect(await processOne()).toMatchObject({ outcome: "retrying", errorClass: "resolver:dependency_not_ready" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("jamais un fil encore utile", () => {
    it("soirée active (VOTING/SCHEDULED) ou sans bot : rien n'est programmé", async () => {
      const creator = await makeUser();
      const voting = await makeSession(creator.id, { status: "VOTING" });
      const scheduled = await makeSession(creator.id, { status: "SCHEDULED" });
      const webhook = await makeSession(creator.id, { status: "DONE", announceViaBot: false });
      await markThreadCreated("SESSION", voting.id, "t-voting");
      await markThreadCreated("SESSION", scheduled.id, "t-scheduled");

      const report = await cleanup.runDiscordThreadCleanup({ dryRun: false });
      expect(report.sessions.archiveEnqueued).toEqual([]);
      expect(await db.notificationDelivery.count({ where: { targetSlot: { contains: ":thread-archive" } } })).toBe(0);
      expect(report.sessions.archiveEnqueued).not.toContain(webhook.id);
    });

    it("suppression enqueue-ée pour une soirée encore active : refusée au traitement, aucun appel Discord", async () => {
      const creator = await makeUser();
      const session = await makeSession(creator.id, { status: "SCHEDULED" });
      await markThreadCreated("SESSION", session.id, "t-active");
      await sessionAnnounce.enqueueSessionThreadDelete(session.id);

      expect(await processOne()).toMatchObject({ outcome: "failed", errorClass: "resolver:expired" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("tournoi en cours : ni fermeture ni suppression, même si une intention existe", async () => {
      const creator = await makeUser();
      const tournament = await makeTournament(creator.id, "IN_PROGRESS");
      await markThreadCreated("TOURNAMENT", tournament.id, "t-live");

      const report = await cleanup.runDiscordThreadCleanup({ dryRun: false });
      expect(report.tournaments.archiveEnqueued).toEqual([]);

      await tournamentAnnounce.enqueueTournamentThreadDelete(tournament.id);
      expect(await processOne()).toMatchObject({ outcome: "failed", errorClass: "resolver:expired" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("tournoi terminé", () => {
    it("DONE : fermeture verrouillée, puis suppression 24 h plus tard", async () => {
      const creator = await makeUser();
      const tournament = await makeTournament(creator.id, "DONE");
      await markThreadCreated("TOURNAMENT", tournament.id, "thread-t1");
      const slots = tournamentAnnounce.tournamentThreadCleanupSlots(tournament.id);

      const first = await cleanup.runDiscordThreadCleanup({ dryRun: false });
      expect(first.tournaments.archiveEnqueued).toEqual([tournament.id]);
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { id: "thread-t1", parent_id: "chan-tournois", thread_metadata: { archived: true } })
      );
      expect((await processOne())?.outcome).toBe("sent");
      expect(JSON.parse(String(fetchMock.mock.calls.at(-1)![1].body))).toEqual({ archived: true, locked: true });

      await backdateArchive(slots.archive, DAY_MS + 60_000);
      const due = await cleanup.runDiscordThreadCleanup({ dryRun: false });
      expect(due.tournaments.deleteEnqueued).toEqual([tournament.id]);
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      expect((await processOne())?.outcome).toBe("sent");
      expect(fetchMock.mock.calls.at(-1)![1].method).toBe("DELETE");
    });
  });

  describe("429 : le retry_after de Discord est respecté", () => {
    async function sessionWithArchiveEnqueued() {
      const creator = await makeUser();
      const session = await makeSession(creator.id, { status: "DONE" });
      await markThreadCreated("SESSION", session.id, "thread-429");
      await cleanup.runDiscordThreadCleanup({ dryRun: false });
      return { session, slots: sessionAnnounce.sessionThreadCleanupSlots(session.id) };
    }

    it("archivage : 429 retry_after=12 s → reprogrammé à +12 s (pas le backoff générique), inatteignable avant, rejoué ensuite", async () => {
      const { slots } = await sessionWithArchiveEnqueued();
      const t0 = new Date();
      fetchMock.mockResolvedValueOnce(jsonResponse(429, { message: "rate limited", retry_after: 12, global: false }));
      const first = await executorLib.processNextDelivery({ resolver, owner: uniq("w"), now: t0 });
      expect(first).toMatchObject({ outcome: "retrying", errorClass: "discord:rate_limited" });

      const [row] = await slotRows(slots.archive);
      expect(row.status).toBe("PENDING");
      const delayMs = row.nextAttemptAt!.getTime() - t0.getTime();
      expect(delayMs).toBeGreaterThanOrEqual(12_000);
      expect(delayMs).toBeLessThan(15_000);

      // Avant l'échéance : rien n'est réservé, aucun nouvel appel Discord.
      const calls = fetchMock.mock.calls.length;
      const early = await executorLib.processNextDelivery({
        resolver,
        owner: uniq("w"),
        now: new Date(t0.getTime() + 5_000),
      });
      expect(early).toBeNull();
      expect(fetchMock.mock.calls.length).toBe(calls);

      // Après : rejoué et abouti, toujours une seule ligne sur le slot.
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { id: "thread-429", parent_id: "chan-sessions", thread_metadata: { archived: true } })
      );
      const later = await executorLib.processNextDelivery({
        resolver,
        owner: uniq("w"),
        now: new Date(t0.getTime() + 13_000),
      });
      expect(later?.outcome).toBe("sent");
      expect(await slotRows(slots.archive)).toHaveLength(1);
    });

    it("suppression : 429 avec en-tête Retry-After seul → délai respecté, pas de doublon par le cron, puis suppression réussie", async () => {
      const { slots } = await sessionWithArchiveEnqueued();
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { id: "thread-429", parent_id: "chan-sessions", thread_metadata: { archived: true } })
      );
      expect((await processOne())?.outcome).toBe("sent");
      await backdateArchive(slots.archive, DAY_MS + 60_000);
      await cleanup.runDiscordThreadCleanup({ dryRun: false });

      const t0 = new Date();
      fetchMock.mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "Retry-After": "30" } }));
      const limited = await executorLib.processNextDelivery({ resolver, owner: uniq("w"), now: t0 });
      expect(limited).toMatchObject({ outcome: "retrying", errorClass: "discord:rate_limited" });
      const [row] = await slotRows(slots.delete);
      const delayMs = row.nextAttemptAt!.getTime() - t0.getTime();
      expect(delayMs).toBeGreaterThanOrEqual(30_000);
      expect(delayMs).toBeLessThan(33_000);

      // Un passage cron entre-temps ne double pas la suppression.
      const report = await cleanup.runDiscordThreadCleanup({ dryRun: false });
      expect(report.sessions.deleteEnqueued).toEqual([]);
      expect(await slotRows(slots.delete)).toHaveLength(1);

      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      const later = await executorLib.processNextDelivery({
        resolver,
        owner: uniq("w"),
        now: new Date(t0.getTime() + 31_000),
      });
      expect(later?.outcome).toBe("sent");
    });
  });

  describe("tournoi : fil déjà supprimé à la main (404)", () => {
    it("fermeture puis suppression aboutissent sans échec bloquant", async () => {
      const creator = await makeUser();
      const tournament = await makeTournament(creator.id, "CANCELLED");
      await markThreadCreated("TOURNAMENT", tournament.id, "t-gone");
      const slots = tournamentAnnounce.tournamentThreadCleanupSlots(tournament.id);

      await cleanup.runDiscordThreadCleanup({ dryRun: false });
      fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: "Unknown Channel", code: 10003 }));
      expect((await processOne())?.outcome).toBe("sent");

      await backdateArchive(slots.archive, DAY_MS + 60_000);
      const due = await cleanup.runDiscordThreadCleanup({ dryRun: false });
      expect(due.tournaments.archiveFailed).toEqual([]);
      expect(due.tournaments.deleteEnqueued).toEqual([tournament.id]);
      fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: "Unknown Channel", code: 10003 }));
      expect((await processOne())?.outcome).toBe("sent");
    });
  });

  describe("reprise après interruption — aucun doublon (idempotence targetSlot)", () => {
    it("passage interrompu entre createNotificationEvent et enqueueDelivery : le relancer crée exactement 1 livraison", async () => {
      const creator = await makeUser();
      const session = await makeSession(creator.id, { status: "DONE" });
      await markThreadCreated("SESSION", session.id, "thread-int1");
      const slots = sessionAnnounce.sessionThreadCleanupSlots(session.id);

      // État laissé par un crash : l'événement existe, la livraison non.
      await db.notificationEvent.create({
        data: { category: "SESSION", eventType: "SESSION_THREAD_ARCHIVE", sourceId: session.id },
      });
      expect(await slotRows(slots.archive)).toHaveLength(0);

      const report = await cleanup.runDiscordThreadCleanup({ dryRun: false });
      expect(report.sessions.archiveEnqueued).toEqual([session.id]);
      await cleanup.runDiscordThreadCleanup({ dryRun: false });

      expect(await slotRows(slots.archive)).toHaveLength(1);
      expect(
        await db.notificationEvent.count({ where: { eventType: "SESSION_THREAD_ARCHIVE", sourceId: session.id } })
      ).toBe(1);
    });

    it("passage interrompu par le plafond puis relancé plusieurs fois : chaque fil a exactement 1 archivage", async () => {
      const creator = await makeUser();
      const ids: string[] = [];
      for (let i = 0; i < 4; i++) {
        const s = await makeSession(creator.id, { status: "DONE" });
        await markThreadCreated("SESSION", s.id, `t-int-${i}`);
        ids.push(s.id);
      }
      await cleanup.runDiscordThreadCleanup({ dryRun: false, maxActions: 1 });
      await cleanup.runDiscordThreadCleanup({ dryRun: false, maxActions: 2 });
      await cleanup.runDiscordThreadCleanup({ dryRun: false });
      await cleanup.runDiscordThreadCleanup({ dryRun: false });

      for (const id of ids) {
        expect(await slotRows(sessionAnnounce.sessionThreadCleanupSlots(id).archive)).toHaveLength(1);
      }
    });

    it("exécuteur mort après réservation (bail expiré) : le cron n'enqueue rien de plus, la reprise archive une seule fois", async () => {
      const creator = await makeUser();
      const session = await makeSession(creator.id, { status: "DONE" });
      await markThreadCreated("SESSION", session.id, "thread-int3");
      const slots = sessionAnnounce.sessionThreadCleanupSlots(session.id);
      await cleanup.runDiscordThreadCleanup({ dryRun: false });

      // Un worker réserve la livraison puis « meurt » sans la finaliser.
      const t0 = new Date();
      const claimed = await delivery.claimNextDelivery("worker-mort", { now: t0, leaseMs: 30_000 });
      expect(claimed?.status).toBe("RESERVED");

      // Cron relancé pendant ce temps : l'archivage est « en attente », rien de nouveau.
      const during = await cleanup.runDiscordThreadCleanup({ dryRun: false });
      expect(during.sessions.archiveEnqueued).toEqual([]);
      expect(during.sessions.waiting).toBe(1);
      expect(await slotRows(slots.archive)).toHaveLength(1);

      // Bail expiré : récupérée, rejouée, un seul appel Discord réussi.
      expect(await delivery.recoverExpiredReservations(new Date(t0.getTime() + 60_000))).toBe(1);
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { id: "thread-int3", parent_id: "chan-sessions", thread_metadata: { archived: true } })
      );
      const replay = await executorLib.processNextDelivery({
        resolver,
        owner: uniq("w"),
        now: new Date(t0.getTime() + 61_000),
      });
      expect(replay?.outcome).toBe("sent");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const rows = await slotRows(slots.archive);
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("SENT");
    });
  });

  describe("bornes d'un passage", () => {
    it("plafond d'actions atteint : le reste est repris au passage suivant, jamais perdu", async () => {
      const creator = await makeUser();
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const s = await makeSession(creator.id, { status: "DONE" });
        await markThreadCreated("SESSION", s.id, `t-${i}`);
        ids.push(s.id);
      }

      const first = await cleanup.runDiscordThreadCleanup({ dryRun: false, maxActions: 2 });
      expect(first.truncated).toBe(true);
      expect(first.sessions.archiveEnqueued).toHaveLength(2);

      const second = await cleanup.runDiscordThreadCleanup({ dryRun: false, maxActions: 2 });
      expect(second.truncated).toBe(false);
      expect([...first.sessions.archiveEnqueued, ...second.sessions.archiveEnqueued].sort()).toEqual([...ids].sort());
    });
  });
});
