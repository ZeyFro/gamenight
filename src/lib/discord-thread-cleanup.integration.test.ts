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
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const prismaModule = await import("@/lib/prisma");
    db = prismaModule.prisma as unknown as import("@prisma/client").PrismaClient;
    cleanup = await import("./discord-thread-cleanup");
    sessionAnnounce = await import("./session-announce");
    tournamentAnnounce = await import("./tournament-announce");
    executorLib = await import("./notification-executor");
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
