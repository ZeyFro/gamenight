import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Archivage IMMÉDIAT des fils à la fin (drapeau
 * `DISCORD_THREAD_CLOSE_ON_END_ENABLED`) : vrais points d'entrée
 * (`cancelSession`, `markSessionDone`, `closeSession`, `declareWinner`)
 * contre une base Postgres isolée et un Discord entièrement simulé (`fetch`
 * mocké, aucun appel réseau réel). Nécessite `TEST_DATABASE_URL` — suite
 * entièrement SKIPPÉE si absente.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn("[thread-close-on-end.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE.");
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!TEST_DATABASE_URL)("archivage immédiat des fils à la fin (Postgres isolée + Discord HTTP simulé)", () => {
  let db: import("@prisma/client").PrismaClient;
  let cleanup: typeof import("./discord-thread-cleanup");
  let closeOnEnd: typeof import("./thread-close-on-end");
  let sessionsLib: typeof import("./sessions");
  let tournamentsLib: typeof import("./tournaments");
  let sessionAnnounce: typeof import("./session-announce");
  let tournamentAnnounce: typeof import("./tournament-announce");
  let executorLib: typeof import("./notification-executor");
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as import("@prisma/client").PrismaClient;
    cleanup = await import("./discord-thread-cleanup");
    closeOnEnd = await import("./thread-close-on-end");
    sessionsLib = await import("./sessions");
    tournamentsLib = await import("./tournaments");
    sessionAnnounce = await import("./session-announce");
    tournamentAnnounce = await import("./tournament-announce");
    executorLib = await import("./notification-executor");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      `TRUNCATE "NotificationDelivery", "NotificationEvent", "Session", "Tournament", "Game", "User", "GroupSessionStats", "GroupGameStat", "GroupActiveWeek" CASCADE`
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

  /** Nouveau drapeau + nettoyage existant en `execute` (valeurs de TEST, jamais de vraies variables). */
  function enableCloseOnEnd() {
    vi.stubEnv(closeOnEnd.THREAD_CLOSE_ON_END_FLAG, "true");
    vi.stubEnv("DISCORD_THREAD_CLEANUP_ENABLED", "true");
    vi.stubEnv("DISCORD_THREAD_CLEANUP_MODE", "execute");
  }

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
        status: overrides.status ?? "VOTING",
        createdById: creatorId,
        announceViaBot: overrides.announceViaBot ?? true,
      },
    });
  }

  async function makeTournament(creatorId: string, status: "REGISTRATION" | "IN_PROGRESS" | "DONE") {
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

  /** Pose directement le SEND `thread` déjà réussi — l'état laissé par la création réelle du fil. */
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

  /** Simule « l'annonce éditée à la fin est déjà partie » : tout ce qui n'est pas archivage/suppression passe SENT. */
  async function settleOtherDeliveries(prefix: string, except: string[]) {
    await db.notificationDelivery.updateMany({
      where: { targetSlot: { startsWith: prefix, notIn: except }, status: { not: "SENT" } },
      data: { status: "SENT", sentAt: new Date() },
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

  async function backdate(targetSlot: string, ageMs: number) {
    await db.notificationDelivery.updateMany({
      where: { targetSlot, status: "SENT" },
      data: { sentAt: new Date(Date.now() - ageMs) },
    });
  }

  describe("drapeau éteint ou nettoyage non exécutif : rien ne change", () => {
    it("par défaut (aucune variable) : cancelSession n'enqueue aucun archivage", async () => {
      const creator = await makeUser();
      const session = await makeSession(creator.id);
      await markThreadCreated("SESSION", session.id, "thread-off");

      await sessionsLib.cancelSession(session.id);

      const slots = sessionAnnounce.sessionThreadCleanupSlots(session.id);
      expect(await slotRows(slots.archive)).toHaveLength(0);
      expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).status).toBe("CANCELLED");
    });

    it.each([
      ["nouveau drapeau seul", { onEnd: "true" }],
      ["nettoyage éteint", { onEnd: "true", mode: "execute" }],
      ["nettoyage en dry-run", { onEnd: "true", enabled: "true" }],
      ["nettoyage en dry-run explicite", { onEnd: "true", enabled: "true", mode: "dry-run" }],
    ])("%s : aucun fil touché", async (_label, vars: { onEnd?: string; enabled?: string; mode?: string }) => {
      if (vars.onEnd) vi.stubEnv(closeOnEnd.THREAD_CLOSE_ON_END_FLAG, vars.onEnd);
      if (vars.enabled) vi.stubEnv("DISCORD_THREAD_CLEANUP_ENABLED", vars.enabled);
      if (vars.mode) vi.stubEnv("DISCORD_THREAD_CLEANUP_MODE", vars.mode);
      const creator = await makeUser();
      const session = await makeSession(creator.id);
      await markThreadCreated("SESSION", session.id, "thread-guard");

      await sessionsLib.cancelSession(session.id);

      expect(await slotRows(sessionAnnounce.sessionThreadCleanupSlots(session.id).archive)).toHaveLength(0);
    });
  });

  describe("soirée : l'archivage est programmé dès la fin", () => {
    it("cancelSession : archivage enqueue-é tout de suite, exécuté une seule fois (verrouillé), suppression 24 h plus tard par le cron existant", async () => {
      enableCloseOnEnd();
      const creator = await makeUser();
      const session = await makeSession(creator.id);
      await markThreadCreated("SESSION", session.id, "thread-s1");
      const slots = sessionAnnounce.sessionThreadCleanupSlots(session.id);

      await sessionsLib.cancelSession(session.id);

      // Programmé par la transition elle-même, sans aucun passage du cron.
      expect(await slotRows(slots.archive)).toHaveLength(1);

      await settleOtherDeliveries(slots.prefix, [slots.archive, slots.delete]);
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { id: "thread-s1", parent_id: "chan-sessions", thread_metadata: { archived: true } })
      );
      expect((await processOne())?.outcome).toBe("sent");
      const [url, init] = fetchMock.mock.calls.at(-1)!;
      expect(String(url)).toBe("https://discord.com/api/v10/channels/thread-s1");
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(String(init.body))).toEqual({ archived: true, locked: true });

      // Le cron ne double rien : le fil est déjà archivé, il attend simplement les 24 h.
      const early = await cleanup.runDiscordThreadCleanup({ dryRun: false });
      expect(early.sessions.archiveEnqueued).toEqual([]);
      expect(early.sessions.waiting).toBe(1);
      expect(await slotRows(slots.archive)).toHaveLength(1);

      await backdate(slots.archive, DAY_MS + 60_000);
      const due = await cleanup.runDiscordThreadCleanup({ dryRun: false });
      expect(due.sessions.deleteEnqueued).toEqual([session.id]);
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      expect((await processOne())?.outcome).toBe("sent");
      expect(fetchMock.mock.calls.at(-1)![1].method).toBe("DELETE");
    });

    it("markSessionDone (SCHEDULED → DONE) : archivage enqueue-é, mais jamais avant que l'annonce éditée soit partie", async () => {
      enableCloseOnEnd();
      const creator = await makeUser();
      const session = await makeSession(creator.id, { status: "SCHEDULED" });
      await markThreadCreated("SESSION", session.id, "thread-done");
      const slots = sessionAnnounce.sessionThreadCleanupSlots(session.id);

      await sessionsLib.markSessionDone(session.id);

      expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).status).toBe("DONE");
      expect(await slotRows(slots.archive)).toHaveLength(1);
      // L'édition d'annonce enqueue-ée par la même transition passe d'abord (aucun appel Discord ici).
      const archive = (await slotRows(slots.archive))[0];
      expect(archive.status).toBe("PENDING");
    });

    it("closeSession sans proposition (annulée) : archivage enqueue-é", async () => {
      enableCloseOnEnd();
      const creator = await makeUser();
      const session = await makeSession(creator.id);
      await markThreadCreated("SESSION", session.id, "thread-empty");

      await sessionsLib.closeSession(session.id);

      expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).status).toBe("CANCELLED");
      expect(await slotRows(sessionAnnounce.sessionThreadCleanupSlots(session.id).archive)).toHaveLength(1);
    });

    it("closeSession : proposition jouable mais aucun vote (annulation silencieuse) : archivage enqueue-é aussi", async () => {
      enableCloseOnEnd();
      const creator = await makeUser();
      const session = await makeSession(creator.id);
      await markThreadCreated("SESSION", session.id, "thread-zero-vote");
      // Une proposition JOUABLE (un possesseur disponible ce jour-là) mais sans aucun vote.
      const game = await db.game.create({
        data: { name: uniq("game"), source: "MANUAL", addedById: creator.id, minPlayers: 1 },
      });
      await db.userGame.create({ data: { userId: creator.id, gameId: game.id, owned: true } });
      await db.weeklyAvailability.create({
        data: { userId: creator.id, dayOfWeek: session.date.getUTCDay(), startTime: "00:00", endTime: "23:59" },
      });
      await db.proposal.create({ data: { sessionId: session.id, gameId: game.id, proposedById: creator.id } });

      const result = await sessionsLib.closeSession(session.id);

      expect(result).toEqual({ discord: null });
      expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).status).toBe("CANCELLED");
      expect(await slotRows(sessionAnnounce.sessionThreadCleanupSlots(session.id).archive)).toHaveLength(1);
    });

    it("fil pas encore créé : rien n'est enqueue-é maintenant (jamais un refus définitif), le cron l'archive ensuite", async () => {
      enableCloseOnEnd();
      const creator = await makeUser();
      const session = await makeSession(creator.id);
      const slots = sessionAnnounce.sessionThreadCleanupSlots(session.id);

      await sessionsLib.cancelSession(session.id);
      expect(await slotRows(slots.archive)).toHaveLength(0);

      await markThreadCreated("SESSION", session.id, "thread-late");
      const report = await cleanup.runDiscordThreadCleanup({ dryRun: false });
      expect(report.sessions.archiveEnqueued).toEqual([session.id]);
    });

    it("non éligible : soirée encore active, sans annonce bot ou inexistante", async () => {
      enableCloseOnEnd();
      const creator = await makeUser();
      const active = await makeSession(creator.id, { status: "VOTING" });
      const noBot = await makeSession(creator.id, { status: "CANCELLED", announceViaBot: false });
      await markThreadCreated("SESSION", active.id, "thread-a");
      await markThreadCreated("SESSION", noBot.id, "thread-b");

      expect(await cleanup.closeThreadOnEnd("session", active.id)).toBe("not_eligible");
      expect(await cleanup.closeThreadOnEnd("session", noBot.id)).toBe("not_eligible");
      expect(await cleanup.closeThreadOnEnd("session", "inexistante")).toBe("not_eligible");
      expect(await slotRows(sessionAnnounce.sessionThreadCleanupSlots(active.id).archive)).toHaveLength(0);
      expect(await slotRows(sessionAnnounce.sessionThreadCleanupSlots(noBot.id).archive)).toHaveLength(0);
    });
  });

  describe("idempotence", () => {
    it("appels répétés et concurrents, puis passage du cron : exactement 1 archivage", async () => {
      const creator = await makeUser();
      const session = await makeSession(creator.id, { status: "CANCELLED" });
      await markThreadCreated("SESSION", session.id, "thread-idem");
      const slots = sessionAnnounce.sessionThreadCleanupSlots(session.id);

      const results = await Promise.all([
        cleanup.closeThreadOnEnd("session", session.id),
        cleanup.closeThreadOnEnd("session", session.id),
        cleanup.closeThreadOnEnd("session", session.id),
      ]);
      expect(results.filter((r) => r === "enqueued").length).toBeGreaterThanOrEqual(1);
      expect(await cleanup.closeThreadOnEnd("session", session.id)).toBe("not_needed");

      const report = await cleanup.runDiscordThreadCleanup({ dryRun: false });
      expect(report.sessions.archiveEnqueued).toEqual([]);
      expect(await slotRows(slots.archive)).toHaveLength(1);
    });

    it("archivage déjà fait par le cron : l'archivage immédiat ne le refait pas", async () => {
      const creator = await makeUser();
      const session = await makeSession(creator.id, { status: "DONE" });
      await markThreadCreated("SESSION", session.id, "thread-cron-first");
      const slots = sessionAnnounce.sessionThreadCleanupSlots(session.id);

      await cleanup.runDiscordThreadCleanup({ dryRun: false });
      expect(await cleanup.closeThreadOnEnd("session", session.id)).toBe("not_needed");
      expect(await slotRows(slots.archive)).toHaveLength(1);
    });
  });

  describe("échecs Discord via l'archivage immédiat", () => {
    async function cancelledSessionWithThread(threadId: string) {
      enableCloseOnEnd();
      const creator = await makeUser();
      const session = await makeSession(creator.id);
      await markThreadCreated("SESSION", session.id, threadId);
      const slots = sessionAnnounce.sessionThreadCleanupSlots(session.id);
      await sessionsLib.cancelSession(session.id);
      await settleOtherDeliveries(slots.prefix, [slots.archive, slots.delete]);
      return { session, slots };
    }

    it("fil déjà supprimé à la main (404, code 10003) : l'objectif est atteint, aucun échec bloquant", async () => {
      const { session, slots } = await cancelledSessionWithThread("thread-gone");

      fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: "Unknown Channel", code: 10003 }));
      expect((await processOne())?.outcome).toBe("sent");

      const report = await cleanup.runDiscordThreadCleanup({ dryRun: false });
      expect(report.sessions.archiveFailed).toEqual([]);
      expect(await slotRows(slots.archive)).toHaveLength(1);

      // Puis la suppression, elle aussi sur un fil déjà absent : aboutie.
      await backdate(slots.archive, DAY_MS + 60_000);
      await cleanup.runDiscordThreadCleanup({ dryRun: false });
      fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: "Unknown Channel", code: 10003 }));
      expect((await processOne())?.outcome).toBe("sent");
      expect(await sessionAnnounce.getSessionThreadDeleteStatus(session.id)).toBe("done");
    });

    it("permission manquante (403, code 50013) : échec traçable, suppression bloquée et signalée, jamais contournée", async () => {
      const { session, slots } = await cancelledSessionWithThread("thread-403");

      fetchMock.mockResolvedValueOnce(jsonResponse(403, { message: "Missing Permissions", code: 50013 }));
      expect(await processOne()).toMatchObject({ outcome: "failed", errorClass: "discord:auth_or_permission" });

      const report = await cleanup.runDiscordThreadCleanup({ dryRun: false });
      expect(report.sessions.archiveFailed).toEqual([session.id]);
      expect(report.sessions.deleteEnqueued).toEqual([]);
      expect(await slotRows(slots.delete)).toHaveLength(0);
      expect(await slotRows(slots.archive)).toHaveLength(1);
    });

    it("permission manquante à la SUPPRESSION (403) : échec traçable, jamais reprogrammé en boucle par le cron", async () => {
      const { session, slots } = await cancelledSessionWithThread("thread-del-403");
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-del-403", thread_metadata: { archived: true } }));
      expect((await processOne())?.outcome).toBe("sent");

      await backdate(slots.archive, DAY_MS + 60_000);
      await cleanup.runDiscordThreadCleanup({ dryRun: false });
      fetchMock.mockResolvedValueOnce(jsonResponse(403, { message: "Missing Permissions", code: 50013 }));
      expect(await processOne()).toMatchObject({ outcome: "failed", errorClass: "discord:auth_or_permission" });

      expect(await sessionAnnounce.getSessionThreadDeleteStatus(session.id)).toBe("failed");
      const again = await cleanup.runDiscordThreadCleanup({ dryRun: false });
      expect(again.sessions.deleteEnqueued).toEqual([]);
      expect(await slotRows(slots.delete)).toHaveLength(1);
    });
  });

  describe("tournoi : l'archivage est programmé dès la fin (DONE)", () => {
    async function finishedBracket(withThread: boolean) {
      const creator = await makeUser();
      const tournament = await makeTournament(creator.id, "REGISTRATION");
      const players = [creator, await makeUser(), await makeUser(), await makeUser()];
      for (const p of players) await db.tournamentParticipant.create({ data: { tournamentId: tournament.id, userId: p.id } });
      await db.$transaction((tx) => tournamentsLib.buildBracketInTransaction(tx, tournament.id));
      if (withThread) await markThreadCreated("TOURNAMENT", tournament.id, "thread-t1");

      const round1 = await db.tournamentMatch.findMany({ where: { tournamentId: tournament.id, round: 1 }, orderBy: { position: "asc" } });
      const winners: string[] = [];
      for (const match of round1) {
        const winnerId = match.player1Id ?? match.player2Id!;
        await tournamentsLib.declareWinner(match.id, winnerId, creator.id);
        winners.push(winnerId);
      }
      const final = await db.tournamentMatch.findFirstOrThrow({ where: { tournamentId: tournament.id, round: 2 } });
      await tournamentsLib.declareWinner(final.id, final.player1Id ?? winners[0], creator.id);
      return tournament;
    }

    it("drapeau actif : le dernier match enqueue la fermeture du fil, exécutée en PATCH verrouillé", async () => {
      enableCloseOnEnd();
      const tournament = await finishedBracket(true);
      expect((await db.tournament.findUniqueOrThrow({ where: { id: tournament.id } })).status).toBe("DONE");

      const slots = tournamentAnnounce.tournamentThreadCleanupSlots(tournament.id);
      expect(await slotRows(slots.archive)).toHaveLength(1);

      await settleOtherDeliveries(slots.prefix, [slots.archive, slots.delete]);
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-t1", thread_metadata: { archived: true } }));
      expect((await processOne())?.outcome).toBe("sent");
      const [url, init] = fetchMock.mock.calls.at(-1)!;
      expect(String(url)).toBe("https://discord.com/api/v10/channels/thread-t1");
      expect(JSON.parse(String(init.body))).toEqual({ archived: true, locked: true });

      const report = await cleanup.runDiscordThreadCleanup({ dryRun: false });
      expect(report.tournaments.archiveEnqueued).toEqual([]);
      expect(await slotRows(slots.archive)).toHaveLength(1);
    });

    it("drapeau éteint (défaut) : le dernier match n'enqueue aucune fermeture", async () => {
      const tournament = await finishedBracket(true);
      expect(await slotRows(tournamentAnnounce.tournamentThreadCleanupSlots(tournament.id).archive)).toHaveLength(0);
    });

    it("fil pas encore créé : rien n'est enqueue-é maintenant", async () => {
      enableCloseOnEnd();
      const tournament = await finishedBracket(false);
      expect(await slotRows(tournamentAnnounce.tournamentThreadCleanupSlots(tournament.id).archive)).toHaveLength(0);
    });

    it("fil supprimé à la main (404, code 10003) : fermeture aboutie, aucun échec bloquant", async () => {
      enableCloseOnEnd();
      const tournament = await finishedBracket(true);
      const slots = tournamentAnnounce.tournamentThreadCleanupSlots(tournament.id);
      await settleOtherDeliveries(slots.prefix, [slots.archive, slots.delete]);

      fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: "Unknown Channel", code: 10003 }));
      expect((await processOne())?.outcome).toBe("sent");
      const report = await cleanup.runDiscordThreadCleanup({ dryRun: false });
      expect(report.tournaments.archiveFailed).toEqual([]);
    });
  });
});
