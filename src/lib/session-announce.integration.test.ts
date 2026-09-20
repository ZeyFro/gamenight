import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Chantier annonces Discord bot (salons #🎮-soirées/#🏆-tournois et fils par
 * événement, après #95/#96/#97/#98) — tests combinant PostgreSQL isolé
 * (fondations de livraison + données métier réelles : Session/Proposal/
 * Vote/User/UserNotificationPreference) ET HTTP Discord entièrement
 * simulé (`fetch` mocké, JAMAIS d'appel réseau réel) — même dérogation que
 * `notification-executor.integration.test.ts`/`notification-delivery.
 * integration.test.ts` pour la partie Postgres (garanties de concurrence
 * et de dépendances non mockables).
 *
 * Nécessite `TEST_DATABASE_URL` — voir le README. Suite entièrement
 * SKIPPÉE si absente (pas de faux vert).
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) {
    return { prisma: {} as unknown };
  }
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn(
    "[session-announce.integration.test] TEST_DATABASE_URL absente — " +
      "suite SKIPPÉE. Les scénarios bout en bout (annonce → fil, " +
      "dépendances, préférences, rollback) ne sont PAS validés par cette " +
      "exécution."
  );
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe.skipIf(!TEST_DATABASE_URL)(
  "session-announce (intégration Postgres isolée + Discord HTTP simulé)",
  () => {
    let db: import("@prisma/client").PrismaClient;
    let announceLib: typeof import("./session-announce");
    let executorLib: typeof import("./notification-executor");
    let sessionsLib: typeof import("./sessions");
    let rouletteLib: typeof import("./roulette");
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
      const prismaModule = await import("@/lib/prisma");
      db = prismaModule.prisma as unknown as import("@prisma/client").PrismaClient;
      announceLib = await import("./session-announce");
      executorLib = await import("./notification-executor");
      sessionsLib = await import("./sessions");
      rouletteLib = await import("./roulette");
    });

    afterAll(async () => {
      await db.$disconnect();
    });

    beforeEach(async () => {
      // Toutes les tables touchées par cette suite, dans un ordre
      // FK-safe garanti par CASCADE — cette base de test est dédiée aux
      // suites d'intégration de ce dépôt, jamais la base de
      // développement/production. Aucune autre suite ne s'exécute en
      // parallèle (`--maxWorkers=1`, voir scripts/test-postgres.mjs).
      await db.$executeRawUnsafe(
        `TRUNCATE "NotificationDelivery", "NotificationEvent", "RouletteEntry", "Roulette", "Vote", "Proposal", "Session", "UserNotificationPreference", "Game", "User" CASCADE`
      );
      fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      vi.stubEnv("DISCORD_BOT_TOKEN", "test-bot-token");
      vi.stubEnv("DISCORD_BOT_GUILD_ID", "guild-1");
      vi.stubEnv("DISCORD_BOT_SESSION_CHANNEL_ID", "chan-sessions");
      // `DISCORD_WEBHOOK_URL` volontairement JAMAIS stubbée ici :
      // `postToDiscord` (chemin webhook legacy) doit rester un no-op sans
      // toucher `fetch`, pour que les assertions "aucun appel réseau"
      // distinguent sans ambiguïté le chemin bot du chemin webhook.
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

    async function makeUser(overrides: Partial<{ discordName: string; silenceReminders: boolean }> = {}) {
      const id = uniq("user");
      return db.user.create({
        data: {
          discordId: id,
          discordName: overrides.discordName ?? id,
          silenceReminders: overrides.silenceReminders ?? false,
        },
      });
    }

    async function makeGame(addedById: string) {
      return db.game.create({
        data: { name: uniq("game"), source: "MANUAL", addedById },
      });
    }

    async function makeSession(
      creatorId: string,
      overrides: Partial<{
        status: "VOTING" | "SCHEDULED" | "DONE" | "CANCELLED";
        announceViaBot: boolean;
        date: Date;
        votingDeadline: Date | null;
        decidedGameId: string | null;
        decidedTime: Date | null;
        notifiedUserIds: string[] | null;
      }> = {}
    ) {
      return db.session.create({
        data: {
          date: overrides.date ?? new Date("2026-10-01T20:00:00.000Z"),
          votingDeadline: overrides.votingDeadline ?? new Date("2026-09-30T20:00:00.000Z"),
          status: overrides.status ?? "VOTING",
          createdById: creatorId,
          announceViaBot: overrides.announceViaBot ?? true,
          decidedGameId: overrides.decidedGameId ?? null,
          decidedTime: overrides.decidedTime ?? null,
          notifiedUserIds: overrides.notifiedUserIds ?? undefined,
        },
      });
    }

    /** Roulette async avec ses `RouletteEntry` déjà posées (une par
     * participant) — `spinRoulette` n'exige que `status: "OPEN"`, la
     * deadline n'est vérifiée que par `spinRouletteIfDue` (jamais appelé
     * ici, on invoque directement `spinRoulette`). */
    async function makeRoulette(creatorId: string, entries: { userId: string; gameId: string }[]) {
      const roulette = await db.roulette.create({
        data: {
          createdById: creatorId,
          scheduledAt: new Date("2026-10-01T20:00:00.000Z"),
          deadline: new Date("2026-09-30T20:00:00.000Z"),
        },
      });
      await db.rouletteEntry.createMany({
        data: entries.map((e) => ({ rouletteId: roulette.id, userId: e.userId, gameId: e.gameId })),
      });
      return roulette;
    }

    async function propose(sessionId: string, gameId: string, proposedById: string) {
      return db.proposal.create({ data: { sessionId, gameId, proposedById } });
    }

    async function vote(proposalId: string, userId: string) {
      return db.vote.create({ data: { proposalId, userId } });
    }

    /** Traite UNE livraison due, avec le vrai résolveur SESSION du chantier. */
    async function processOne(now?: Date) {
      return executorLib.processNextDelivery({
        resolver: announceLib.sessionAnnounceResolver,
        owner: uniq("worker"),
        now,
      });
    }

    describe("annonce puis création de fil (parcours nominal)", () => {
      it("SEND annonce réussi, puis SEND fil réussi référençant le message d'annonce", async () => {
        const creator = await makeUser({ discordName: "createur" });
        const session = await makeSession(creator.id);
        await announceLib.enqueueSessionCreationDeliveries(session.id);

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "chan-sessions" }));
        const announceOutcome = await processOne();
        expect(announceOutcome?.outcome).toBe("sent");

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        const threadOutcome = await processOne();
        expect(threadOutcome?.outcome).toBe("sent");

        expect(fetchMock).toHaveBeenCalledTimes(2);
        const [, threadInit] = fetchMock.mock.calls[1];
        const threadBody = JSON.parse(String(threadInit.body));
        expect(String(fetchMock.mock.calls[1][0])).toContain("/channels/chan-sessions/messages/msg-announce/threads");
        expect(threadBody.name).toContain(session.id.slice(0, 8));

        const threadRow = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: `default-guild:SESSION:${session.id}:thread` },
        });
        expect(threadRow.discordThreadId).toBe("thread-1");
      });
    });

    describe("succès partiel — annonce réussie, création de fil échouée", () => {
      it("l'annonce n'est jamais renvoyée, seule la reprise du fil est retentée", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id);
        await announceLib.enqueueSessionCreationDeliveries(session.id);

        const t0 = new Date("2026-01-01T00:00:00.000Z");
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "chan-sessions" }));
        await processOne(t0);

        fetchMock.mockResolvedValueOnce(jsonResponse(500, {}));
        const failedThread = await processOne(t0);
        expect(failedThread?.outcome).toBe("retrying");

        // Reprise : seule la livraison "thread" (toujours PENDING) doit
        // être reprise — l'annonce reste SENT, jamais un second appel pour
        // elle (aucun `fetch` vers /messages en POST une 2e fois). Il faut
        // dépasser le backoff (nextAttemptAt) pour que `claimNextDelivery`
        // la considère à nouveau due — une reprise immédiate ne trouverait
        // rien, exactement comme documenté par l'exécuteur (#97).
        const muchLater = new Date(t0.getTime() + 5 * 60_000);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        const resumedThread = await processOne(muchLater);
        expect(resumedThread?.outcome).toBe("sent");

        expect(fetchMock).toHaveBeenCalledTimes(3);
        const postCalls = fetchMock.mock.calls.filter(([, init]) => init.method === "POST" && String(init.body).length > 0 === true);
        const announceRow = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: `default-guild:SESSION:${session.id}:announce` },
        });
        expect(announceRow.status).toBe("SENT");
        expect(announceRow.discordMessageId).toBe("msg-announce");
        void postCalls;
      });
    });

    describe("rappel en attente de fil — dépendance jamais épuisée", () => {
      it("dependency_not_ready retryable tant que le fil n'existe pas, aucun appel réseau tenté", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id, { status: "SCHEDULED" });
        await announceLib.enqueueSessionReminderDelivery(session.id, 60);

        const outcome = await processOne();
        expect(outcome?.outcome).toBe("retrying");
        expect(outcome).toMatchObject({ errorClass: "resolver:dependency_not_ready" });
        expect(fetchMock).not.toHaveBeenCalled();

        const row = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: `default-guild:SESSION:${session.id}:thread-reminder-60` },
        });
        expect(row.status).toBe("PENDING");
        // Une seule tentative consommée pour ce passage — jamais épuisée
        // par une dépendance qui finira par se résoudre plus tard.
        expect(row.attempts).toBe(1);
        expect(row.attempts).toBeLessThan(executorLib.MAX_DELIVERY_ATTEMPTS);
      });

      it("une fois le fil créé, le rappel en attente devient éligible et part dans le fil", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id, { status: "SCHEDULED" });
        const t0 = new Date("2026-01-01T00:00:00.000Z");
        await announceLib.enqueueSessionReminderDelivery(session.id, 60);
        await processOne(t0); // dependency_not_ready — le fil n'existe pas encore

        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "chan-sessions" }));
        await processOne(t0);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne(t0);

        // Au-delà du backoff de dépendance (2 min, DEPENDENCY_RETRY_BACKOFF_MS)
        // pour que le rappel redevienne éligible à la réclamation.
        const later = new Date(t0.getTime() + 5 * 60_000);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-reminder", channel_id: "thread-1" }));
        const reminderOutcome = await processOne(later);
        expect(reminderOutcome?.outcome).toBe("sent");
        expect(String(fetchMock.mock.calls.at(-1)![0])).toContain("/channels/thread-1/messages");
      });

      it.each([["CANCELLED"], ["DONE"]] as const)(
        "rappel devenu obsolète après %s : refus définitif (expired), jamais envoyé, jamais retenté",
        async (status) => {
          const creator = await makeUser();
          const session = await makeSession(creator.id, { status: "SCHEDULED" });
          await announceLib.enqueueSessionCreationDeliveries(session.id);
          fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "chan-sessions" }));
          await processOne();
          fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
          await processOne();

          await announceLib.enqueueSessionReminderDelivery(session.id, 60);
          // La session est annulée/clôturée APRÈS l'enqueue du rappel, AVANT
          // que l'exécuteur ne le traite — simule un rappel qui devient
          // obsolète pendant la fenêtre d'attente du cron.
          await db.session.update({ where: { id: session.id }, data: { status } });

          const outcome = await processOne();
          expect(outcome).toMatchObject({ outcome: "failed", errorClass: "resolver:expired" });
          expect(fetchMock).toHaveBeenCalledTimes(2); // announce + thread seulement, jamais le rappel

          const row = await db.notificationDelivery.findFirstOrThrow({
            where: { targetSlot: `default-guild:SESSION:${session.id}:thread-reminder-60` },
          });
          expect(row.status).toBe("FAILED");
          expect(row.nextAttemptAt).toBeNull();
        }
      );
    });

    describe("éditions concurrentes — convergence vers l'état courant", () => {
      it("deux éditions enqueue-ées à la suite : seule la plus récente est traitée, avec le contenu ACTUEL de la session", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id, {
          date: new Date("2026-10-01T20:00:00.000Z"),
        });
        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "chan-sessions" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();

        // Deux éditions successives (ex. deux modifications de créneau) —
        // la session est mise à jour à CHAQUE fois avant l'enqueue, comme
        // le ferait editSessionAction.
        await db.session.update({ where: { id: session.id }, data: { date: new Date("2026-10-02T20:00:00.000Z") } });
        await announceLib.enqueueSessionAnnounceUpdate(session.id);
        await db.session.update({ where: { id: session.id }, data: { date: new Date("2026-10-03T20:00:00.000Z") } });
        await announceLib.enqueueSessionAnnounceUpdate(session.id);

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "chan-sessions" }));
        const editOutcome = await processOne();
        expect(editOutcome?.outcome).toBe("sent");

        const [, editInit] = fetchMock.mock.calls.at(-1)!;
        const editBody = JSON.parse(String(editInit.body));
        // Rendu depuis l'état COURANT en base (3 octobre), jamais depuis
        // le premier texte enqueue (2 octobre) : la description de
        // l'embed contient la date la plus récente.
        expect(editBody.embeds[0].description).toContain("3 octobre");
        expect(editBody.embeds[0].description).not.toContain("2 octobre");

        // Plus rien à traiter : la 1ère édition (dépassée) a été SKIPPED
        // par `claimNextDelivery`, jamais vue par le résolveur.
        const secondOutcome = await processOne();
        expect(secondOutcome).toBeNull();

        const deliveries = await db.notificationDelivery.findMany({
          where: { targetSlot: `default-guild:SESSION:${session.id}:announce`, operation: "EDIT" },
        });
        expect(deliveries.filter((d) => d.status === "SKIPPED")).toHaveLength(1);
        expect(deliveries.filter((d) => d.status === "SENT")).toHaveLength(1);
      });
    });

    describe("préférences — refus personnel, annonce collective conservée", () => {
      it("un refus SESSION retire la mention/notification perso, sans jamais bloquer l'annonce collective", async () => {
        const creator = await makeUser({ discordName: "createur" });
        const declined = await makeUser({ discordName: "refuse" });
        const accepted = await makeUser({ discordName: "accepte" });
        const game = await makeGame(creator.id);
        const session = await makeSession(creator.id);
        const proposal = await propose(session.id, game.id, creator.id);
        await vote(proposal.id, declined.id);
        await vote(proposal.id, accepted.id);
        await db.userNotificationPreference.create({
          data: { userId: declined.id, category: "SESSION", enabled: false },
        });

        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "chan-sessions" }));
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");

        const [, init] = fetchMock.mock.calls[0];
        const body = JSON.parse(String(init.body));
        expect(body.content).toContain(`<@${accepted.discordId}>`);
        expect(body.content).not.toContain(`<@${declined.discordId}>`);
        expect(body.allowed_mentions.users).toEqual([accepted.discordId]);

        const notifications = await db.notification.findMany({ where: { relatedSessionId: session.id } });
        expect(notifications.map((n) => n.userId)).toEqual([accepted.id]);
      });

      it("tous refusent : l'annonce collective part quand même, sans mention ni notification interne", async () => {
        const creator = await makeUser();
        const declined = await makeUser();
        const game = await makeGame(creator.id);
        const session = await makeSession(creator.id);
        const proposal = await propose(session.id, game.id, creator.id);
        await vote(proposal.id, declined.id);
        await db.userNotificationPreference.create({
          data: { userId: declined.id, category: "SESSION", enabled: false },
        });

        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "chan-sessions" }));
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");

        const [, init] = fetchMock.mock.calls[0];
        const body = JSON.parse(String(init.body));
        expect(body.content).toBeFalsy();
        expect(await db.notification.count({ where: { relatedSessionId: session.id } })).toBe(0);
      });

      it("la sélection du créateur ne peut jamais réintégrer un refus (le filtre ne retire jamais que des destinataires)", async () => {
        const creator = await makeUser();
        const declined = await makeUser();
        const game = await makeGame(creator.id);
        const session = await makeSession(creator.id, { notifiedUserIds: [declined.id] });
        const proposal = await propose(session.id, game.id, creator.id);
        await vote(proposal.id, declined.id);
        await db.userNotificationPreference.create({
          data: { userId: declined.id, category: "SESSION", enabled: false },
        });

        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "chan-sessions" }));
        await processOne();

        const [, init] = fetchMock.mock.calls[0];
        const body = JSON.parse(String(init.body));
        expect(body.content).toBeFalsy();
      });

      it("préférence relue AU MOMENT DE L'ENVOI, jamais à l'enqueue : un refus posé APRÈS la mise en file retire quand même la mention", async () => {
        // Le contraire (préférence figée à l'enqueue) romprait exactement
        // la garantie de #98 : un utilisateur pourrait se désinscrire entre
        // la mise en file d'une annonce/d'un rappel et son traitement réel
        // par l'exécuteur (qui peut survenir bien plus tard, selon la
        // cadence du cron) et être mentionné quand même.
        const creator = await makeUser();
        const stillEnabled = await makeUser({ discordName: "encore-abonne" });
        const game = await makeGame(creator.id);
        const session = await makeSession(creator.id);
        const proposal = await propose(session.id, game.id, creator.id);
        await vote(proposal.id, stillEnabled.id);

        // Enqueue AVANT tout refus — à cet instant, `stillEnabled` est
        // encore éligible (aucune ligne de préférence, repli legacy actif).
        await announceLib.enqueueSessionCreationDeliveries(session.id);

        // Le refus arrive APRÈS l'enqueue, avant que l'exécuteur ne
        // traite la livraison — simule un utilisateur qui se désinscrit
        // pendant la fenêtre d'attente du cron.
        await db.userNotificationPreference.create({
          data: { userId: stillEnabled.id, category: "SESSION", enabled: false },
        });

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "chan-sessions" }));
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");

        const [, init] = fetchMock.mock.calls[0];
        const body = JSON.parse(String(init.body));
        expect(body.content).toBeFalsy();
        expect(body.allowed_mentions.users).toBeUndefined();
        expect(await db.notification.count({ where: { relatedSessionId: session.id } })).toBe(0);
      });
    });

    describe("configuration absente — comportement legacy conservé", () => {
      it("sans DISCORD_BOT_GUILD_ID/DISCORD_BOT_SESSION_CHANNEL_ID : not_configured terminal, aucun appel Discord", async () => {
        vi.stubEnv("DISCORD_BOT_GUILD_ID", "");
        const creator = await makeUser();
        const session = await makeSession(creator.id);
        await announceLib.enqueueSessionCreationDeliveries(session.id);

        const outcome = await processOne();
        expect(outcome).toEqual({
          deliveryId: (await db.notificationDelivery.findFirstOrThrow({
            where: { targetSlot: `default-guild:SESSION:${session.id}:announce` },
          })).id,
          outcome: "failed",
          errorClass: "resolver:not_configured",
        });
        expect(fetchMock).not.toHaveBeenCalled();
      });
    });

    describe("route cron — dispatch réel par catégorie", () => {
      it("catégorie SESSION activée (config + NOTIFICATION_EXECUTOR_ENABLED) : envoie via le résolveur du chantier, une seule fois", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id);
        await announceLib.enqueueSessionCreationDeliveries(session.id);

        vi.stubEnv("CRON_SECRET", "s3cret");
        vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "chan-sessions" }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));

        const { GET } = await import("@/app/api/cron/notification-executor/route");
        const res = await GET(
          new Request("http://localhost/api/cron/notification-executor", { headers: { authorization: "Bearer s3cret" } })
        );
        const body = await res.json();
        expect(body.sent).toBe(2);
        expect(body.failed).toBe(0);
        expect(fetchMock).toHaveBeenCalledTimes(2);
      });

      it("catégorie TOURNAMENT sans configuration de salon dédiée : not_configured, jamais un appel Discord (résolveur du chantier tournois désormais branché, voir tournament-announce.integration.test.ts pour son propre chemin nominal)", async () => {
        // Depuis le chantier annonces tournois (étend #99), TOURNAMENT est
        // dispatché vers `tournamentAnnounceResolver` (tournament-announce.ts),
        // PLUS `NOT_CONFIGURED_RESOLVER` — cette suite ne stubbe cependant
        // aucune configuration `DISCORD_BOT_TOURNAMENT_CHANNEL_ID`, donc le
        // résultat final reste identique (`resolver:not_configured`) : ce
        // test vérifie seulement la non-régression de ce cas précis pour
        // SESSION, pas le chemin nominal TOURNAMENT (couvert par sa propre
        // suite dédiée).
        const deliveryLib = await import("./notification-delivery");
        const event = await deliveryLib.createNotificationEvent({
          category: "TOURNAMENT",
          eventType: "TOURNAMENT_CREATED",
          sourceId: "tournament-1",
        });
        await deliveryLib.enqueueDelivery({
          eventId: event.id,
          channel: "DISCORD_CHANNEL",
          transport: "BOT",
          operation: "SEND",
          recipientKey: "guild:category:TOURNAMENT",
          targetSlot: "default-guild:TOURNAMENT:tournament-1:announce",
        });

        vi.stubEnv("CRON_SECRET", "s3cret");
        vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
        const { GET } = await import("@/app/api/cron/notification-executor/route");
        const res = await GET(
          new Request("http://localhost/api/cron/notification-executor", { headers: { authorization: "Bearer s3cret" } })
        );
        const body = await res.json();
        expect(body.failed).toBe(1);
        expect(fetchMock).not.toHaveBeenCalled();

        const row = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: "default-guild:TOURNAMENT:tournament-1:announce" },
        });
        expect(row.errorClass).toBe("resolver:not_configured");
      });
    });

    describe("erreurs Discord — permission refusée, message supprimé, réseau incertain", () => {
      it("permission refusée (403) sur le SEND initial : FAILED terminal, jamais réessayé", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id);
        await announceLib.enqueueSessionCreationDeliveries(session.id);

        fetchMock.mockResolvedValueOnce(jsonResponse(403, { code: 50013, message: "Missing Permissions" }));
        const outcome = await processOne();
        expect(outcome).toMatchObject({ outcome: "failed", errorClass: "discord:auth_or_permission" });

        const row = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: `default-guild:SESSION:${session.id}:announce` },
        });
        expect(row.status).toBe("FAILED");
        expect(row.nextAttemptAt).toBeNull();
      });

      it("message d'annonce supprimé manuellement (404 sur l'EDIT) : FAILED terminal, observable, jamais republié ni renvoyé au webhook", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id);
        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "chan-sessions" }));
        await processOne();
        // La livraison "thread" enqueue-ée par `enqueueSessionCreationDeliveries`
        // reste sinon due elle aussi — la traiter d'abord isole l'EDIT
        // ci-dessous comme SEULE livraison encore en attente.
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();

        await db.session.update({ where: { id: session.id }, data: { date: new Date("2026-10-05T20:00:00.000Z") } });
        await announceLib.enqueueSessionAnnounceUpdate(session.id);

        // Message supprimé côté Discord entre-temps — l'EDIT échoue en 404.
        fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: "Unknown Message" }));
        const editOutcome = await processOne();
        expect(editOutcome).toMatchObject({ outcome: "failed", errorClass: "discord:not_found" });

        const row = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: `default-guild:SESSION:${session.id}:announce`, operation: "EDIT" },
        });
        // Observable (statut + errorClass en base, aucun secret exposé) —
        // jamais de republication automatique d'un nouveau message.
        expect(row.status).toBe("FAILED");
        expect(row.errorClass).toBe("discord:not_found");
        expect(fetchMock).toHaveBeenCalledTimes(3);
      });

      it("résultat réseau incertain (fetch rejette) sur le SEND initial : retryable, un seul appel tenté", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id);
        await announceLib.enqueueSessionCreationDeliveries(session.id);

        fetchMock.mockRejectedValueOnce(new DOMException("aborted", "TimeoutError"));
        const outcome = await processOne();
        expect(outcome).toMatchObject({ outcome: "retrying", errorClass: "discord:network_uncertain" });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const row = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: `default-guild:SESSION:${session.id}:announce` },
        });
        expect(row.status).toBe("PENDING");
      });
    });

    describe("atomicité — mutation métier et intention de notification", () => {
      it("un échec APRÈS l'enqueue mais AVANT le commit annule la session ET l'enqueue ensemble (même transaction)", async () => {
        const creator = await makeUser();
        let sessionId: string | undefined;

        await expect(
          db.$transaction(async (tx) => {
            const created = await tx.session.create({
              data: {
                date: new Date("2026-10-01T20:00:00.000Z"),
                votingDeadline: new Date("2026-09-30T20:00:00.000Z"),
                createdById: creator.id,
                announceViaBot: true,
              },
            });
            sessionId = created.id;
            await announceLib.enqueueSessionCreationDeliveries(created.id, tx);
            // Simule un crash/une erreur inattendue entre l'enqueue et le
            // commit — reproduit le scénario identifié lors de la revue
            // ciblée : sans transaction partagée, la session existerait
            // déjà en base à cet instant (premier `await` déjà validé)
            // pendant que l'enqueue serait encore en vol.
            throw new Error("panne simulée avant commit");
          })
        ).rejects.toThrow("panne simulée avant commit");

        expect(sessionId).toBeDefined();
        expect(await db.session.count({ where: { id: sessionId } })).toBe(0);
        expect(await db.notificationEvent.count({ where: { sourceId: sessionId } })).toBe(0);
        expect(await db.notificationDelivery.count()).toBe(0);
      });

      it("succès : session ET intention de notification committées ensemble, immédiatement traitables par l'exécuteur", async () => {
        const creator = await makeUser();

        const session = await db.$transaction(async (tx) => {
          const created = await tx.session.create({
            data: {
              date: new Date("2026-10-01T20:00:00.000Z"),
              votingDeadline: new Date("2026-09-30T20:00:00.000Z"),
              createdById: creator.id,
              announceViaBot: true,
            },
          });
          await announceLib.enqueueSessionCreationDeliveries(created.id, tx);
          return created;
        });

        expect(await db.notificationEvent.count({ where: { sourceId: session.id } })).toBe(1);
        expect(
          await db.notificationDelivery.count({ where: { targetSlot: { startsWith: `default-guild:SESSION:${session.id}:` } } })
        ).toBe(2);

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "chan-sessions" }));
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");
      });
    });

    describe("atomicité — modification, annulation, clôture (revue ciblée #99, suite)", () => {
      afterEach(() => {
        vi.restoreAllMocks();
      });

      it("modification (updateSessionSchedule) : un échec d'enqueue annule aussi la mise à jour du créneau", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id, {
          announceViaBot: true,
          date: new Date("2026-10-01T20:00:00.000Z"),
        });
        vi.spyOn(announceLib, "enqueueSessionAnnounceUpdate").mockRejectedValueOnce(new Error("panne enqueue"));

        await expect(
          sessionsLib.updateSessionSchedule(
            session.id,
            { date: new Date("2026-10-05T20:00:00.000Z"), votingDeadline: null },
            true
          )
        ).rejects.toThrow("panne enqueue");

        const stored = await db.session.findUniqueOrThrow({ where: { id: session.id } });
        // Le créneau n'a PAS bougé — la mutation a été annulée avec l'enqueue.
        expect(stored.date.toISOString()).toBe(new Date("2026-10-01T20:00:00.000Z").toISOString());
        expect(await db.notificationEvent.count({ where: { sourceId: session.id } })).toBe(0);
      });

      it("annulation (cancelSession) : un échec d'enqueue annule aussi le passage à CANCELLED", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id, { announceViaBot: true, status: "VOTING" });
        vi.spyOn(announceLib, "enqueueSessionAnnounceUpdate").mockRejectedValueOnce(new Error("panne enqueue"));

        await expect(sessionsLib.cancelSession(session.id)).rejects.toThrow("panne enqueue");

        const stored = await db.session.findUniqueOrThrow({ where: { id: session.id } });
        expect(stored.status).toBe("VOTING");
        expect(await db.notificationEvent.count({ where: { sourceId: session.id } })).toBe(0);
      });

      it("clôture avec gagnant décidé (closeSession) : un échec d'enqueue annule aussi le passage à SCHEDULED", async () => {
        const creator = await makeUser();
        const voter = await makeUser();
        // minPlayers: 1 — un seul voteur dispo-possesseur suffit à rendre
        // la proposition jouable (le repli par défaut de
        // `getProposalAvailability` est 2 si non renseigné).
        const game = await db.game.create({
          data: { name: uniq("game"), source: "MANUAL", addedById: creator.id, minPlayers: 1 },
        });
        const session = await makeSession(creator.id, { announceViaBot: true, status: "VOTING" });
        const proposal = await propose(session.id, game.id, creator.id);
        await vote(proposal.id, voter.id);
        await db.userGame.create({ data: { userId: voter.id, gameId: game.id, owned: true } });
        // Rend le voteur "disponible" à la date de la session (sinon
        // aucune proposition n'est jouable et la clôture prendrait la
        // branche "annulée" au lieu de la branche "gagnant décidé" testée
        // ici) — override sans horaire = disponible toute la journée.
        await db.availabilityOverride.create({
          data: { userId: voter.id, date: new Date("2026-10-01"), available: true },
        });

        vi.spyOn(announceLib, "enqueueSessionAnnounceUpdate").mockRejectedValueOnce(new Error("panne enqueue"));

        await expect(sessionsLib.closeSession(session.id)).rejects.toThrow("panne enqueue");

        const stored = await db.session.findUniqueOrThrow({ where: { id: session.id } });
        // La clôture n'a PAS eu lieu — toujours VOTING, jamais SCHEDULED,
        // jamais decidedGameId posé, exactement comme si `closeSession`
        // n'avait jamais été appelée.
        expect(stored.status).toBe("VOTING");
        expect(stored.decidedGameId).toBeNull();
        expect(await db.notificationEvent.count({ where: { sourceId: session.id } })).toBe(0);
      });

      it("clôture sans proposition jouable (closeAsCancelled) : un échec d'enqueue annule aussi le passage à CANCELLED", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id, { announceViaBot: true, status: "VOTING" });
        // Aucune proposition — branche "proposals.length === 0".
        vi.spyOn(announceLib, "enqueueSessionAnnounceUpdate").mockRejectedValueOnce(new Error("panne enqueue"));

        await expect(sessionsLib.closeSession(session.id)).rejects.toThrow("panne enqueue");

        const stored = await db.session.findUniqueOrThrow({ where: { id: session.id } });
        expect(stored.status).toBe("VOTING");
        expect(await db.notificationEvent.count({ where: { sourceId: session.id } })).toBe(0);
      });

      it("répétition après échec : ré-appeler la même opération après une panne résolue ne crée jamais de livraison en double", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id, { announceViaBot: true, status: "VOTING" });

        vi.spyOn(announceLib, "enqueueSessionAnnounceUpdate").mockRejectedValueOnce(new Error("panne transitoire"));
        await expect(sessionsLib.cancelSession(session.id)).rejects.toThrow("panne transitoire");

        // Rien n'a été créé (rollback) — un appelant qui retente après la
        // panne (ex. l'utilisateur reclique) doit retrouver un état propre,
        // jamais une livraison fantôme de la tentative échouée.
        expect(await db.notificationEvent.count({ where: { sourceId: session.id } })).toBe(0);

        // La panne est résolue (spy restauré) — nouvelle tentative, cette
        // fois sans injection d'échec.
        vi.restoreAllMocks();
        await sessionsLib.cancelSession(session.id);

        const stored = await db.session.findUniqueOrThrow({ where: { id: session.id } });
        expect(stored.status).toBe("CANCELLED");
        // UNE seule EDIT enqueue-ée au total — la tentative annulée n'a
        // laissé aucune trace, la tentative réussie n'en a créé qu'une.
        const deliveries = await db.notificationDelivery.findMany({
          where: { targetSlot: `default-guild:SESSION:${session.id}:announce`, operation: "EDIT" },
        });
        expect(deliveries).toHaveLength(1);
      });

      it("répétition de l'enqueue de création (occurrence fixe) : deux appels identiques ne créent jamais de livraison en double", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id, { announceViaBot: true });

        // Simule un retry applicatif (ex. deux clics, ou une reprise après
        // un crash situé APRÈS le commit mais avant que l'appelant ne le
        // sache) — l'idempotence vient de l'occurrence FIXE (#95), pas
        // d'une protection ajoutée ici.
        await announceLib.enqueueSessionCreationDeliveries(session.id);
        await announceLib.enqueueSessionCreationDeliveries(session.id);

        expect(await db.notificationEvent.count({ where: { sourceId: session.id } })).toBe(1);
        expect(
          await db.notificationDelivery.count({
            where: { targetSlot: { startsWith: `default-guild:SESSION:${session.id}:` } },
          })
        ).toBe(2);
      });
    });

    describe("bascule webhook/bot — figée à la création, jamais relue depuis l'env", () => {
      it("session créée AVANT le switch (announceViaBot=false) : reste sur le chemin webhook même une fois le bot activé", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id, { announceViaBot: false });

        // Le bot est maintenant pleinement configuré ET activé au niveau
        // catégorie — mais cette session a été créée AVANT, sa décision
        // reste figée sur `false` (jamais relue depuis l'env).
        vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "true");

        await sessionsLib.cancelSession(session.id);

        expect(await db.notificationEvent.count()).toBe(0);
        expect(await db.notificationDelivery.count()).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("session créée APRÈS le switch (announceViaBot=true) : reste sur le chemin bot même après un rollback de l'env", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id, { announceViaBot: true });

        // Rollback simulé : la catégorie est de nouveau désactivée — mais
        // cette session, déjà sur le chemin bot, continue de l'être (sa
        // décision ne dépend que de la colonne persistée).
        vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "false");

        await sessionsLib.cancelSession(session.id);

        expect(await db.notificationEvent.count({ where: { sourceId: session.id } })).toBe(1);
        const delivery = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: `default-guild:SESSION:${session.id}:announce` },
        });
        expect(delivery.operation).toBe("EDIT");

        // Aucun appel Discord ici : seul un ENQUEUE a eu lieu (l'exécuteur
        // n'a pas tourné) — démontre que la bascule ne dépend que de la
        // donnée persistée, pas de l'état actuel de la configuration.
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("rollback du SEUL flag catégorie (config + exécuteur intacts) : n'affecte QUE les nouvelles soirées — une livraison déjà en attente se traite normalement jusqu'à SENT", async () => {
        // Distingue précisément CE rollback (DISCORD_BOT_SESSION_ANNOUNCE_ENABLED
        // seul) des deux autres testés plus bas : `sessionAnnounceResolver`
        // (session-announce.ts) ne consulte JAMAIS ce flag catégorie, SEULEMENT
        // `getSessionAnnounceConfig()` (guildId/channelId) — le flag n'est lu
        // qu'UNE fois, à la création d'une session (`isSessionAnnounceViaBotEnabled()`
        // dans createSession), jamais ensuite. Le désactiver ne bloque donc que
        // les FUTURES sessions (qui recevront `announceViaBot=false`) ; une
        // livraison déjà en file pour une session déjà bot continue son cycle
        // normal — SEND, thread, rappels, éditions — tant que la config Discord
        // et l'exécuteur restent opérationnels.
        const creator = await makeUser();
        const session = await makeSession(creator.id, { announceViaBot: true });
        await announceLib.enqueueSessionCreationDeliveries(session.id);

        vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "false");

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "chan-sessions" }));
        const announceOutcome = await processOne();
        expect(announceOutcome?.outcome).toBe("sent");

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        const threadOutcome = await processOne();
        expect(threadOutcome?.outcome).toBe("sent");

        // Une édition ultérieure (ex. clôture) sur cette même session
        // continue elle aussi d'utiliser le chemin bot, sans accroc.
        await db.session.update({ where: { id: session.id }, data: { status: "CANCELLED" } });
        await announceLib.enqueueSessionAnnounceUpdate(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "chan-sessions" }));
        const editOutcome = await processOne();
        expect(editOutcome?.outcome).toBe("sent");
      });

      it("exécuteur désactivé (NOTIFICATION_EXECUTOR_ENABLED=false) : la livraison reste intouchée (PENDING, 0 tentative), entièrement récupérable dès la réactivation", async () => {
        // Distinct du cas précédent (flag catégorie) ET du suivant (config
        // retirée) : ici, RIEN n'est réellement tenté — la route s'arrête
        // avant même de réclamer quoi que ce soit (voir
        // `/api/cron/notification-executor/route.ts`), donc aucune tentative
        // n'est consommée et aucun backoff n'est posé. C'est la SEULE des
        // trois bascules qui garantit une reprise plus tard identique en
        // tout point à l'état avant la panne (pas seulement "pas perdu",
        // littéralement inchangé).
        const creator = await makeUser();
        const session = await makeSession(creator.id, { announceViaBot: true });
        await announceLib.enqueueSessionCreationDeliveries(session.id);

        vi.stubEnv("CRON_SECRET", "s3cret");
        vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "false");
        const { GET } = await import("@/app/api/cron/notification-executor/route");
        const res = await GET(
          new Request("http://localhost/api/cron/notification-executor", { headers: { authorization: "Bearer s3cret" } })
        );
        const body = await res.json();
        expect(body).toEqual({ enabled: false, processed: 0 });
        expect(fetchMock).not.toHaveBeenCalled();

        const row = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: `default-guild:SESSION:${session.id}:announce` },
        });
        expect(row.status).toBe("PENDING");
        expect(row.attempts).toBe(0);
        expect(row.nextAttemptAt).toBeNull();
      });

      it("rollback AVEC config Discord retirée pendant qu'une livraison bot est encore en attente : échoue en not_configured, observable, jamais un second envoi silencieux", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id, { announceViaBot: true });
        await announceLib.enqueueSessionCreationDeliveries(session.id);

        // Rollback complet : la config elle-même disparaît (pas seulement
        // le flag catégorie) — limite assumée et documentée : une
        // livraison DÉJÀ en attente au moment du rollback échoue en
        // terminal (jamais retentée indéfiniment), elle ne reprendra pas
        // automatiquement si la config est restaurée plus tard. Aucun
        // repli automatique vers le webhook n'est tenté (comportement
        // hérité de `notification-executor.ts`, jamais réimplémenté ici).
        vi.stubEnv("DISCORD_BOT_GUILD_ID", "");
        vi.stubEnv("DISCORD_BOT_SESSION_CHANNEL_ID", "");

        const outcome = await processOne();
        expect(outcome).toMatchObject({ outcome: "failed", errorClass: "resolver:not_configured" });
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("le renvoi manuel (bonus F6, toujours un NOUVEAU message webhook) refuse explicitement une session bot plutôt que de republier l'annonce persistante", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id, { announceViaBot: true });

        const result = await sessionsLib.resendSessionAnnouncement(session.id);
        expect(result).toEqual({ ok: false, error: "non_disponible_pour_les_sessions_bot" });
        expect(fetchMock).not.toHaveBeenCalled();
      });
    });

    describe("sessions Roulette — honorent enfin announceViaBot (bug remonté en production)", () => {
      it("bot activé : spinRoulette enqueue une livraison bot, n'appelle JAMAIS le webhook, et le SEND rend l'état déjà décidé avec la bonne notification interne", async () => {
        const creator = await makeUser();
        const p1 = await makeUser({ discordName: "p1" });
        const p2 = await makeUser({ discordName: "p2" });
        const game = await makeGame(creator.id);
        const roulette = await makeRoulette(creator.id, [
          { userId: p1.id, gameId: game.id },
          { userId: p2.id, gameId: game.id },
        ]);

        vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "true");
        await rouletteLib.spinRoulette(roulette.id);

        // Aucun appel réseau à la création — ni webhook (announceViaBot
        // vrai, jamais appelé), ni bot (l'enqueue ne fait qu'écrire, voir
        // le commentaire de fichier de notification-delivery.ts).
        expect(fetchMock).not.toHaveBeenCalled();

        const stored = await db.session.findFirstOrThrow({ where: { createdViaRoulette: true } });
        expect(stored.announceViaBot).toBe(true);
        expect(stored.status).toBe("SCHEDULED");
        expect(stored.decidedGameId).toBe(game.id);
        expect(
          await db.notificationEvent.count({ where: { sourceId: stored.id, eventType: "SESSION_CREATED" } })
        ).toBe(1);

        // Traite le SEND réel — doit rendre l'état "validée" (pas
        // "nouvelle soirée à voter", cette session n'a jamais été VOTING)
        // ET la notification interne assortie doit porter le bon
        // type/titre (bug corrigé : `resolveSendNotificationMeta`).
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-1", channel_id: "chan-sessions" }));
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");

        const [, init] = fetchMock.mock.calls[0];
        const body = JSON.parse(String(init.body));
        expect(body.embeds[0].title).toContain(`Soirée validée : ${game.name}`);

        const notifications = await db.notification.findMany({ where: { relatedSessionId: stored.id } });
        expect(notifications.length).toBeGreaterThan(0);
        expect(notifications.every((n) => n.type === "SESSION_RESULT")).toBe(true);
        expect(notifications.some((n) => n.title.includes("Nouvelle soirée"))).toBe(false);
      });

      it("bot désactivé (regression) : spinRoulette garde le comportement historique — webhook appelé, aucune livraison bot", async () => {
        const creator = await makeUser();
        const p1 = await makeUser();
        const p2 = await makeUser();
        const game = await makeGame(creator.id);
        const roulette = await makeRoulette(creator.id, [
          { userId: p1.id, gameId: game.id },
          { userId: p2.id, gameId: game.id },
        ]);

        vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "false");
        // Stub LOCALE au webhook (jamais stubbée globalement dans cette
        // suite, voir le commentaire de `beforeEach`) — nécessaire ici
        // pour prouver un VRAI appel réseau webhook plutôt que le simple
        // repli silencieux "not_configured" de `postToDiscord` sans lui.
        vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/test/token");
        fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));

        await rouletteLib.spinRoulette(roulette.id);

        expect(fetchMock).toHaveBeenCalledTimes(1); // le webhook, jamais le bot
        const stored = await db.session.findFirstOrThrow({ where: { createdViaRoulette: true } });
        expect(stored.announceViaBot).toBe(false);
        expect(await db.notificationEvent.count({ where: { sourceId: stored.id } })).toBe(0);
      });
    });
  }
);
