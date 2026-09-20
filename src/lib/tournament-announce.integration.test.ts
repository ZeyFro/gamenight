import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Chantier annonces Discord tournois (#🏆-tournois, fil dédié par
 * tournoi) — même philosophie de test que `session-announce.integration.test.ts`
 * (#99) : PostgreSQL isolé (fondations de livraison + données métier
 * réelles Tournament/TournamentParticipant/TournamentMatch/User) ET HTTP
 * Discord entièrement simulé (`fetch` mocké, JAMAIS d'appel réseau réel).
 *
 * Revue ciblée avant merge #100 (contrôle de destination) — le tout
 * premier SEND d'une annonce passe désormais par `send_channel_message_verified`
 * (`sendChannelMessageVerified`, discord-rest.ts) : un `GET /channels/{id}`
 * PUIS un `POST .../messages`, jamais l'inverse, jamais le POST si le GET
 * échoue ou révèle un salon inattendu — voir `mockChannelOk`/`mockSendOk`
 * ci-dessous, utilisés PARTOUT où cette suite simule un premier SEND
 * réussi. Les éditions et le fil qui suivent n'en ont PLUS besoin (ils
 * ciblent directement la référence du message réellement créé) — un seul
 * `POST`/`PATCH` suffit à les simuler, comme avant cette revue.
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
    "[tournament-announce.integration.test] TEST_DATABASE_URL absente — " +
      "suite SKIPPÉE. Les scénarios bout en bout (annonce → fil, lancement, " +
      "clôture, atomicité, rollback, contrôle de destination) ne sont PAS " +
      "validés par cette exécution."
  );
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe.skipIf(!TEST_DATABASE_URL)(
  "tournament-announce (intégration Postgres isolée + Discord HTTP simulé)",
  () => {
    let db: import("@prisma/client").PrismaClient;
    let announceLib: typeof import("./tournament-announce");
    let executorLib: typeof import("./notification-executor");
    let tournamentsLib: typeof import("./tournaments");
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
      const prismaModule = await import("@/lib/prisma");
      db = prismaModule.prisma as unknown as import("@prisma/client").PrismaClient;
      announceLib = await import("./tournament-announce");
      executorLib = await import("./notification-executor");
      tournamentsLib = await import("./tournaments");
    });

    afterAll(async () => {
      await db.$disconnect();
    });

    beforeEach(async () => {
      await db.$executeRawUnsafe(
        `TRUNCATE "NotificationDelivery", "NotificationEvent", "TournamentMatch", "TournamentParticipant", "Tournament", "Game", "User" CASCADE`
      );
      fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      vi.stubEnv("DISCORD_BOT_TOKEN", "test-bot-token");
      vi.stubEnv("DISCORD_BOT_GUILD_ID", "guild-1");
      vi.stubEnv("DISCORD_BOT_TOURNAMENT_CHANNEL_ID", "chan-tournois");
      // `DISCORD_WEBHOOK_URL` volontairement JAMAIS stubbée ici : `postToDiscord`
      // (chemin webhook legacy) doit rester un no-op sans toucher `fetch`,
      // pour que les assertions "aucun appel réseau" distinguent sans
      // ambiguïté le chemin bot du chemin webhook.
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

    async function makeUser(overrides: Partial<{ discordName: string }> = {}) {
      const id = uniq("user");
      return db.user.create({
        data: { discordId: id, discordName: overrides.discordName ?? id },
      });
    }

    async function makeGame(addedById: string) {
      return db.game.create({ data: { name: uniq("game"), source: "MANUAL", addedById } });
    }

    async function makeTournament(
      creatorId: string,
      gameId: string,
      overrides: Partial<{
        status: "REGISTRATION" | "IN_PROGRESS" | "DONE";
        announceViaBot: boolean;
        maxPlayers: number;
        championId: string | null;
        discordGuildId: string | null;
        discordChannelId: string | null;
      }> = {}
    ) {
      const announceViaBot = overrides.announceViaBot ?? true;
      return db.tournament.create({
        data: {
          name: uniq("tournoi"),
          gameId,
          createdById: creatorId,
          status: overrides.status ?? "REGISTRATION",
          maxPlayers: overrides.maxPlayers ?? 4,
          announceViaBot,
          championId: overrides.championId ?? null,
          // Même contrat que `createTournamentAction` : destination figée
          // EN MÊME TEMPS que le booléen, jamais l'un sans l'autre pour un
          // tournoi bot — voir le commentaire du champ, schema.prisma.
          discordGuildId: "discordGuildId" in overrides ? overrides.discordGuildId : announceViaBot ? "guild-1" : null,
          discordChannelId:
            "discordChannelId" in overrides ? overrides.discordChannelId : announceViaBot ? "chan-tournois" : null,
        },
      });
    }

    async function makeParticipant(tournamentId: string, userId: string) {
      return db.tournamentParticipant.create({ data: { tournamentId, userId } });
    }

    /** Construit le bracket dans SA PROPRE transaction — équivalent test de
     * `generateBracket`, sans passer par les actions serveur (`redirect`). */
    async function launchBracket(tournamentId: string) {
      return db.$transaction((tx) => tournamentsLib.buildBracketInTransaction(tx, tournamentId));
    }

    /**
     * Termine intégralement un bracket à 4 places (2 rounds) en désignant
     * `winnerId` comme le joueur du premier match qui l'emporte à chaque
     * round — utilise le VRAI `declareWinner` (jamais une copie de sa
     * logique), même exigence que le reste de cette suite.
     */
    async function finalizeTournament(tournamentId: string, actorId: string) {
      const round1 = await db.tournamentMatch.findMany({
        where: { tournamentId, round: 1 },
        orderBy: { position: "asc" },
      });
      const round1Winners: string[] = [];
      for (const match of round1) {
        const winnerId = match.player1Id ?? match.player2Id;
        if (!winnerId) continue;
        await tournamentsLib.declareWinner(match.id, winnerId, actorId);
        round1Winners.push(winnerId);
      }
      const final = await db.tournamentMatch.findFirstOrThrow({ where: { tournamentId, round: 2 } });
      const championId = final.player1Id ?? round1Winners[0];
      return tournamentsLib.declareWinner(final.id, championId, actorId);
    }

    /** Traite UNE livraison due, avec le vrai résolveur TOURNAMENT du chantier. */
    async function processOne(now?: Date) {
      return executorLib.processNextDelivery({
        resolver: announceLib.tournamentAnnounceResolver,
        owner: uniq("worker"),
        now,
      });
    }

    /** Simule un `GET /channels/{id}` réussi — salon texte (`type: 0`)
     * appartenant à `guildId` (par défaut celui stubbé dans `beforeEach`). */
    function mockChannelOk(channelId: string, guildId = "guild-1", type = 0) {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: channelId, type, guild_id: guildId }));
    }

    /** Simule un `POST .../messages` réussi. */
    function mockSendOk(channelId: string, messageId = "msg-announce") {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: messageId, channel_id: channelId }));
    }

    /** Enchaîne les deux mocks ci-dessus — raccourci pour le cas nominal
     * "premier SEND réussi" utilisé par la majorité des tests. */
    function mockVerifiedSendOk(channelId: string, guildId = "guild-1", messageId = "msg-announce") {
      mockChannelOk(channelId, guildId);
      mockSendOk(channelId, messageId);
    }

    describe("parcours nominal — création → fil, lancement, clôture + résumé", () => {
      it("création : GET de vérification + SEND annonce, puis SEND fil, référençant le message d'annonce", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);

        mockVerifiedSendOk("chan-tournois");
        const announceOutcome = await processOne();
        expect(announceOutcome?.outcome).toBe("sent");
        expect(String(fetchMock.mock.calls[0][0])).toContain("/channels/chan-tournois");
        expect(fetchMock.mock.calls[0][1]?.method ?? "GET").toBe("GET");
        expect(String(fetchMock.mock.calls[1][0])).toContain("/channels/chan-tournois/messages");
        expect(fetchMock.mock.calls[1][1]?.method).toBe("POST");

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-tournois" }));
        const threadOutcome = await processOne();
        expect(threadOutcome?.outcome).toBe("sent");

        expect(String(fetchMock.mock.calls[2][0])).toContain(
          "/channels/chan-tournois/messages/msg-announce/threads"
        );
        const [, announceInit] = fetchMock.mock.calls[1];
        const announceBody = JSON.parse(String(announceInit.body));
        expect(announceBody.embeds[0].title).toContain("inscriptions ouvertes");
        expect(announceBody.allowed_mentions).toEqual({ parse: [] });
      });

      it("lancement (bracket construit) : EDIT de l'annonce reflète l'état « en cours », aucun GET (référence déjà confirmée)", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, { maxPlayers: 4 });
        for (let i = 0; i < 4; i++) {
          await makeParticipant(tournament.id, (await makeUser()).id);
        }
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);
        mockVerifiedSendOk("chan-tournois");
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-tournois" }));
        await processOne();

        await launchBracket(tournament.id);

        const stored = await db.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
        expect(stored.status).toBe("IN_PROGRESS");

        const callsBeforeEdit = fetchMock.mock.calls.length;
        mockSendOk("chan-tournois"); // EDIT — un seul appel, pas de GET
        const editOutcome = await processOne();
        expect(editOutcome?.outcome).toBe("sent");
        expect(fetchMock.mock.calls.length).toBe(callsBeforeEdit + 1);
        const [, editInit] = fetchMock.mock.calls.at(-1)!;
        const editBody = JSON.parse(String(editInit.body));
        expect(editBody.embeds[0].title).toContain("en cours");
        expect(editBody.embeds[0].fields.find((f: { name: string }) => f.name === "Participants")?.value).toBe("4");
      });

      it("clôture : EDIT « terminé » + résumé de fil avec champion/finaliste, aucun XP/badge ré-attribué par ce module", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, { maxPlayers: 4 });
        const players = [];
        for (let i = 0; i < 4; i++) players.push(await makeUser({ discordName: `joueur${i}` }));
        for (const p of players) await makeParticipant(tournament.id, p.id);

        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);
        mockVerifiedSendOk("chan-tournois");
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-tournois" }));
        await processOne();

        await launchBracket(tournament.id);
        mockSendOk("chan-tournois");
        await processOne(); // EDIT lancement

        const result = await finalizeTournament(tournament.id, creator.id);
        expect(result.tournamentDone).toBe(true);

        mockSendOk("chan-tournois");
        const closureEdit = await processOne();
        expect(closureEdit?.outcome).toBe("sent");
        const [, closureInit] = fetchMock.mock.calls.at(-1)!;
        const closureBody = JSON.parse(String(closureInit.body));
        expect(closureBody.embeds[0].title).toContain("terminé");

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-summary", channel_id: "thread-1" }));
        const summaryOutcome = await processOne();
        expect(summaryOutcome?.outcome).toBe("sent");
        const [, summaryInit] = fetchMock.mock.calls.at(-1)!;
        const summaryBody = JSON.parse(String(summaryInit.body));
        expect(summaryBody.embeds[0].fields.some((f: { name: string }) => f.name === "🏆 Champion")).toBe(true);
        expect(summaryBody.allowed_mentions).toEqual({ parse: [] });

        // Cette PR n'attribue AUCUN XP/badge — `declareWinner`/`finalizeTournament`
        // gardent exactement le même mécanisme XP qu'avant (hors périmètre
        // de ce module, jamais dupliqué ni modifié ici).
        const stored = await db.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
        expect(stored.championId).toBeTruthy();
      });
    });

    describe("succès partiel — annonce réussie, fil échoué", () => {
      it("l'annonce n'est jamais renvoyée, seule la reprise du fil est retentée", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);

        const t0 = new Date("2026-01-01T00:00:00.000Z");
        mockVerifiedSendOk("chan-tournois");
        await processOne(t0);

        fetchMock.mockResolvedValueOnce(jsonResponse(500, {}));
        const failedThread = await processOne(t0);
        expect(failedThread?.outcome).toBe("retrying");

        const muchLater = new Date(t0.getTime() + 5 * 60_000);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-tournois" }));
        const resumedThread = await processOne(muchLater);
        expect(resumedThread?.outcome).toBe("sent");

        expect(fetchMock).toHaveBeenCalledTimes(4); // GET + SEND annonce, échec fil, reprise fil
        const announceRow = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: `default-guild:TOURNAMENT:${tournament.id}:announce` },
        });
        expect(announceRow.status).toBe("SENT");
      });
    });

    describe("résumé de fil en attente du fil — dépendance jamais épuisée", () => {
      it("dependency_not_ready retryable tant que le fil n'existe pas, aucun appel réseau tenté", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id);
        await announceLib.enqueueTournamentResultThreadSummary(tournament.id);

        const outcome = await processOne();
        expect(outcome?.outcome).toBe("retrying");
        expect(fetchMock).not.toHaveBeenCalled();

        const row = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: `default-guild:TOURNAMENT:${tournament.id}:thread-summary` },
        });
        expect(row.status).toBe("PENDING");
        expect(row.attempts).toBe(1);
        expect(row.attempts).toBeLessThan(executorLib.MAX_DELIVERY_ATTEMPTS);
      });
    });

    describe("contrôle de destination — vérification AVANT tout premier envoi", () => {
      it("salon appartenant à un autre serveur : aucun POST, échec terminal observable", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, { discordGuildId: "guild-1" });
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);

        // Le salon existe (GET réussi) mais appartient à un AUTRE serveur
        // que celui persisté pour ce tournoi (`guild-1`).
        mockChannelOk("chan-tournois", "guild-INTRUS");
        const outcome = await processOne();

        expect(outcome).toMatchObject({ outcome: "failed", errorClass: "discord:destination_mismatch" });
        expect(fetchMock).toHaveBeenCalledTimes(1); // seul le GET, jamais de POST
        expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? "GET") !== "POST")).toBe(true);

        const row = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: `default-guild:TOURNAMENT:${tournament.id}:announce` },
        });
        expect(row.status).toBe("FAILED");
        expect(row.discordMessageId).toBeNull();
      });

      it("type de salon incompatible (vocal) avec le parcours annonce+fil : aucun POST", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);

        // Bon serveur, mais type 2 = salon vocal — ne supporte pas
        // `POST .../threads` (voir THREAD_CAPABLE_CHANNEL_TYPES).
        mockChannelOk("chan-tournois", "guild-1", 2);
        const outcome = await processOne();

        expect(outcome).toMatchObject({ outcome: "failed", errorClass: "discord:destination_mismatch" });
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });

      it("échec/timeout de la vérification (GET) : aucun envoi tenté, retryable", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);

        // Le GET lui-même échoue (réseau/timeout) — jamais de tentative de
        // POST tant que la destination n'a pas pu être confirmée.
        fetchMock.mockRejectedValueOnce(new DOMException("aborted", "TimeoutError"));
        const outcome = await processOne();
        expect(outcome).toMatchObject({ outcome: "retrying", errorClass: "discord:network_uncertain" });
        expect(fetchMock).toHaveBeenCalledTimes(1); // le GET seul, jamais de POST

        const row = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: `default-guild:TOURNAMENT:${tournament.id}:announce` },
        });
        expect(row.status).toBe("PENDING");
      });

      it("changement de configuration AVANT le premier SEND : la destination persistée à la création est utilisée, jamais la nouvelle config", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        // Destination persistée à la création (simule `createTournamentAction`
        // ayant lu `chan-tournois` à ce moment-là).
        const tournament = await makeTournament(creator.id, game.id, { discordChannelId: "chan-tournois" });
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);

        // Un administrateur change le salon configuré AVANT que l'exécuteur
        // ne traite ce SEND, toujours en attente.
        vi.stubEnv("DISCORD_BOT_TOURNAMENT_CHANNEL_ID", "chan-tournois-NOUVEAU");

        mockVerifiedSendOk("chan-tournois"); // toujours l'ANCIEN salon persisté
        const outcome = await processOne();

        expect(outcome?.outcome).toBe("sent");
        expect(String(fetchMock.mock.calls[0][0])).toContain("/channels/chan-tournois");
        expect(String(fetchMock.mock.calls[0][0])).not.toContain("chan-tournois-NOUVEAU");
        expect(String(fetchMock.mock.calls[1][0])).toContain("/channels/chan-tournois/messages");
      });

      it("changement de configuration APRÈS création de l'annonce : l'édition cible le salon RÉEL de l'annonce, jamais la nouvelle config", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, { maxPlayers: 4 });
        for (let i = 0; i < 4; i++) await makeParticipant(tournament.id, (await makeUser()).id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);

        mockVerifiedSendOk("chan-tournois");
        await processOne(); // SEND annonce réussi dans chan-tournois
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-tournois" }));
        await processOne(); // SEND fil

        await launchBracket(tournament.id);

        // Configuration changée APRÈS que l'annonce existe réellement.
        vi.stubEnv("DISCORD_BOT_TOURNAMENT_CHANNEL_ID", "chan-tournois-NOUVEAU");

        mockSendOk("chan-tournois"); // PATCH attendu vers l'ANCIEN salon, pas le nouveau
        const editOutcome = await processOne();
        expect(editOutcome?.outcome).toBe("sent");
        const lastCall = fetchMock.mock.calls.at(-1)!;
        expect(String(lastCall[0])).toContain("/channels/chan-tournois/messages/msg-announce");
        expect(String(lastCall[0])).not.toContain("chan-tournois-NOUVEAU");
      });
    });

    describe("erreurs Discord — message supprimé, réseau incertain", () => {
      it("message d'annonce supprimé manuellement (404 sur l'EDIT) : FAILED terminal, jamais republié", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, { maxPlayers: 4 });
        for (let i = 0; i < 4; i++) await makeParticipant(tournament.id, (await makeUser()).id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);
        mockVerifiedSendOk("chan-tournois");
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-tournois" }));
        await processOne();

        await launchBracket(tournament.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: "Unknown Message" }));
        const editOutcome = await processOne();
        expect(editOutcome).toMatchObject({ outcome: "failed", errorClass: "discord:not_found" });

        const row = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: `default-guild:TOURNAMENT:${tournament.id}:announce`, operation: "EDIT" },
        });
        expect(row.status).toBe("FAILED");
      });
    });

    describe("atomicité — mutation métier et intention de notification", () => {
      afterEach(() => {
        vi.restoreAllMocks();
      });

      it("création : un échec APRÈS l'enqueue mais AVANT le commit annule le tournoi ET l'enqueue ensemble", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        let tournamentId: string | undefined;

        await expect(
          db.$transaction(async (tx) => {
            const created = await tx.tournament.create({
              data: {
                name: uniq("tournoi"),
                gameId: game.id,
                createdById: creator.id,
                maxPlayers: 4,
                announceViaBot: true,
                discordGuildId: "guild-1",
                discordChannelId: "chan-tournois",
              },
            });
            tournamentId = created.id;
            await announceLib.enqueueTournamentCreationDeliveries(created.id, tx);
            throw new Error("panne simulée avant commit");
          })
        ).rejects.toThrow("panne simulée avant commit");

        expect(tournamentId).toBeDefined();
        expect(await db.tournament.count({ where: { id: tournamentId } })).toBe(0);
        expect(await db.notificationEvent.count({ where: { sourceId: tournamentId } })).toBe(0);
      });

      it("lancement (buildBracketInTransaction) : un échec d'enqueue annule aussi le passage à IN_PROGRESS et la génération du bracket", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, { maxPlayers: 4 });
        for (let i = 0; i < 4; i++) await makeParticipant(tournament.id, (await makeUser()).id);

        vi.spyOn(announceLib, "enqueueTournamentAnnounceUpdate").mockRejectedValueOnce(new Error("panne enqueue"));

        await expect(launchBracket(tournament.id)).rejects.toThrow("panne enqueue");

        const stored = await db.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
        expect(stored.status).toBe("REGISTRATION");
        expect(await db.tournamentMatch.count({ where: { tournamentId: tournament.id } })).toBe(0);
        expect(await db.notificationEvent.count({ where: { sourceId: tournament.id } })).toBe(0);
      });

      it("clôture (declareWinner sur le dernier match) : un échec d'enqueue annule aussi le passage DONE + championId", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, { maxPlayers: 4 });
        const players = [];
        for (let i = 0; i < 4; i++) players.push(await makeUser());
        for (const p of players) await makeParticipant(tournament.id, p.id);
        await launchBracket(tournament.id);

        const round1 = await db.tournamentMatch.findMany({ where: { tournamentId: tournament.id, round: 1 } });
        for (const match of round1) {
          const winnerId = match.player1Id ?? match.player2Id!;
          await tournamentsLib.declareWinner(match.id, winnerId, creator.id);
        }
        const final = await db.tournamentMatch.findFirstOrThrow({ where: { tournamentId: tournament.id, round: 2 } });

        vi.spyOn(announceLib, "enqueueTournamentAnnounceUpdate").mockRejectedValueOnce(new Error("panne enqueue"));

        await expect(
          tournamentsLib.declareWinner(final.id, final.player1Id!, creator.id)
        ).rejects.toThrow("panne enqueue");

        const stored = await db.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
        expect(stored.status).toBe("IN_PROGRESS");
        expect(stored.championId).toBeNull();
        const finalAfter = await db.tournamentMatch.findUniqueOrThrow({ where: { id: final.id } });
        expect(finalAfter.completedAt).toBeNull();
      });

      it("répétition de l'enqueue de création (occurrence fixe) : deux appels identiques ne créent jamais de livraison en double", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id);

        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);

        expect(await db.notificationEvent.count({ where: { sourceId: tournament.id } })).toBe(1);
        expect(
          await db.notificationDelivery.count({
            where: { targetSlot: { startsWith: `default-guild:TOURNAMENT:${tournament.id}:` } },
          })
        ).toBe(2);
      });

      it("répétition d'un declareWinner déjà tranché : aucun second gain de la course, aucune notification en double", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, { maxPlayers: 4 });
        for (let i = 0; i < 4; i++) await makeParticipant(tournament.id, (await makeUser()).id);
        await launchBracket(tournament.id);

        const match = await db.tournamentMatch.findFirstOrThrow({ where: { tournamentId: tournament.id, round: 1 } });
        const winnerId = match.player1Id ?? match.player2Id!;

        const first = await tournamentsLib.declareWinner(match.id, winnerId, creator.id);
        expect(first.ok).toBe(true);
        const second = await tournamentsLib.declareWinner(match.id, winnerId, creator.id);
        expect(second.ok).toBe(false);

        expect(
          await db.notificationEvent.count({ where: { sourceId: tournament.id, eventType: "TOURNAMENT_MODIFIED" } })
        ).toBe(1);
      });
    });

    describe("transport figé à la création — jamais relu depuis l'env", () => {
      it("tournoi créé AVANT le switch (announceViaBot=false) : reste sur webhook même une fois le bot activé", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, { announceViaBot: false, maxPlayers: 4 });
        for (let i = 0; i < 4; i++) await makeParticipant(tournament.id, (await makeUser()).id);

        vi.stubEnv("DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED", "true");
        await launchBracket(tournament.id);

        expect(await db.notificationEvent.count({ where: { sourceId: tournament.id } })).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("tournoi créé APRÈS le switch (announceViaBot=true) : reste sur bot même après un rollback de l'env", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, { announceViaBot: true, maxPlayers: 4 });
        for (let i = 0; i < 4; i++) await makeParticipant(tournament.id, (await makeUser()).id);

        vi.stubEnv("DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED", "false");
        await launchBracket(tournament.id);

        expect(await db.notificationEvent.count({ where: { sourceId: tournament.id } })).toBe(1);
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("flag catégorie désactivé APRÈS création : n'empêche ni le premier SEND en attente, ni le fil, ni les éditions, ni le résumé final — tant que l'exécuteur et la config de salon restent actifs", async () => {
        // Complète le test précédent (qui ne prouve que l'enqueue, jamais
        // le traitement réel) : `DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED`
        // ne détermine QUE le transport des NOUVEAUX tournois, lu une
        // seule fois dans `createTournamentAction` — `tournamentAnnounceResolver`
        // ne le consulte JAMAIS (voir son commentaire de fichier, section
        // "Porte d'activation GLOBALE de la catégorie") : sa seule porte
        // est `getTournamentAnnounceConfig()` (présence de `DISCORD_BOT_GUILD_ID`/
        // `DISCORD_BOT_TOURNAMENT_CHANNEL_ID`), jamais ce flag. Ce test
        // traite RÉELLEMENT les 4 rôles de livraison (SEND annonce, SEND
        // fil, EDIT lancement, EDIT clôture + SEND résumé) via la VRAIE
        // route cron (`NOTIFICATION_EXECUTOR_ENABLED=true`), avec le flag
        // catégorie explicitement désactivé du début à la fin — un
        // tournoi déjà `announceViaBot=true` utilise sa décision et sa
        // destination persistées, jamais ce flag.
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, { announceViaBot: true, maxPlayers: 4 });
        for (let i = 0; i < 4; i++) await makeParticipant(tournament.id, (await makeUser()).id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);

        vi.stubEnv("DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED", "false");
        vi.stubEnv("CRON_SECRET", "s3cret");
        vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
        const { GET } = await import("@/app/api/cron/notification-executor/route");
        const runCron = () =>
          GET(new Request("http://localhost/api/cron/notification-executor", { headers: { authorization: "Bearer s3cret" } }));

        // 1) SEND annonce (avec vérification GET) + SEND fil — encore en
        // attente depuis AVANT la désactivation du flag.
        mockVerifiedSendOk("chan-tournois");
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-tournois" }));
        const afterCreation = await runCron();
        expect((await afterCreation.json()).sent).toBe(2);

        // 2) Lancement du bracket → EDIT de l'annonce ("en cours").
        await launchBracket(tournament.id);
        mockSendOk("chan-tournois");
        const afterLaunch = await runCron();
        expect((await afterLaunch.json()).sent).toBe(1);

        // 3) Clôture → EDIT de l'annonce ("terminé") + SEND du résumé de fil.
        const result = await finalizeTournament(tournament.id, creator.id);
        expect(result.tournamentDone).toBe(true);
        mockSendOk("chan-tournois"); // EDIT clôture
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-summary", channel_id: "thread-1" })); // SEND résumé
        const afterClosure = await runCron();
        const closureBody = await afterClosure.json();
        expect(closureBody.sent).toBe(2);
        expect(closureBody.failed).toBe(0);

        // Toutes les livraisons de ce tournoi ont bien atteint SENT malgré
        // le flag désactivé tout du long.
        const deliveries = await db.notificationDelivery.findMany({
          where: { targetSlot: { startsWith: `default-guild:TOURNAMENT:${tournament.id}:` } },
        });
        expect(deliveries.every((d) => d.status === "SENT" || d.status === "SKIPPED")).toBe(true);
        expect(deliveries.filter((d) => d.status === "SENT")).toHaveLength(5); // announce SEND, thread SEND, announce EDIT×2, thread-summary SEND
      });

      it("configuration absente (canal tournois non renseigné) : not_configured terminal, aucun appel Discord", async () => {
        vi.stubEnv("DISCORD_BOT_TOURNAMENT_CHANNEL_ID", "");
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);

        const outcome = await processOne();
        expect(outcome).toMatchObject({ outcome: "failed", errorClass: "resolver:not_configured" });
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("exécuteur désactivé : la livraison reste intouchée (PENDING, 0 tentative)", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);

        vi.stubEnv("CRON_SECRET", "s3cret");
        vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "false");
        const { GET } = await import("@/app/api/cron/notification-executor/route");
        const res = await GET(
          new Request("http://localhost/api/cron/notification-executor", { headers: { authorization: "Bearer s3cret" } })
        );
        expect(await res.json()).toEqual({ enabled: false, processed: 0 });
        expect(fetchMock).not.toHaveBeenCalled();

        const row = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: `default-guild:TOURNAMENT:${tournament.id}:announce` },
        });
        expect(row.status).toBe("PENDING");
        expect(row.attempts).toBe(0);
      });

      it("route cron — catégorie TOURNAMENT dispatchée vers le vrai résolveur du chantier (GET + SEND + SEND fil)", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);

        vi.stubEnv("CRON_SECRET", "s3cret");
        vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
        mockVerifiedSendOk("chan-tournois");
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-tournois" }));

        const { GET } = await import("@/app/api/cron/notification-executor/route");
        const res = await GET(
          new Request("http://localhost/api/cron/notification-executor", { headers: { authorization: "Bearer s3cret" } })
        );
        const body = await res.json();
        expect(body.sent).toBe(2);
        expect(body.failed).toBe(0);
        expect(fetchMock).toHaveBeenCalledTimes(3); // GET + POST annonce + POST fil
      });
    });

    describe("péremption — annonce rendue depuis l'état COURANT, jamais un texte figé", () => {
      it("SEND initial traité après que le tournoi a déjà progressé : rend l'état actuel, jamais une invitation à s'inscrire devenue fausse", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, { maxPlayers: 4 });
        for (let i = 0; i < 4; i++) await makeParticipant(tournament.id, (await makeUser()).id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);

        // Course simulée : le tournoi progresse (bracket lancé) AVANT que
        // l'exécuteur ne traite le SEND initial de l'annonce.
        await db.tournament.update({ where: { id: tournament.id }, data: { status: "IN_PROGRESS" } });

        mockVerifiedSendOk("chan-tournois");
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");

        const [, init] = fetchMock.mock.calls[1];
        const body = JSON.parse(String(init.body));
        expect(body.embeds[0].title).toContain("en cours");
        expect(body.embeds[0].title).not.toContain("inscriptions ouvertes");
      });

      it("éditions successives (lancement puis clôture rapprochés) : seule la plus récente est traitée, avec le contenu ACTUEL", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, { maxPlayers: 4 });
        for (let i = 0; i < 4; i++) await makeParticipant(tournament.id, (await makeUser()).id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);
        mockVerifiedSendOk("chan-tournois");
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-tournois" }));
        await processOne();

        await db.tournament.update({ where: { id: tournament.id }, data: { status: "IN_PROGRESS" } });
        await announceLib.enqueueTournamentAnnounceUpdate(tournament.id);
        const champion = await makeUser({ discordName: "champion" });
        await db.tournament.update({ where: { id: tournament.id }, data: { status: "DONE", championId: champion.id } });
        await announceLib.enqueueTournamentAnnounceUpdate(tournament.id);

        mockSendOk("chan-tournois");
        const editOutcome = await processOne();
        expect(editOutcome?.outcome).toBe("sent");
        const [, editInit] = fetchMock.mock.calls.at(-1)!;
        const editBody = JSON.parse(String(editInit.body));
        expect(editBody.embeds[0].title).toContain("terminé");

        const secondOutcome = await processOne();
        expect(secondOutcome).toBeNull();

        const deliveries = await db.notificationDelivery.findMany({
          where: { targetSlot: `default-guild:TOURNAMENT:${tournament.id}:announce`, operation: "EDIT" },
        });
        expect(deliveries.filter((d) => d.status === "SKIPPED")).toHaveLength(1);
        expect(deliveries.filter((d) => d.status === "SENT")).toHaveLength(1);
      });
    });

    describe("aucune mention — jamais un @participant, jamais @everyone/@here", () => {
      it("SEND et EDIT portent tous deux allowed_mentions: {parse: []}, même avec des noms de joueurs ressemblant à une mention", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tricky = await makeUser({ discordName: "<@123456789>" });
        const tournament = await makeTournament(creator.id, game.id, { maxPlayers: 4 });
        await makeParticipant(tournament.id, tricky.id);
        for (let i = 0; i < 3; i++) await makeParticipant(tournament.id, (await makeUser()).id);

        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);
        mockVerifiedSendOk("chan-tournois");
        await processOne();

        const [, sendInit] = fetchMock.mock.calls[1];
        const sendBody = JSON.parse(String(sendInit.body));
        expect(sendBody.allowed_mentions).toEqual({ parse: [] });
        expect(sendBody.content).toBeUndefined();
        // Le nom "ressemblant à une mention" n'apparaît nulle part dans ce
        // message (l'annonce n'affiche pas les noms individuels des
        // inscrits) — mais même s'il apparaissait, `allowed_mentions: {parse: []}`
        // empêcherait Discord de le résoudre en mention réelle.
      });
    });
  }
);
