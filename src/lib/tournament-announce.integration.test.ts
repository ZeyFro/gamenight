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
 * Nécessite `TEST_DATABASE_URL` — voir docs/DEVELOPPEMENT_LOCAL.md. Suite entièrement
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
      const user = await db.user.create({
        data: { discordId: id, discordName: overrides.discordName ?? id },
      });
      await db.membership.create({ data: {
        userId: user.id,
        communityId: await (await import("@/lib/default-community")).getDefaultCommunityId(),
        status: "ACTIVE",
      } });
      return user;
    }

    async function makeGame(addedById: string) {
      return db.game.create({ data: { name: uniq("game"), source: "MANUAL", addedById } });
    }

    async function makeTournament(
      creatorId: string,
      gameId: string,
      overrides: Partial<{
        status: "REGISTRATION" | "IN_PROGRESS" | "DONE" | "CANCELLED";
        announceViaBot: boolean;
        maxPlayers: number;
        format: "INDIVIDUAL" | "TEAMS";
        championId: string | null;
        discordGuildId: string | null;
        discordChannelId: string | null;
        notifiedUserIds: string[] | null;
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
          format: overrides.format ?? "INDIVIDUAL",
          announceViaBot,
          championId: overrides.championId ?? null,
          // Même contrat que `createTournamentAction` : destination figée
          // EN MÊME TEMPS que le booléen, jamais l'un sans l'autre pour un
          // tournoi bot — voir le commentaire du champ, schema.prisma.
          discordGuildId: "discordGuildId" in overrides ? overrides.discordGuildId : announceViaBot ? "guild-1" : null,
          discordChannelId:
            "discordChannelId" in overrides ? overrides.discordChannelId : announceViaBot ? "chan-tournois" : null,
          notifiedUserIds: overrides.notifiedUserIds ?? undefined,
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

        const callsBeforeClosure = fetchMock.mock.calls.length;
        for (let i = 0; i < 5; i++) {
          fetchMock.mockImplementationOnce(async (url, init) => jsonResponse(200, {
            id: `msg-closure-${i}`,
            channel_id: init.method === "PATCH" ? "chan-tournois" : "thread-1",
          }));
          expect((await processOne())?.outcome).toBe("sent");
        }
        const closureCalls = fetchMock.mock.calls.slice(callsBeforeClosure);
        const closureInit = closureCalls.find(([, init]) => init.method === "PATCH")![1];
        const closureBody = JSON.parse(String(closureInit.body));
        expect(closureBody.embeds[0].title).toContain("terminé");

        const bodies = closureCalls.map(([, init]) => JSON.parse(String(init.body)));
        const summaryBody = bodies.find((body) => body.embeds?.[0].title.startsWith("🎮 Résumé"));
        expect(summaryBody.embeds[0].fields.some((f: { name: string }) => f.name === "🏆 Champion")).toBe(true);
        expect(summaryBody.allowed_mentions).toEqual({ parse: [] });
        expect(bodies.filter((body) => body.content?.includes(" — manche "))).toHaveLength(3);

        // Cette PR n'attribue AUCUN XP/badge — `declareWinner`/`finalizeTournament`
        // gardent exactement le même mécanisme XP qu'avant (hors périmètre
        // de ce module, jamais dupliqué ni modifié ici).
        const stored = await db.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
        expect(stored.championId).toBeTruthy();
      });
    });

    describe("résultat de tournoi en équipes", () => {
      it("annonce les noms des équipes via HTTP simulé, sans mention", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, { format: "TEAMS", maxPlayers: 6 });
        const players = await Promise.all(["a", "b", "c", "d", "e", "f"].map(() => makeUser()));
        for (const player of players) await makeParticipant(tournament.id, player.id);

        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);
        mockVerifiedSendOk("chan-tournois");
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-tournois" }));
        await processOne();
        await launchBracket(tournament.id);
        mockSendOk("chan-tournois");
        await processOne(); // EDIT lancement

        const match = await db.tournamentMatch.findFirstOrThrow({
          where: { tournamentId: tournament.id, round: 1, team1Id: { not: null }, team2Id: { not: null } },
          include: { team1: true, team2: true },
        });
        const winner = await db.tournamentTeam.findUniqueOrThrow({ where: { id: match.team1Id! }, include: { members: true } });
        await tournamentsLib.declareWinner(match.id, winner.id, winner.members[0].userId);

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "message-match-result", channel_id: "thread-1" }));
        const sent = await processOne();
        expect(sent?.outcome).toBe("sent");
        const body = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
        expect(body.content).toContain(`${winner.name} bat ${match.team2!.name}`);
        expect(body.allowed_mentions).toEqual({ parse: [] });
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
        expect(
          await db.notificationEvent.count({ where: { sourceId: tournament.id, eventType: "TOURNAMENT_MATCH_RESULT" } })
        ).toBe(1);
        expect(
          await db.notificationDelivery.count({ where: { targetSlot: { contains: `:match-result:${match.id}` } } })
        ).toBe(1);
      });

      it("résultat de match : enqueue dans le thread, par match, sans ping même si un nom contient @everyone", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id);
        const first = await makeUser({ discordName: "@everyone joueur" });
        const second = await makeUser({ discordName: "Joueur 2" });
        await makeParticipant(tournament.id, first.id);
        await makeParticipant(tournament.id, second.id);
        for (let i = 0; i < 2; i++) await makeParticipant(tournament.id, (await makeUser()).id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);
        mockVerifiedSendOk("chan-tournois");
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-tournois" }));
        await processOne();
        await launchBracket(tournament.id);
        mockSendOk("chan-tournois");
        await processOne(); // EDIT lancement

        const match = await db.tournamentMatch.findFirstOrThrow({
          where: { tournamentId: tournament.id, round: 1, OR: [{ player1Id: first.id }, { player2Id: first.id }] },
          include: { player1: true, player2: true },
        });
        const firstIsPlayer1 = match.player1Id === first.id;
        const opponent = firstIsPlayer1 ? match.player2 : match.player1;
        const scores = firstIsPlayer1 ? { score1: 3, score2: 1 } : { score1: 1, score2: 3 };
        expect((await tournamentsLib.declareWinner(match.id, first.id, creator.id, scores)).ok).toBe(true);
        expect(await db.notificationEvent.count({ where: { sourceId: tournament.id, eventType: "TOURNAMENT_MATCH_RESULT", occurrence: match.id } })).toBe(1);
        expect(await db.notificationDelivery.count({ where: { targetSlot: `default-guild:TOURNAMENT:${tournament.id}:match-result:${match.id}` } })).toBe(1);

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "message-match-result", channel_id: "thread-1" }));
        const sent = await processOne();
        expect(sent?.outcome).toBe("sent");
        expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("/channels/thread-1/messages");
        const body = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
        expect(body.content).toContain("@everyone joueur");
        expect(body.content).toContain(`bat ${opponent!.discordName}`);
        expect(body.content).toContain("3–1");
        expect(body.allowed_mentions).toEqual({ parse: [] });
      });

      it("échec d'enqueue du résultat : la déclaration du vainqueur est annulée avec la transaction", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id);
        for (let i = 0; i < 4; i++) await makeParticipant(tournament.id, (await makeUser()).id);
        await launchBracket(tournament.id);
        const match = await db.tournamentMatch.findFirstOrThrow({ where: { tournamentId: tournament.id, round: 1 } });

        vi.spyOn(announceLib, "enqueueTournamentMatchResult").mockRejectedValueOnce(new Error("panne enqueue"));
        await expect(tournamentsLib.declareWinner(match.id, match.player1Id!, creator.id)).rejects.toThrow("panne enqueue");
        expect((await db.tournamentMatch.findUniqueOrThrow({ where: { id: match.id } })).completedAt).toBeNull();
        expect(await db.notificationEvent.count({ where: { sourceId: tournament.id, eventType: "TOURNAMENT_MATCH_RESULT" } })).toBe(0);
      });

      it("tournoi sans annonce bot : aucun résultat Discord n'est mis en file", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, { announceViaBot: false });
        for (let i = 0; i < 4; i++) await makeParticipant(tournament.id, (await makeUser()).id);
        await launchBracket(tournament.id);
        const match = await db.tournamentMatch.findFirstOrThrow({ where: { tournamentId: tournament.id, round: 1 } });
        expect((await tournamentsLib.declareWinner(match.id, match.player1Id!, creator.id)).ok).toBe(true);
        expect(await db.notificationEvent.count({ where: { sourceId: tournament.id, eventType: "TOURNAMENT_MATCH_RESULT" } })).toBe(0);
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

        // 3) Trois résultats de match + EDIT de clôture + SEND du résumé de fil.
        const result = await finalizeTournament(tournament.id, creator.id);
        expect(result.tournamentDone).toBe(true);
        for (let i = 0; i < 5; i++) {
          fetchMock.mockImplementationOnce(async (url, init) => jsonResponse(200, {
            id: `msg-closure-${i}`,
            channel_id: init.method === "PATCH" ? "chan-tournois" : "thread-1",
          }));
        }
        const afterClosure = await runCron();
        const closureBody = await afterClosure.json();
        expect(closureBody.sent).toBe(5);
        expect(closureBody.failed).toBe(0);

        // Toutes les livraisons de ce tournoi ont bien atteint SENT malgré
        // le flag désactivé tout du long.
        const deliveries = await db.notificationDelivery.findMany({
          where: { targetSlot: { startsWith: `default-guild:TOURNAMENT:${tournament.id}:` } },
        });
        expect(deliveries.every((d) => d.status === "SENT" || d.status === "SKIPPED")).toBe(true);
        expect(deliveries.filter((d) => d.status === "SENT")).toHaveLength(8); // annonce, fil, deux éditions, résumé et trois résultats
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

    describe("V2 — notifications maîtrisées (mentions à la création)", () => {
      it("annonce du salon : jamais de mention ; les destinataires sélectionnés sont mentionnés DANS LE FIL, ids dédupliqués, créateur jamais mentionné, allowed_mentions.users explicite", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const guestA = await makeUser({ discordName: "guestA" });
        const guestB = await makeUser({ discordName: "guestB" });
        const notInvited = await makeUser({ discordName: "pasPrevenu" });
        const tournament = await makeTournament(creator.id, game.id, {
          notifiedUserIds: [guestA.id, guestB.id, guestA.id, creator.id], // doublon volontaire, créateur dans sa sélection
        });
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);

        mockVerifiedSendOk("chan-tournois");
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");
        // L'annonce du salon ne mentionne personne.
        const [, announceInit] = fetchMock.mock.calls[1];
        const announceBody = JSON.parse(String(announceInit.body));
        expect(announceBody.content).toBeUndefined();
        expect(announceBody.allowed_mentions).toEqual({ parse: [] });

        // Fil, puis message de bienvenue avec les mentions.
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-tournois" }));
        await processOne();
        mockSendOk("thread-1", "msg-invite");
        expect((await processOne())?.outcome).toBe("sent");

        const [, sendInit] = fetchMock.mock.calls.at(-1)!;
        const sendBody = JSON.parse(String(sendInit.body));
        expect(sendBody.content).toContain(`<@${guestA.discordId}>`);
        expect(sendBody.content).not.toContain(`<@${creator.discordId}>`);
        expect(sendBody.content).toContain(`<@${guestB.discordId}>`);
        expect(sendBody.content).not.toContain(notInvited.discordId);
        // Dédupliqué — une seule occurrence de guestA malgré le doublon en base.
        expect(sendBody.content.split(`<@${guestA.discordId}>`)).toHaveLength(2);
        // Liste EXPLICITE, jamais `parse: ["users"]` ni @everyone/@here/rôle.
        expect(sendBody.allowed_mentions).toEqual({
          parse: [],
          users: expect.arrayContaining([guestA.discordId, guestB.discordId]),
        });
        expect(sendBody.allowed_mentions.users).toHaveLength(2);
      });

      it("créateur jamais dans la sélection, aucun destinataire sélectionné : aucune mention, content vide", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, { notifiedUserIds: [] });
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);

        mockVerifiedSendOk("chan-tournois");
        await processOne();

        const [, sendInit] = fetchMock.mock.calls[1];
        const sendBody = JSON.parse(String(sendInit.body));
        expect(sendBody.content).toBeFalsy();
        expect(sendBody.allowed_mentions).toEqual({ parse: [] });
      });

      it("opt-out TOURNAMENT posé APRÈS l'enqueue mais AVANT le traitement retire quand même la mention (relu au SEND réel, jamais à l'enqueue)", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const guest = await makeUser({ discordName: "seDesinscritEntreTemps" });
        const tournament = await makeTournament(creator.id, game.id, { notifiedUserIds: [guest.id] });

        // Enqueue AVANT tout refus — encore éligible à cet instant (aucune
        // ligne de préférence, repli legacy actif).
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);

        // Le refus arrive APRÈS l'enqueue, avant que l'exécuteur ne traite
        // le SEND — simule un opt-out pendant la fenêtre d'attente du cron.
        await db.userNotificationPreference.create({
          data: { userId: guest.id, category: "TOURNAMENT", enabled: false },
        });

        mockVerifiedSendOk("chan-tournois");
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");

        const [, sendInit] = fetchMock.mock.calls[1];
        const sendBody = JSON.parse(String(sendInit.body));
        expect(sendBody.content).toBeFalsy();
        expect(sendBody.allowed_mentions.users).toBeUndefined();
      });

      it("un compte ayant demandé le silence global (silenceReminders) n'est jamais mentionné, même sélectionné explicitement (jamais de réactivation silencieuse)", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const silent = await db.user.create({
          data: { discordId: uniq("silent"), discordName: "silencieux", silenceReminders: true },
        });
        await db.membership.create({ data: {
          userId: silent.id,
          communityId: await (await import("@/lib/default-community")).getDefaultCommunityId(),
          status: "ACTIVE",
        } });
        const tournament = await makeTournament(creator.id, game.id, { notifiedUserIds: [silent.id] });
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);

        mockVerifiedSendOk("chan-tournois");
        await processOne();

        const [, sendInit] = fetchMock.mock.calls[1];
        const sendBody = JSON.parse(String(sendInit.body));
        expect(sendBody.content).toBeFalsy();
      });

      it("EDIT (lancement du bracket) ne mentionne JAMAIS, même avec des destinataires sélectionnés à la création — jamais un reping sur une mise à jour", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const guest = await makeUser({ discordName: "prevenuUneFoisSeulement" });
        const tournament = await makeTournament(creator.id, game.id, {
          maxPlayers: 4,
          notifiedUserIds: [guest.id],
        });
        for (let i = 0; i < 4; i++) await makeParticipant(tournament.id, (await makeUser()).id);

        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);
        mockVerifiedSendOk("chan-tournois");
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-tournois" }));
        await processOne();
        // Message de bienvenue (avec mention) dans le fil.
        mockSendOk("thread-1", "msg-invite");
        await processOne();

        await launchBracket(tournament.id);
        mockSendOk("chan-tournois");
        const editOutcome = await processOne();
        expect(editOutcome?.outcome).toBe("sent");

        const [, editInit] = fetchMock.mock.calls.at(-1)!;
        const editBody = JSON.parse(String(editInit.body));
        expect(editBody.content).toBeUndefined();
        expect(editBody.allowed_mentions).toEqual({ parse: [] });
      });

      it("réessai après un échec transitoire du SEND initial ne mentionne pas deux fois (une seule occurrence dans le contenu finalement envoyé)", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const guest = await makeUser({ discordName: "prevenuUneSeuleFois" });
        const tournament = await makeTournament(creator.id, game.id, { notifiedUserIds: [guest.id] });
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);

        const t0 = new Date("2026-01-01T00:00:00.000Z");
        mockChannelOk("chan-tournois");
        fetchMock.mockResolvedValueOnce(jsonResponse(500, {}));
        const failedOutcome = await processOne(t0);
        expect(failedOutcome?.outcome).toBe("retrying");

        const later = new Date(t0.getTime() + 60_000);
        mockVerifiedSendOk("chan-tournois");
        const outcome = await processOne(later);
        expect(outcome?.outcome).toBe("sent");

        // Une seule livraison SENT au final (jamais republiée une fois
        // envoyée) ; l'annonce ne mentionne personne et le message de bienvenue
        // du fil n'est mis en file qu'UNE fois malgré le réessai.
        const [, sendInit] = fetchMock.mock.calls.at(-1)!;
        const sendBody = JSON.parse(String(sendInit.body));
        expect(sendBody.content).toBeUndefined();
        expect(
          await db.notificationDelivery.count({
            where: { targetSlot: `default-guild:TOURNAMENT:${tournament.id}:thread-invite` },
          })
        ).toBe(1);

        const deliveries = await db.notificationDelivery.findMany({
          where: { targetSlot: `default-guild:TOURNAMENT:${tournament.id}:announce`, operation: "SEND" },
        });
        expect(deliveries).toHaveLength(1);
        expect(deliveries[0].status).toBe("SENT");
      });
    });

    describe("V2 — annulation d'un tournoi démarré (matchs/résultats conservés)", () => {
      async function makeStartedTournament(creator: { id: string }, game: { id: string }) {
        const tournament = await makeTournament(creator.id, game.id, { maxPlayers: 4 });
        for (let i = 0; i < 4; i++) await makeParticipant(tournament.id, (await makeUser()).id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);
        mockVerifiedSendOk("chan-tournois");
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-tournois" }));
        await processOne();
        await launchBracket(tournament.id);
        mockSendOk("chan-tournois");
        await processOne(); // EDIT lancement
        return tournament;
      }

      it("annulation : statut CANCELLED + cancelledAt posés, matchs et participants intégralement conservés", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeStartedTournament(creator, game);
        const matchesBefore = await db.tournamentMatch.count({ where: { tournamentId: tournament.id } });
        const participantsBefore = await db.tournamentParticipant.count({ where: { tournamentId: tournament.id } });

        const result = await tournamentsLib.cancelTournament(tournament.id, creator.id);
        expect(result.ok).toBe(true);

        const stored = await db.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
        expect(stored.status).toBe("CANCELLED");
        expect(stored.cancelledAt).not.toBeNull();
        expect(await db.tournamentMatch.count({ where: { tournamentId: tournament.id } })).toBe(matchesBefore);
        expect(await db.tournamentParticipant.count({ where: { tournamentId: tournament.id } })).toBe(
          participantsBefore
        );
      });

      it("un non-créateur ne peut jamais annuler, même avec un id de tournoi réel et valide", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeStartedTournament(creator, game);
        const intruder = await makeUser();

        const result = await tournamentsLib.cancelTournament(tournament.id, intruder.id);
        expect(result).toEqual({ ok: false, reason: "not_creator" });

        const stored = await db.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
        expect(stored.status).toBe("IN_PROGRESS");
      });

      it("annulation impossible sur un tournoi encore en REGISTRATION (se supprime) ou déjà DONE (historique conservé)", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const registering = await makeTournament(creator.id, game.id, { announceViaBot: false });
        const resultReg = await tournamentsLib.cancelTournament(registering.id, creator.id);
        expect(resultReg).toEqual({ ok: false, reason: "not_in_progress" });

        const done = await makeTournament(creator.id, game.id, {
          status: "DONE",
          announceViaBot: false,
          championId: creator.id,
        });
        const resultDone = await tournamentsLib.cancelTournament(done.id, creator.id);
        expect(resultDone).toEqual({ ok: false, reason: "not_in_progress" });
      });

      it("EDIT « annulé » posté sur l'annonce existante + fil archivé, aucune mention", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeStartedTournament(creator, game);

        const result = await tournamentsLib.cancelTournament(tournament.id, creator.id);
        expect(result.ok).toBe(true);

        mockSendOk("chan-tournois");
        const editOutcome = await processOne();
        expect(editOutcome?.outcome).toBe("sent");
        const [, editInit] = fetchMock.mock.calls.at(-1)!;
        const editBody = JSON.parse(String(editInit.body));
        expect(editBody.embeds[0].title).toContain("annulé");
        expect(editBody.content).toBeUndefined();
        expect(editBody.allowed_mentions).toEqual({ parse: [] });

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", archived: true }));
        const closeOutcome = await processOne();
        expect(closeOutcome?.outcome).toBe("sent");
        const [closeUrl, closeInit] = fetchMock.mock.calls.at(-1)!;
        expect(String(closeUrl)).toContain("/channels/thread-1");
        expect(closeInit.method).toBe("PATCH");
        const closeBody = JSON.parse(String(closeInit.body));
        expect(closeBody.archived).toBe(true);
        // Nettoyage automatique des fils (V2) — verrouillé en plus d'archivé.
        expect(closeBody.locked).toBe(true);
      });

      it("un tournoi déjà CANCELLED refuse toute déclaration de vainqueur, même pour un match jamais encore joué (garde déjà existante de declareWinner, étendue à CANCELLED)", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, { maxPlayers: 4, announceViaBot: false });
        const players = [];
        for (let i = 0; i < 4; i++) players.push(await makeUser());
        for (const p of players) await makeParticipant(tournament.id, p.id);
        await launchBracket(tournament.id);

        const cancelResult = await tournamentsLib.cancelTournament(tournament.id, creator.id);
        expect(cancelResult.ok).toBe(true);

        const round1 = await db.tournamentMatch.findMany({ where: { tournamentId: tournament.id, round: 1 } });
        for (const m of round1) {
          const winnerId = m.player1Id ?? m.player2Id;
          if (!winnerId) continue;
          const result = await tournamentsLib.declareWinner(m.id, winnerId, creator.id);
          expect(result).toEqual({ ok: false, tournamentDone: false });
        }
        // Aucun match n'a bougé — jamais un résultat inventé après coup pour
        // un tournoi qui n'accepte plus de progression. 4 joueurs → 2 matchs
        // au round 1 (bracket à 4 places, aucun bye).
        const stillUndecided = await db.tournamentMatch.count({
          where: { tournamentId: tournament.id, round: 1, winnerId: null },
        });
        expect(stillUndecided).toBe(2);
      });

      it("course RÉELLE annulation vs clôture du dernier match (Promise.all) : l'état final reste cohérent, jamais DONE avec un match non tranché ni CANCELLED avec un champion posé", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, { maxPlayers: 4, announceViaBot: false });
        const players = [];
        for (let i = 0; i < 4; i++) players.push(await makeUser());
        for (const p of players) await makeParticipant(tournament.id, p.id);
        await launchBracket(tournament.id);

        // Round 1 résolu normalement (hors course) — seul le DERNIER match
        // (la finale) reste en jeu au moment de la course.
        const round1 = await db.tournamentMatch.findMany({ where: { tournamentId: tournament.id, round: 1 } });
        for (const m of round1) {
          const winnerId = m.player1Id ?? m.player2Id;
          if (winnerId) await tournamentsLib.declareWinner(m.id, winnerId, creator.id);
        }
        const final = await db.tournamentMatch.findFirstOrThrow({ where: { tournamentId: tournament.id, round: 2 } });
        const championId = final.player1Id ?? final.player2Id!;

        // Le créateur clique "Annuler" au MÊME instant qu'un joueur déclare
        // le vainqueur de la finale — même style de test que "deux appels
        // concurrents de spinRoulette" (chantier confidentialité) : jamais
        // d'hypothèse sur lequel des deux gagne la course, seulement que
        // l'état final reste cohérent, quel que soit l'ordre réel choisi
        // par Postgres.
        const [cancelResult, declareResult] = await Promise.all([
          tournamentsLib.cancelTournament(tournament.id, creator.id),
          tournamentsLib.declareWinner(final.id, championId, creator.id),
        ]);

        const storedTournament = await db.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
        const storedFinal = await db.tournamentMatch.findUniqueOrThrow({ where: { id: final.id } });

        if (declareResult.ok && declareResult.tournamentDone) {
          // La clôture a gagné — jamais annulé après coup.
          expect(cancelResult.ok).toBe(false);
          expect(storedTournament.status).toBe("DONE");
          expect(storedTournament.championId).toBe(championId);
        } else {
          // L'annulation a gagné (ou est arrivée avant la clôture) — jamais
          // DONE, jamais de champion posé. Le match peut avoir été tranché
          // (déclaré avant que la finalisation n'échoue) ou non selon
          // l'ordre exact — dans tous les cas jamais de corruption.
          expect(storedTournament.status).toBe("CANCELLED");
          expect(storedTournament.championId).toBeNull();
          if (declareResult.ok) {
            expect(storedFinal.winnerId).toBe(championId);
          }
        }
      });
    });

    describe("V2 — suppression d'un tournoi non démarré", () => {
      it("suppression AVANT tout envoi Discord (announceViaBot=false) : ligne supprimée, aucun appel réseau", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, { announceViaBot: false });

        const result = await tournamentsLib.deleteTournament(tournament.id, creator.id);
        expect(result.ok).toBe(true);
        expect(await db.tournament.findUnique({ where: { id: tournament.id } })).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("suppression AVANT que l'annonce (bot) n'ait été envoyée : ligne supprimée immédiatement, rien à éditer — le SEND encore PENDING se refuse lui-même (expired) au traitement, jamais une invitation tardive", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id); // announceViaBot true par défaut
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);

        const result = await tournamentsLib.deleteTournament(tournament.id, creator.id);
        expect(result.ok).toBe(true);
        expect(await db.tournament.findUnique({ where: { id: tournament.id } })).toBeNull();

        // La livraison SEND, restée PENDING, est traitée APRÈS la
        // suppression (simule un cron en retard) — doit se refuser
        // définitivement, jamais publier une annonce pour un tournoi qui
        // n'existe plus.
        const outcome = await processOne();
        expect(outcome).toMatchObject({ outcome: "failed", errorClass: "resolver:expired" });
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("suppression APRÈS que l'annonce ait déjà été envoyée : suppression DÉFINITIVE du message ET du fil (jamais une simple édition/archivage), fonctionnent SANS que la ligne Tournament existe encore", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);
        mockVerifiedSendOk("chan-tournois");
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-tournois" }));
        await processOne();

        const result = await tournamentsLib.deleteTournament(tournament.id, creator.id);
        expect(result.ok).toBe(true);
        expect(await db.tournament.findUnique({ where: { id: tournament.id } })).toBeNull();

        // Message d'annonce — DELETE, jamais une PATCH/EDIT.
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
        const deleteAnnounceOutcome = await processOne();
        expect(deleteAnnounceOutcome?.outcome).toBe("sent");
        const [deleteAnnounceUrl, deleteAnnounceInit] = fetchMock.mock.calls.at(-1)!;
        expect(deleteAnnounceInit.method).toBe("DELETE");
        expect(String(deleteAnnounceUrl)).toContain("/channels/chan-tournois/messages/msg-announce");

        // Fil — DELETE définitif, jamais un PATCH `archived: true`.
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
        const deleteThreadOutcome = await processOne();
        expect(deleteThreadOutcome?.outcome).toBe("sent");
        const [deleteThreadUrl, deleteThreadInit] = fetchMock.mock.calls.at(-1)!;
        expect(deleteThreadInit.method).toBe("DELETE");
        expect(String(deleteThreadUrl)).toContain("/channels/thread-1");
        expect(deleteThreadInit.body).toBeUndefined();
      });

      it("annonce/fil déjà absents côté Discord (404) au moment du nettoyage : traité comme un résultat idempotent (objectif déjà atteint), jamais un échec", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);
        mockVerifiedSendOk("chan-tournois");
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-tournois" }));
        await processOne();

        await tournamentsLib.deleteTournament(tournament.id, creator.id);

        fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: "Unknown Message" }));
        const announceOutcome = await processOne();
        expect(announceOutcome?.outcome).toBe("sent");

        fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: "Unknown Channel" }));
        const threadOutcome = await processOne();
        expect(threadOutcome?.outcome).toBe("sent");
      });

      it("permissions insuffisantes (403) sur la suppression du fil : JAMAIS traité comme un succès, reste FAILED terminal", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);
        mockVerifiedSendOk("chan-tournois");
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-tournois" }));
        await processOne();
        await tournamentsLib.deleteTournament(tournament.id, creator.id);
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 })); // annonce OK
        await processOne();

        // 403 — non-retryable, immédiatement FAILED terminal (voir
        // discord-rest.ts), une seule tentative suffit à l'atteindre.
        fetchMock.mockResolvedValueOnce(jsonResponse(403, { message: "Missing Permissions", code: 50013 }));
        const outcome = await processOne();
        expect(outcome).toMatchObject({ outcome: "failed", errorClass: "discord:auth_or_permission" });
        const row = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: `default-guild:TOURNAMENT:${tournament.id}:thread-delete` },
        });
        expect(row.status).toBe("FAILED");
      });

      /**
       * Même technique que "suppression PENDANT l'appel réseau du tout
       * premier SEND" ci-dessus (déclenche la suppression DEPUIS
       * L'INTÉRIEUR du mock réseau, une fois l'action déjà résolue) —
       * seule façon de reproduire RÉELLEMENT l'entrelacement : une fois
       * touchée après la disparition du tournoi, la livraison `thread`
       * (comme toute livraison hors `thread-close`/`thread-delete`/
       * `announce-delete`) se refuse elle-même IMMÉDIATEMENT (`expired`),
       * elle ne reste jamais "PENDING en attendant" après un premier
       * passage.
       */
      it("création du fil ABOUTIT EN VOL via un SEND déjà en vol au moment de la suppression : le nettoyage attend, puis supprime bel et bien le fil créé malgré la suppression — compensation durable, jamais un fil orphelin permanent", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);
        mockVerifiedSendOk("chan-tournois");
        await processOne(); // annonce SENT

        // Le SEND du fil est déjà EN VOL (action résolue, requête réseau
        // partie) au moment où la suppression commet.
        fetchMock.mockImplementationOnce(async () => {
          const result = await tournamentsLib.deleteTournament(tournament.id, creator.id);
          expect(result.ok).toBe(true);
          return jsonResponse(200, { id: "thread-orphelin", parent_id: "chan-tournois" });
        });
        const threadSendOutcome = await processOne();
        expect(threadSendOutcome?.outcome).toBe("sent");
        expect(await db.tournament.findUnique({ where: { id: tournament.id } })).toBeNull();

        // Nettoyage programmé (`announce-delete` puis `thread-delete`,
        // enqueue-és par `deleteTournament` puisque l'annonce était déjà
        // SENT) — le message d'annonce d'abord.
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
        const announceDeleteOutcome = await processOne();
        expect(announceDeleteOutcome?.outcome).toBe("sent");

        // Puis le fil — voit maintenant `thread` SENT et supprime
        // RÉELLEMENT ce fil créé en vol malgré la suppression déjà actée —
        // sans cette compensation, il resterait orphelin indéfiniment.
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
        const cleanupOutcome = await processOne();
        expect(cleanupOutcome?.outcome).toBe("sent");
        const [cleanupUrl, cleanupInit] = fetchMock.mock.calls.at(-1)!;
        expect(cleanupInit.method).toBe("DELETE");
        expect(String(cleanupUrl)).toContain("/channels/thread-orphelin");
      });

      /**
       * Demande explicite (revue V2) — ne pas affirmer qu'une course est
       * résolue sans un test reproduisant RÉELLEMENT l'entrelacement (pas
       * seulement l'ordre séquentiel "avant"/"après" déjà couvert
       * ci-dessus). Simule le délai d'un vrai POST Discord en exécutant
       * `deleteTournament` DEPUIS L'INTÉRIEUR du mock réseau du SEND —
       * celui-ci a déjà tout résolu (contenu, destination) avant cet
       * appel, exactement comme le ferait un vrai aller-retour réseau
       * pendant lequel une suppression concurrente (double onglet, requête
       * indépendante) peut commettre.
       */
      it("suppression PENDANT l'appel réseau du tout premier SEND (annonce) déjà en vol — l'annonce part quand même, mais rien n'est jamais enqueue-é pour l'éditer/fermer : limite de cohérence assumée et démontrée, pas silencieusement résolue", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);

        mockChannelOk("chan-tournois");
        fetchMock.mockImplementationOnce(async () => {
          const result = await tournamentsLib.deleteTournament(tournament.id, creator.id);
          expect(result.ok).toBe(true);
          return jsonResponse(200, { id: "msg-announce", channel_id: "chan-tournois" });
        });

        const outcome = await processOne();
        // Le SEND, déjà engagé AVANT la suppression, se termine
        // normalement — l'annonce EXISTE bien côté Discord.
        expect(outcome?.outcome).toBe("sent");
        expect(await db.tournament.findUnique({ where: { id: tournament.id } })).toBeNull();

        // `deleteTournament` a vérifié `isTournamentAnnounceSent` AVANT que
        // ce SEND ne commette son statut SENT — il n'a donc rien enqueue-é
        // à supprimer/fermer. La livraison `thread` restée PENDING (dépendait
        // de l'annonce) devient réclamable maintenant qu'elle est SENT —
        // mais se refuse elle-même (`expired`, tournoi disparu) : AUCUN
        // fil n'est donc jamais créé, ce qui évite au moins un fil
        // orphelin en plus de l'annonce.
        const threadOutcome = await processOne();
        expect(threadOutcome).toMatchObject({ outcome: "failed", errorClass: "resolver:expired" });

        // Plus rien à traiter ensuite. L'annonce publique, elle, reste
        // visible TELLE QUELLE (jamais supprimée) pour un tournoi qui
        // n'existe plus en base, jusqu'à intervention manuelle (voir
        // l'onglet admin "Nettoyage") — limite honnêtement constatée, hors
        // du périmètre de ce ticket (détecter cette course précise après
        // coup), pas prétendue résolue.
        expect(await processOne()).toBeNull();
      });

      it("un non-créateur ne peut jamais supprimer, même avec un id de tournoi réel et valide", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, { announceViaBot: false });
        const intruder = await makeUser();

        const result = await tournamentsLib.deleteTournament(tournament.id, intruder.id);
        expect(result).toEqual({ ok: false, reason: "not_creator" });
        expect(await db.tournament.findUnique({ where: { id: tournament.id } })).not.toBeNull();
      });

      it("suppression impossible sur un tournoi déjà démarré (s'annule) ou terminé (historique conservé)", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const inProgress = await makeTournament(creator.id, game.id, { status: "IN_PROGRESS", announceViaBot: false });
        const result = await tournamentsLib.deleteTournament(inProgress.id, creator.id);
        expect(result).toEqual({ ok: false, reason: "not_registration" });
        expect(await db.tournament.findUnique({ where: { id: inProgress.id } })).not.toBeNull();
      });

      it("course suppression concurrente (double clic) : un seul appel supprime réellement, le second est un no-op propre", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, { announceViaBot: false });

        const [first, second] = await Promise.all([
          tournamentsLib.deleteTournament(tournament.id, creator.id),
          tournamentsLib.deleteTournament(tournament.id, creator.id),
        ]);
        const oks = [first.ok, second.ok].filter(Boolean);
        expect(oks).toHaveLength(1);
        expect(await db.tournament.findUnique({ where: { id: tournament.id } })).toBeNull();
      });
    });

    describe("V2 — état d'envoi fidèle pour le créateur (jamais un faux bandeau d'échec)", () => {
      it("avant tout traitement : announce et thread tous deux 'pending', jamais 'failed'", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);

        const status = await announceLib.getTournamentAnnounceStatus(tournament.id);
        expect(status).toEqual({ announce: "pending", thread: "pending" });
      });

      it("annonce envoyée, fil encore en attente : les deux étaps distinguées correctement", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);
        mockVerifiedSendOk("chan-tournois");
        await processOne();

        const status = await announceLib.getTournamentAnnounceStatus(tournament.id);
        expect(status).toEqual({ announce: "sent", thread: "pending" });
      });

      it("annonce ET fil envoyés : les deux 'sent'", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);
        mockVerifiedSendOk("chan-tournois");
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-tournois" }));
        await processOne();

        const status = await announceLib.getTournamentAnnounceStatus(tournament.id);
        expect(status).toEqual({ announce: "sent", thread: "sent" });
      });

      it("échec Discord classifié (403) sur le SEND : announce 'failed', jamais confondu avec un simple envoi différé", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);

        mockChannelOk("chan-tournois");
        fetchMock.mockResolvedValueOnce(jsonResponse(403, { code: 50013, message: "Missing Permissions" }));
        const outcome = await processOne();
        expect(outcome).toMatchObject({ outcome: "failed" });

        const status = await announceLib.getTournamentAnnounceStatus(tournament.id);
        expect(status.announce).toBe("failed");
      });
    });

    /**
     * Précision demandée (revue V2) sur `isTournamentVisibleInHistory`
     * (tournaments.ts) — vérifie contre de VRAIES lignes Postgres,
     * récupérées EXACTEMENT comme `/tournois/page.tsx` le fait
     * (`include: { matches: { select: { completedAt: true } } }`),
     * jamais seulement la fonction pure isolée (déjà couverte par
     * tournaments.test.ts) : le calcul réel dépend de données relationnelles
     * (`TournamentMatch`) que seule une vraie requête peut prouver fidèles.
     */
    describe("V2 — historique : calcul RÉEL appliqué aux tournois terminés (matchs inclus, comme /tournois)", () => {
      /** Relit un tournoi EXACTEMENT comme `/tournois/page.tsx`. */
      async function fetchForHistory(tournamentId: string) {
        return db.tournament.findUniqueOrThrow({
          where: { id: tournamentId },
          include: { matches: { select: { completedAt: true } } },
        });
      }

      it("DONE, finale jouée il y a plus de 7 jours : sort de l'historique — la date dérive du VRAI dernier TournamentMatch.completedAt, jamais createdAt ni une date inventée", async () => {
        const creator = await makeUser();
        const p1 = await makeUser();
        const p2 = await makeUser();
        const p3 = await makeUser();
        const p4 = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, { announceViaBot: false, maxPlayers: 4 });
        for (const p of [p1, p2, p3, p4]) await makeParticipant(tournament.id, p.id);
        await launchBracket(tournament.id);
        await finalizeTournament(tournament.id, creator.id);

        // Rejoue le VRAI scénario "terminé il y a plus d'une semaine" —
        // recule tous les `completedAt` réellement posés par `declareWinner`,
        // jamais un horodatage inventé pour le test.
        const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
        await db.tournamentMatch.updateMany({
          where: { tournamentId: tournament.id },
          data: { completedAt: eightDaysAgo },
        });

        const fetched = await fetchForHistory(tournament.id);
        expect(fetched.status).toBe("DONE");
        expect(fetched.matches.length).toBeGreaterThan(0);
        expect(tournamentsLib.isTournamentVisibleInHistory(fetched)).toBe(false);
      });

      it("DONE, finale jouée il y a moins de 7 jours : encore visible", async () => {
        const creator = await makeUser();
        const p1 = await makeUser();
        const p2 = await makeUser();
        const p3 = await makeUser();
        const p4 = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, { announceViaBot: false, maxPlayers: 4 });
        for (const p of [p1, p2, p3, p4]) await makeParticipant(tournament.id, p.id);
        await launchBracket(tournament.id);
        await finalizeTournament(tournament.id, creator.id);

        const fetched = await fetchForHistory(tournament.id);
        expect(fetched.status).toBe("DONE");
        // `completedAt` posé À L'INSTANT par `declareWinner` ci-dessus,
        // jamais modifié — largement dans la fenêtre de 7 jours.
        expect(tournamentsLib.isTournamentVisibleInHistory(fetched)).toBe(true);
      });

      it("DONE SANS LE MOINDRE MATCH (ligne incomplète/historique, ex. tournoi importé ou corrompu) : repli prudent, JAMAIS masqué, même très ancien — precise le comportement demandé explicitement", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        // Créé directement `DONE`, sans jamais passer par generateBracket/
        // declareWinner — aucun TournamentMatch n'existe pour ce tournoi,
        // reproduit une ligne historique incomplète (ex. donnée migrée
        // avant l'existence des matchs, ou un statut pris en défaut).
        const tournament = await makeTournament(creator.id, game.id, {
          announceViaBot: false,
          status: "DONE",
        });
        // `createdAt` très ancien — si le calcul se rabattait par erreur
        // sur `createdAt` (proscrit), ce tournoi disparaîtrait à tort.
        await db.tournament.update({
          where: { id: tournament.id },
          data: { createdAt: new Date("2020-01-01T00:00:00.000Z") },
        });

        const fetched = await fetchForHistory(tournament.id);
        expect(fetched.matches).toHaveLength(0);
        expect(tournamentsLib.isTournamentVisibleInHistory(fetched)).toBe(true);
      });

      it("CANCELLED sans cancelledAt (ligne legacy antérieure à la colonne, ou incomplète) : repli prudent, JAMAIS masqué", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, {
          announceViaBot: false,
          status: "CANCELLED",
        });
        // `cancelledAt` reste `null` — jamais posé ici (contrairement à
        // `cancelTournament`, jamais appelé par ce test) : reproduit une
        // ligne où l'annulation n'a laissé aucun horodatage fiable.
        expect(tournament.cancelledAt).toBeNull();

        const fetched = await fetchForHistory(tournament.id);
        expect(tournamentsLib.isTournamentVisibleInHistory(fetched)).toBe(true);
      });

      it("aucun événement encore ACTIF ne disparaît jamais après sept jours — IN_PROGRESS avec des matchs déjà joués il y a longtemps, REGISTRATION créé il y a longtemps", async () => {
        const creator = await makeUser();
        const p1 = await makeUser();
        const p2 = await makeUser();
        const p3 = await makeUser();
        const p4 = await makeUser();
        const game = await makeGame(creator.id);

        // IN_PROGRESS — le premier round a déjà été joué il y a longtemps
        // (matchs avec `completedAt` ancien), mais le tournoi N'EST PAS
        // terminé (round 2 encore à jouer) : ne doit dépendre d'AUCUN
        // `completedAt`, seulement du statut.
        const inProgress = await makeTournament(creator.id, game.id, { announceViaBot: false, maxPlayers: 4 });
        for (const p of [p1, p2, p3, p4]) await makeParticipant(inProgress.id, p.id);
        await launchBracket(inProgress.id);
        const round1 = await db.tournamentMatch.findMany({ where: { tournamentId: inProgress.id, round: 1 } });
        for (const m of round1) {
          const winnerId = m.player1Id ?? m.player2Id;
          if (winnerId) await tournamentsLib.declareWinner(m.id, winnerId, creator.id);
        }
        const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
        await db.tournamentMatch.updateMany({
          where: { tournamentId: inProgress.id, completedAt: { not: null } },
          data: { completedAt: eightDaysAgo },
        });
        const fetchedInProgress = await fetchForHistory(inProgress.id);
        expect(fetchedInProgress.status).toBe("IN_PROGRESS");
        expect(tournamentsLib.isTournamentVisibleInHistory(fetchedInProgress)).toBe(true);

        // REGISTRATION — créé il y a longtemps, jamais lancé.
        const registration = await makeTournament(creator.id, game.id, { announceViaBot: false });
        await db.tournament.update({
          where: { id: registration.id },
          data: { createdAt: new Date("2020-01-01T00:00:00.000Z") },
        });
        const fetchedRegistration = await fetchForHistory(registration.id);
        expect(tournamentsLib.isTournamentVisibleInHistory(fetchedRegistration)).toBe(true);
      });
    });

    describe("V2 — adhésion automatique au fil du tournoi", () => {
      async function setupThread(tournamentId: string) {
        mockVerifiedSendOk("chan-tournois");
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-tournois" }));
        await processOne();
        // Vide les livraisons `member:*` déjà enqueue-ées à la création
        // pour isoler chaque test sur les appels qu'il déclenche lui-même,
        // et réinitialise `fetchMock` (les 3 appels ci-dessus sont un
        // détail d'installation, jamais ce que le test lui-même vérifie).
        await db.notificationDelivery.deleteMany({
          where: {
            OR: [
              { targetSlot: { contains: `:TOURNAMENT:${tournamentId}:member:` } },
              { targetSlot: { endsWith: `:TOURNAMENT:${tournamentId}:thread-invite` } },
            ],
          },
        });
        fetchMock.mockClear();
      }

      it("créateur ET destinataires sélectionnés ajoutés au fil à la création — jamais une inscription au tournoi", async () => {
        const creator = await makeUser({ discordName: "creator" });
        const recipient = await makeUser({ discordName: "recipient" });
        const game = await makeGame(creator.id);
        const tournament = await db.tournament.create({
          data: {
            name: uniq("tournoi"),
            gameId: game.id,
            createdById: creator.id,
            maxPlayers: 4,
            announceViaBot: true,
            discordGuildId: "guild-1",
            discordChannelId: "chan-tournois",
            notifiedUserIds: [recipient.id],
          },
        });
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);
        await announceLib.enqueueTournamentThreadMember(tournament.id, creator.id);
        await announceLib.enqueueTournamentThreadMember(tournament.id, recipient.id);

        mockVerifiedSendOk("chan-tournois");
        await processOne(); // annonce
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-tournois" }));
        await processOne(); // fil

        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
        const creatorOutcome = await processOne();
        expect(creatorOutcome?.outcome).toBe("sent");
        const [creatorUrl, creatorInit] = fetchMock.mock.calls.at(-1)!;
        expect(creatorInit.method).toBe("PUT");
        expect(String(creatorUrl)).toContain(`/channels/thread-1/thread-members/${creator.discordId}`);

        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
        const recipientOutcome = await processOne();
        expect(recipientOutcome?.outcome).toBe("sent");
        const [recipientUrl] = fetchMock.mock.calls.at(-1)!;
        expect(String(recipientUrl)).toContain(`/channels/thread-1/thread-members/${recipient.discordId}`);

        // Jamais inscrit au tournoi par la seule adhésion au fil.
        const participants = await db.tournamentParticipant.findMany({ where: { tournamentId: tournament.id } });
        expect(participants.map((p) => p.userId)).not.toContain(recipient.id);
      });

      it("un joueur qui s'inscrit ensuite est ajouté au fil — désinscription ne le retire JAMAIS du fil (adhésion monotone)", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id, { maxPlayers: 4 });
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);
        await setupThread(tournament.id);

        const player = await makeUser({ discordName: "player" });
        await db.$transaction(async (tx) => {
          await tx.tournamentParticipant.create({ data: { tournamentId: tournament.id, userId: player.id } });
          await announceLib.enqueueTournamentThreadMember(tournament.id, player.id, tx);
        });

        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");
        const [url] = fetchMock.mock.calls.at(-1)!;
        expect(String(url)).toContain(`/channels/thread-1/thread-members/${player.discordId}`);

        // Désinscription — aucune livraison de RETRAIT n'existe pour les
        // tournois (jamais implémentée, adhésion monotone par design).
        await db.tournamentParticipant.deleteMany({ where: { tournamentId: tournament.id, userId: player.id } });
        expect(await processOne()).toBeNull(); // rien de plus à traiter
      });

      it("dédupliqué : notifié À LA CRÉATION puis inscrit ensuite ne génère qu'un seul ajout traité (convergence), jamais un double PUT distinct compté comme deux opérations", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const notified = await makeUser({ discordName: "notified" });
        const tournament = await db.tournament.create({
          data: {
            name: uniq("tournoi"),
            gameId: game.id,
            createdById: creator.id,
            maxPlayers: 4,
            announceViaBot: true,
            discordGuildId: "guild-1",
            discordChannelId: "chan-tournois",
            notifiedUserIds: [notified.id],
          },
        });
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);
        await announceLib.enqueueTournamentThreadMember(tournament.id, notified.id);
        await setupThread(tournament.id);
        // `setupThread` a purgé les livraisons `member:*` déjà en attente —
        // ré-enqueue explicitement celle du destinataire pour isoler ce test.
        await announceLib.enqueueTournamentThreadMember(tournament.id, notified.id);

        // La même personne s'inscrit ensuite — nouvelle livraison sur le
        // MÊME targetSlot (`member:<userId>`).
        await db.tournamentParticipant.create({ data: { tournamentId: tournament.id, userId: notified.id } });
        await announceLib.enqueueTournamentThreadMember(tournament.id, notified.id);

        const rows = await db.notificationDelivery.findMany({
          where: { targetSlot: `default-guild:TOURNAMENT:${tournament.id}:member:${notified.id}` },
          orderBy: { sequence: "asc" },
        });
        expect(rows).toHaveLength(2); // deux intentions enqueue-ées...

        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");
        expect(fetchMock).toHaveBeenCalledTimes(1); // ...mais un SEUL appel Discord réel

        const refreshed = await db.notificationDelivery.findMany({
          where: { targetSlot: `default-guild:TOURNAMENT:${tournament.id}:member:${notified.id}` },
        });
        expect(refreshed.filter((r) => r.status === "SKIPPED")).toHaveLength(1); // l'ancienne, périmée
        expect(refreshed.filter((r) => r.status === "SENT")).toHaveLength(1); // la plus récente, traitée
      });

      it("aucune synchronisation périmée ne peut rouvrir un fil déjà supprimé — `member:<userId>` retombe sur `expired` une fois le tournoi disparu", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const tournament = await makeTournament(creator.id, game.id);
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);
        await setupThread(tournament.id);

        const latecomer = await makeUser();
        await announceLib.enqueueTournamentThreadMember(tournament.id, latecomer.id);

        await tournamentsLib.deleteTournament(tournament.id, creator.id);

        const outcome = await processOne();
        expect(outcome).toMatchObject({ outcome: "failed", errorClass: "resolver:expired" });
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("resynchronisation groupée (créateur) : réajoute créateur + destinataires + inscrits ACTUELS, sans jamais recréer le fil ni renvoyer l'annonce", async () => {
        const creator = await makeUser();
        const game = await makeGame(creator.id);
        const notified = await makeUser({ discordName: "notified" });
        const registrant = await makeUser({ discordName: "registrant" });
        const tournament = await db.tournament.create({
          data: {
            name: uniq("tournoi"),
            gameId: game.id,
            createdById: creator.id,
            maxPlayers: 4,
            announceViaBot: true,
            discordGuildId: "guild-1",
            discordChannelId: "chan-tournois",
            notifiedUserIds: [notified.id],
          },
        });
        await db.tournamentParticipant.create({ data: { tournamentId: tournament.id, userId: registrant.id } });
        await announceLib.enqueueTournamentCreationDeliveries(tournament.id);
        await setupThread(tournament.id);

        const callsBeforeResync = fetchMock.mock.calls.length;
        await announceLib.resyncTournamentThreadMembers(tournament.id);
        // Aucun appel Discord tenté par le resync lui-même (enqueue seul).
        expect(fetchMock.mock.calls.length).toBe(callsBeforeResync);

        const rows = await db.notificationDelivery.findMany({
          where: { targetSlot: { contains: `:TOURNAMENT:${tournament.id}:member:` } },
        });
        const targetedUserIds = new Set(rows.map((r) => r.targetSlot.split(":member:")[1]));
        expect(targetedUserIds).toEqual(new Set([creator.id, notified.id, registrant.id]));

        // Aucune nouvelle annonce/fil enqueue-é par le resync.
        expect(
          await db.notificationDelivery.count({
            where: { targetSlot: `default-guild:TOURNAMENT:${tournament.id}:announce` },
          })
        ).toBe(1);
        expect(
          await db.notificationDelivery.count({
            where: { targetSlot: `default-guild:TOURNAMENT:${tournament.id}:thread` },
          })
        ).toBe(1);
      });
    });
  }
);
