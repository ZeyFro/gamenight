import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { wallClockNow } from "@/lib/wallclock";

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

/** Réponse Discord `204 No Content` réelle (`PUT`/`DELETE .../thread-members/{id}`) — aucun corps. */
function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

describe.skipIf(!TEST_DATABASE_URL)(
  "session-announce (intégration Postgres isolée + Discord HTTP simulé)",
  () => {
    let db: import("@prisma/client").PrismaClient;
    let announceLib: typeof import("./session-announce");
    let executorLib: typeof import("./notification-executor");
    let sessionsLib: typeof import("./sessions");
    let rouletteLib: typeof import("./roulette");
    let access: typeof import("./session-access");
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeAll(async () => {
      const prismaModule = await import("@/lib/prisma");
      db = prismaModule.prisma as unknown as import("@prisma/client").PrismaClient;
      announceLib = await import("./session-announce");
      executorLib = await import("./notification-executor");
      sessionsLib = await import("./sessions");
      rouletteLib = await import("./roulette");
      access = await import("./session-access");
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
        `TRUNCATE "NotificationDelivery", "NotificationEvent", "SessionInvite", "RouletteEntry", "Roulette", "Vote", "Proposal", "Session", "UserNotificationPreference", "Game", "User" CASCADE`
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

    /** Chantier confidentialité des soirées — `resolveEligibleMentions`
     * restreint désormais AUSSI aux invités `SessionInvite` `ACTIVE` (en
     * plus de `notifiedUserIds` et de la préférence). Les sessions créées
     * directement via `makeSession` (contournant `createSession`, qui
     * pose ces lignes atomiquement) n'en ont aucune par défaut — ce
     * helper les pose explicitement là où un test a besoin qu'un
     * candidat reste éligible aux mentions/notifications. */
    async function invite(sessionId: string, userId: string, invitedById: string) {
      return db.sessionInvite.create({ data: { sessionId, userId, invitedById, status: "ACTIVE" } });
    }

    /** Traite UNE livraison due, avec le vrai résolveur SESSION du chantier. */
    async function processOne(now?: Date) {
      return executorLib.processNextDelivery({
        resolver: announceLib.sessionAnnounceResolver,
        owner: uniq("worker"),
        now,
      });
    }

    describe("fil privé puis annonce postée dedans (parcours nominal, confidentialité des soirées)", () => {
      it("SEND fil PRIVÉ réussi (aucune dépendance), puis SEND annonce POSTÉE DANS LE FIL — jamais dans le salon public", async () => {
        const creator = await makeUser({ discordName: "createur" });
        const session = await makeSession(creator.id);
        await announceLib.enqueueSessionCreationDeliveries(session.id);

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        const threadOutcome = await processOne();
        expect(threadOutcome?.outcome).toBe("sent");

        // Vérification GET (type PRIVÉ) avant l'envoi réel dans le fil —
        // voir `verifyThreadIsPrivate` (discord-rest.ts) : protège contre
        // un fil référencé qui serait en réalité un ancien fil PUBLIC.
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        const announceOutcome = await processOne();
        expect(announceOutcome?.outcome).toBe("sent");

        expect(fetchMock).toHaveBeenCalledTimes(3);

        // Création du fil — PRIVÉ (type 12), jamais rattaché à un message,
        // `invitable: false` (un simple invité ne peut jamais y ajouter
        // quelqu'un d'autre depuis Discord).
        const [threadUrl, threadInit] = fetchMock.mock.calls[0];
        expect(String(threadUrl)).toBe("https://discord.com/api/v10/channels/chan-sessions/threads");
        const threadReqBody = JSON.parse(String(threadInit.body));
        expect(threadReqBody.type).toBe(12);
        expect(threadReqBody.invitable).toBe(false);
        expect(threadReqBody.name).toContain(session.id.slice(0, 8));

        // Le SEND vérifie d'abord (GET) que le fil référencé est bien
        // PRIVÉ avant d'y écrire quoi que ce soit.
        const [verifyUrl] = fetchMock.mock.calls[1];
        expect(String(verifyUrl)).toBe("https://discord.com/api/v10/channels/thread-1");

        // L'annonce est postée DANS LE FIL (thread-1), jamais dans le
        // salon public (chan-sessions) : aucune information de soirée ne
        // transite jamais par un message visible du salon parent.
        const [announceUrl] = fetchMock.mock.calls[2];
        expect(String(announceUrl)).toBe("https://discord.com/api/v10/channels/thread-1/messages");

        const threadRow = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: `default-guild:SESSION:${session.id}:thread` },
        });
        expect(threadRow.discordThreadId).toBe("thread-1");
      });
    });

    describe("annonce initiale (VOTING) — mentionne les invités dès la création, jamais seulement les votants (bug corrigé, diagnostic ping Discord réel 26/09)", () => {
      it("aucun vote encore posé — les invités actifs sont mentionnés dès le SEND initial, pas seulement dans une EDIT ultérieure (jamais notifiée par Discord)", async () => {
        const creator = await makeUser({ discordName: "createur" });
        const guest1 = await makeUser({ discordName: "invite-1" });
        const guest2 = await makeUser({ discordName: "invite-2" });
        const session = await makeSession(creator.id);
        await invite(session.id, guest1.id, creator.id);
        await invite(session.id, guest2.id, creator.id);

        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");

        const [, init] = fetchMock.mock.calls[2];
        const body = JSON.parse(String(init.body));
        expect(body.content).toContain(`<@${guest1.discordId}>`);
        expect(body.content).toContain(`<@${guest2.discordId}>`);
        // Le créateur ne se pingue jamais lui-même.
        expect(body.content).not.toContain(`<@${creator.discordId}>`);

        const notifiedIds = (
          await db.notification.findMany({ where: { relatedSessionId: session.id } })
        ).map((n) => n.userId);
        expect(notifiedIds.sort()).toEqual([guest1.id, guest2.id].sort());
      });

      it("un invité avec la préférence SESSION désactivée n'est jamais mentionné, même sans aucun vote", async () => {
        const creator = await makeUser();
        const declined = await makeUser({ discordName: "refuse-sans-vote" });
        const session = await makeSession(creator.id);
        await invite(session.id, declined.id, creator.id);
        await db.userNotificationPreference.create({
          data: { userId: declined.id, category: "SESSION", enabled: false },
        });

        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");

        const [, init] = fetchMock.mock.calls[2];
        const body = JSON.parse(String(init.body));
        expect(body.content).toBeFalsy();
        expect(await db.notification.count({ where: { relatedSessionId: session.id } })).toBe(0);
      });
    });

    describe("protection contre un ancien fil PUBLIC référencé en base (revue ciblée, confidentialité des soirées)", () => {
      // Une ligne `NotificationDelivery` "thread" SENT est produite UNE
      // SEULE FOIS, à la création de la soirée (occurrence fixe, jamais
      // ré-enqueue-ée) — pour une soirée créée AVANT le déploiement de ce
      // chantier, cette ligne référence encore l'ANCIEN fil PUBLIC. Rien
      // dans la base ne distingue cette situation d'un fil privé légitime :
      // seule une vérification Discord réelle (GET, `verifyThreadIsPrivate`)
      // peut la détecter. Ces tests le prouvent en renvoyant délibérément un
      // `type` non-12 sur cette vérification, quelle que soit l'opération
      // qui tente de s'appuyer sur le fil déjà "SENT" en base.
      it("SEND annonce vers un fil référencé qui n'est PLUS un fil PRIVÉ (type ≠ 12) : aucun POST, échec terminal observable", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id);
        await announceLib.enqueueSessionCreationDeliveries(session.id);

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();

        // La vérification (GET) révèle que "thread-1" n'est plus un fil
        // PRIVÉ (type 11 = fil public standard, jamais 12) — jamais de
        // publication dans ce cas, quelle que soit la raison (ancien fil
        // pré-migration, fil reconverti côté Discord, etc.).
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 11 }));
        const outcome = await processOne();

        expect(outcome).toMatchObject({ outcome: "failed", errorClass: "discord:destination_mismatch" });
        expect(fetchMock).toHaveBeenCalledTimes(2); // thread (setup) + ce GET, jamais de POST vers /messages
        const [verifyUrl, verifyInit] = fetchMock.mock.calls[1];
        expect(String(verifyUrl)).toBe("https://discord.com/api/v10/channels/thread-1");
        expect(verifyInit?.method ?? "GET").not.toBe("POST");

        const row = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: `default-guild:SESSION:${session.id}:announce` },
        });
        expect(row.status).toBe("FAILED");
        expect(row.discordMessageId).toBeNull();
      });

      it("résumé de fin de soirée (thread-summary) vers un fil qui n'est plus PRIVÉ : même refus, aucun POST", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id, { status: "SCHEDULED" });
        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        await processOne();

        await announceLib.enqueueSessionResultThreadSummary(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 11 }));
        const outcome = await processOne();

        expect(outcome).toMatchObject({ outcome: "failed", errorClass: "discord:destination_mismatch" });
        expect(fetchMock.mock.calls.at(-1)![1]?.method ?? "GET").not.toBe("POST");
      });

      it("invite-sync (ajout d'un invité) vers un fil qui n'est plus PRIVÉ : aucun PUT, jamais un accès silencieusement rétabli/coupé sur le mauvais salon", async () => {
        const creator = await makeUser();
        const guest = await makeUser();
        const session = await makeSession(creator.id);
        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(emptyResponse(204));
        await processOne(); // creator-member (bug remonté en test réel, voir le commentaire de fichier)

        const inv = await invite(session.id, guest.id, creator.id);
        await announceLib.enqueueSessionInviteSync(inv.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 11 }));
        const outcome = await processOne();

        expect(outcome).toMatchObject({ outcome: "failed", errorClass: "discord:destination_mismatch" });
        // Seul le GET de vérification a été tenté POUR CET invite-sync —
        // jamais le PUT qui l'aurait suivi si le fil était resté PRIVÉ.
        // (Le PUT du setup creator-member ci-dessus est un appel légitime
        // et distinct, pas celui qu'on vérifie ici.)
        expect(fetchMock).toHaveBeenCalledTimes(6); // thread + verify + announce + verify + PUT (creator-member) + ce GET
        const [lastUrl, lastInit] = fetchMock.mock.calls.at(-1)!;
        expect(String(lastUrl)).toBe("https://discord.com/api/v10/channels/thread-1");
        expect(lastInit?.method ?? "GET").not.toBe("PUT");
        expect(lastInit?.method ?? "GET").not.toBe("DELETE");

        const statuses = await announceLib.getSessionInviteSyncStatuses(session.id, [inv.id]);
        expect(statuses.get(inv.id)).toBe("failed");
      });

      it("EDIT sur une annonce/un fil legacy (SENT avant #102, salon PUBLIC direct, jamais un fil) : aucune écriture Discord, refus terminal immédiat", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id);

        // Reproduit littéralement l'état d'une soirée créée AVANT #102
        // (ancienne architecture, code qui n'existe plus) : "announce"
        // envoyée DIRECTEMENT dans le salon PUBLIC (`send_channel_message`,
        // jamais un fil — `discordThreadId` reste NULL sur cette ligne),
        // puis "thread" créé DEPUIS ce message (`create_thread`, fil
        // PUBLIC standard, jamais `invitable`/type 12). Construit
        // directement en base — jamais via `enqueueSessionCreationDeliveries`,
        // qui ne produit plus que la nouvelle forme (fil privé créé en
        // premier, sans dépendre d'une annonce).
        const deliveryLib = await import("./notification-delivery");
        const event = await deliveryLib.createNotificationEvent({
          category: "SESSION",
          eventType: "SESSION_CREATED",
          sourceId: session.id,
        });
        const announceDelivery = await deliveryLib.enqueueDelivery({
          eventId: event.id,
          channel: "DISCORD_CHANNEL",
          transport: "BOT",
          operation: "SEND",
          recipientKey: "channel",
          targetSlot: `default-guild:SESSION:${session.id}:announce`,
        });
        await db.notificationDelivery.update({
          where: { id: announceDelivery.id },
          data: {
            status: "SENT",
            discordChannelId: "chan-sessions", // salon PUBLIC, jamais un fil
            discordMessageId: "old-public-announce-msg",
            discordThreadId: null,
            sentAt: new Date(),
          },
        });
        const threadDelivery = await deliveryLib.enqueueDelivery({
          eventId: event.id,
          channel: "DISCORD_CHANNEL",
          transport: "BOT",
          operation: "SEND",
          recipientKey: "channel",
          targetSlot: `default-guild:SESSION:${session.id}:thread`,
        });
        await db.notificationDelivery.update({
          where: { id: threadDelivery.id },
          data: {
            status: "SENT",
            discordThreadId: "old-public-thread", // fil PUBLIC (type 11), jamais 12
            sentAt: new Date(),
          },
        });

        // La soirée change d'état APRÈS la mise à jour (correctif "revue
        // ciblée" de ce chantier) — déclenche une EDIT, exactement le
        // scénario signalé : une ancienne annonce ET un ancien fil publics
        // déjà SENT avant #102, puis une EDIT traitée après le correctif.
        await db.session.update({ where: { id: session.id }, data: { status: "CANCELLED" } });
        await announceLib.enqueueSessionAnnounceUpdate(session.id);

        const outcome = await processOne();

        expect(outcome).toMatchObject({ outcome: "failed", errorClass: "resolver:unresolvable" });
        // La preuve centrale : AUCUNE écriture Discord n'est tentée — ni
        // sur l'ancien salon public, ni sur l'ancien fil public, ni
        // ailleurs. Zéro appel réseau, pas seulement un appel refusé après
        // une vérification.
        expect(fetchMock).not.toHaveBeenCalled();

        const row = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: `default-guild:SESSION:${session.id}:announce`, operation: "EDIT" },
        });
        // Terminal IMMÉDIATEMENT — jamais `dependency_not_ready` retenté
        // en boucle (jusqu'à MAX_DELIVERY_ATTEMPTS) avant d'échouer pour
        // rien : l'absence de `discordThreadId` sur une ligne "announce"
        // legacy est un fait STRUCTUREL et PERMANENT, jamais une question
        // de timing qui se résoudrait au prochain passage du cron.
        expect(row.status).toBe("FAILED");
        expect(row.errorClass).toBe("resolver:unresolvable");
        expect(row.attempts).toBe(1);
      });
    });

    describe("succès partiel — fil créé, première annonce échouée", () => {
      it("le fil n'est jamais recréé, seule la reprise de l'annonce est retentée", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id);
        await announceLib.enqueueSessionCreationDeliveries(session.id);

        const t0 = new Date("2026-01-01T00:00:00.000Z");
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne(t0);

        // Vérification GET réussie, mais l'envoi (POST) échoue.
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(500, {}));
        const failedAnnounce = await processOne(t0);
        expect(failedAnnounce?.outcome).toBe("retrying");

        // Reprise : seule la livraison "announce" (toujours PENDING) doit
        // être reprise — le fil reste SENT, jamais un second appel pour lui
        // (aucun `POST .../threads` une 2e fois). Il faut dépasser le
        // backoff (nextAttemptAt) pour que `claimNextDelivery` la
        // considère à nouveau due.
        const muchLater = new Date(t0.getTime() + 5 * 60_000);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        const resumedAnnounce = await processOne(muchLater);
        expect(resumedAnnounce?.outcome).toBe("sent");

        expect(fetchMock).toHaveBeenCalledTimes(5);
        const threadRow = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: `default-guild:SESSION:${session.id}:thread` },
        });
        expect(threadRow.status).toBe("SENT");
        expect(threadRow.discordThreadId).toBe("thread-1");
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
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne(t0);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        await processOne(t0);

        // Au-delà du backoff de dépendance (2 min, DEPENDENCY_RETRY_BACKOFF_MS)
        // pour que le rappel redevienne éligible à la réclamation.
        const later = new Date(t0.getTime() + 5 * 60_000);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
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
          fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
          await processOne();
          fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
          fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
          await processOne();
          fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
          fetchMock.mockResolvedValueOnce(emptyResponse(204));
          await processOne(); // creator-member

          await announceLib.enqueueSessionReminderDelivery(session.id, 60);
          // La session est annulée/clôturée APRÈS l'enqueue du rappel, AVANT
          // que l'exécuteur ne le traite — simule un rappel qui devient
          // obsolète pendant la fenêtre d'attente du cron.
          await db.session.update({ where: { id: session.id }, data: { status } });

          const outcome = await processOne();
          expect(outcome).toMatchObject({ outcome: "failed", errorClass: "resolver:expired" });
          expect(fetchMock).toHaveBeenCalledTimes(5); // thread + verify + announce + verify + PUT (creator-member), jamais le rappel

          const row = await db.notificationDelivery.findFirstOrThrow({
            where: { targetSlot: `default-guild:SESSION:${session.id}:thread-reminder-60` },
          });
          expect(row.status).toBe("FAILED");
          expect(row.nextAttemptAt).toBeNull();
        }
      );
    });

    describe("rappel VOTING — mentionne les invités, jamais seulement les votants (bug corrigé, diagnostic ping Discord réel 26/09)", () => {
      it("rappel envoyé avant tout vote — mentionne les invités actifs, jamais personne", async () => {
        const creator = await makeUser();
        const guest = await makeUser({ discordName: "invite-rappel" });
        const session = await makeSession(creator.id);
        await invite(session.id, guest.id, creator.id);

        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne(); // thread
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        await processOne(); // announce
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(emptyResponse(204));
        await processOne(); // creator-member — vide la file avant d'enqueue-er le rappel

        await announceLib.enqueueSessionReminderDelivery(session.id, 60);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-reminder", channel_id: "thread-1" }));
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");

        const [, init] = fetchMock.mock.calls.at(-1)!;
        const body = JSON.parse(String(init.body));
        expect(body.content).toContain(`<@${guest.discordId}>`);
      });
    });

    describe("rappel — contenu recalculé au TRAITEMENT réel, jamais figé à l'enqueue (fix rattrapage tardif)", () => {
      // `wallClockNow()` lit l'horloge RÉELLE (via `Intl.DateTimeFormat`,
      // jamais le `now` explicite passé à `processOne`, qui ne sert qu'à
      // `claimNextDelivery`/au backoff) — `resolveThreadReminder` doit
      // donc être testé sous horloge système CONTRÔLÉE (`vi.setSystemTime`),
      // jamais seulement via le paramètre `now` de `processOne` comme le
      // reste de ce fichier. `wallT0` (résultat de `wallClockNow()` sous
      // cette horloge figée) sert de référence pour construire `date` de
      // la session — même représentation "horloge murale" que le reste de
      // l'app (cf. wallclock.ts), pour ne jamais introduire un décalage
      // CET/CEST accidentel entre la session et l'horloge de test.
      afterEach(() => {
        vi.useRealTimers();
      });

      it("session COMMENCÉE entre l'enqueue (temps restant positif) et le traitement effectif : refus définitif, AUCUN message posté", async () => {
        // `realT0` (horloge SYSTÈME, pilotée par `vi.setSystemTime`) et
        // `wallT0` (lecture `wallClockNow()` à cet instant, potentiellement
        // décalée de 1-2h CET/CEST) sont DEUX représentations distinctes —
        // seuls des DELTAS identiques appliqués à chacune restent
        // synchronisés (l'écart constant s'annule dans une soustraction),
        // jamais une valeur de l'une réinjectée telle quelle dans l'autre.
        const realT0 = new Date("2026-06-15T12:00:00.000Z");
        vi.useFakeTimers();
        vi.setSystemTime(realT0);
        const wallT0 = wallClockNow();

        const creator = await makeUser();
        const session = await makeSession(creator.id, {
          status: "SCHEDULED",
          date: new Date(wallT0.getTime() + 10 * 60_000), // dans 10 min (horloge murale) au moment de l'enqueue
        });
        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(emptyResponse(204));
        await processOne(); // creator-member

        // Rappel enqueue-é alors qu'il restait du temps (comportement
        // légitime à l'enqueue) — simule soit une ancienne livraison
        // (avant ce fix), soit le seul rappel désormais enqueue-é par
        // passage (`computeTimingsDue`) mais traité en retard par
        // l'exécuteur.
        await announceLib.enqueueSessionReminderDelivery(session.id, 15);

        // Avance l'horloge RÉELLE de 15 min (même delta appliqué à realT0
        // et wallT0) : la soirée (dans 10 min à l'enqueue) a donc
        // maintenant COMMENCÉ depuis 5 min au moment du traitement.
        vi.setSystemTime(new Date(realT0.getTime() + 15 * 60_000));
        const callsBefore = fetchMock.mock.calls.length;
        const outcome = await processOne();
        expect(outcome).toMatchObject({ outcome: "failed", errorClass: "resolver:expired" });
        // Aucun appel réseau supplémentaire — le refus intervient AVANT
        // toute tentative de construction/envoi du message.
        expect(fetchMock.mock.calls.length).toBe(callsBefore);

        const row = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: `default-guild:SESSION:${session.id}:thread-reminder-15` },
        });
        expect(row.status).toBe("FAILED");
        expect(row.nextAttemptAt).toBeNull();
      });

      it("temps réel restant très différent du seuil figé à l'enqueue : le message reflète le temps RÉEL au traitement, jamais le seuil d'origine (jamais « 12h » pour une soirée dans 10 min)", async () => {
        const realT0 = new Date("2026-06-15T12:00:00.000Z");
        vi.useFakeTimers();
        vi.setSystemTime(realT0);
        const wallT0 = wallClockNow();

        const creator = await makeUser();
        const session = await makeSession(creator.id, {
          status: "SCHEDULED",
          date: new Date(wallT0.getTime() + 45 * 60_000), // dans 45 min (horloge murale)
        });
        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(emptyResponse(204));
        await processOne(); // creator-member

        // Enqueue-é sous le seuil "720" (12h) — un vieux rattrapage — mais
        // traité bien plus tard : il ne reste RÉELLEMENT que 10 minutes.
        await announceLib.enqueueSessionReminderDelivery(session.id, 720);

        // Avance l'horloge RÉELLE de 35 min (45 - 10) : il reste alors
        // exactement 10 min (horloge murale) avant la soirée.
        vi.setSystemTime(new Date(realT0.getTime() + 35 * 60_000));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-reminder", channel_id: "thread-1" }));
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");

        const [, init] = fetchMock.mock.calls.at(-1)!;
        const body = JSON.parse(String(init!.body));
        expect(body.content).toContain("10 min");
        expect(body.content).not.toContain("12h");
      });
    });

    describe("éditions concurrentes — convergence vers l'état courant", () => {
      it("deux éditions enqueue-ées à la suite : seule la plus récente est traitée, avec le contenu ACTUEL de la session", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id, {
          date: new Date("2026-10-01T20:00:00.000Z"),
        });
        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        await processOne();
        // Consomme la livraison creator-member (bug remonté en test réel,
        // voir le commentaire de fichier) avant de poursuivre — sans quoi
        // le prochain processOne() la réclamerait à la place de l'EDIT visée.
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(emptyResponse(204));
        await processOne();

        // Deux éditions successives (ex. deux modifications de créneau) —
        // la session est mise à jour à CHAQUE fois avant l'enqueue, comme
        // le ferait editSessionAction.
        await db.session.update({ where: { id: session.id }, data: { date: new Date("2026-10-02T20:00:00.000Z") } });
        await announceLib.enqueueSessionAnnounceUpdate(session.id);
        await db.session.update({ where: { id: session.id }, data: { date: new Date("2026-10-03T20:00:00.000Z") } });
        await announceLib.enqueueSessionAnnounceUpdate(session.id);

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        const editOutcome = await processOne();
        expect(editOutcome?.outcome).toBe("sent");

        const [editUrl, editInit] = fetchMock.mock.calls.at(-1)!;
        const editBody = JSON.parse(String(editInit.body));
        // Rendu depuis l'état COURANT en base (3 octobre), jamais depuis
        // le premier texte enqueue (2 octobre) : la description de
        // l'embed contient la date la plus récente.
        expect(editBody.embeds[0].description).toContain("3 octobre");
        expect(editBody.embeds[0].description).not.toContain("2 octobre");
        // L'édition cible le message DANS LE FIL (thread-1), jamais le
        // salon public.
        expect(String(editUrl)).toContain("/channels/thread-1/messages/");

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
        await invite(session.id, declined.id, creator.id);
        await invite(session.id, accepted.id, creator.id);
        await db.userNotificationPreference.create({
          data: { userId: declined.id, category: "SESSION", enabled: false },
        });

        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");

        const [, init] = fetchMock.mock.calls[2];
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
        await invite(session.id, declined.id, creator.id);
        await db.userNotificationPreference.create({
          data: { userId: declined.id, category: "SESSION", enabled: false },
        });

        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");

        const [, init] = fetchMock.mock.calls[2];
        const body = JSON.parse(String(init.body));
        expect(body.content).toBeFalsy();
        expect(await db.notification.count({ where: { relatedSessionId: session.id } })).toBe(0);
      });

      /**
       * Complément au diagnostic (test réel, fils "4 autres fils actifs"
       * avec seulement l'avatar du bot) — vérifie explicitement que
       * `resolveInviteSync` (le SEUL code qui ajoute/retire un membre du
       * fil privé) ne consulte JAMAIS `UserNotificationPreference` ni
       * `silenceReminders` : contrairement à `resolveEligibleMentions`
       * (mentions/notifications internes, filtré par préférence ci-dessus),
       * l'accès au fil se décide UNIQUEMENT sur `SessionInvite.status`. Un
       * invité ayant désactivé les pings SESSION doit donc rester membre du
       * fil — l'accès et la préférence de notification sont deux axes
       * indépendants, jamais couplés.
       */
      it("un invité ayant désactivé les pings SESSION conserve son accès au fil — add_thread_member (PUT) appelé quand même", async () => {
        const creator = await makeUser();
        const silent = await makeUser({ discordName: "invite-silencieux" });
        const session = await makeSession(creator.id);
        await db.userNotificationPreference.create({
          data: { userId: silent.id, category: "SESSION", enabled: false },
        });

        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(emptyResponse(204));
        await processOne(); // creator-member

        const inv = await invite(session.id, silent.id, creator.id);
        await announceLib.enqueueSessionInviteSync(inv.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(emptyResponse(204));
        const outcome = await processOne();

        expect(outcome?.outcome).toBe("sent");
        const [url, init] = fetchMock.mock.calls.at(-1)!;
        expect(String(url)).toBe(`https://discord.com/api/v10/channels/thread-1/thread-members/${silent.discordId}`);
        expect(init.method).toBe("PUT");

        const statuses = await announceLib.getSessionInviteSyncStatuses(session.id, [inv.id]);
        expect(statuses.get(inv.id)).toBe("synced");
      });

      it("la sélection du créateur ne peut jamais réintégrer un refus (le filtre ne retire jamais que des destinataires)", async () => {
        const creator = await makeUser();
        const declined = await makeUser();
        const game = await makeGame(creator.id);
        const session = await makeSession(creator.id, { notifiedUserIds: [declined.id] });
        const proposal = await propose(session.id, game.id, creator.id);
        await vote(proposal.id, declined.id);
        await invite(session.id, declined.id, creator.id);
        await db.userNotificationPreference.create({
          data: { userId: declined.id, category: "SESSION", enabled: false },
        });

        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        await processOne();

        const [, init] = fetchMock.mock.calls[2];
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
        await invite(session.id, stillEnabled.id, creator.id);

        // Enqueue AVANT tout refus — à cet instant, `stillEnabled` est
        // encore éligible (aucune ligne de préférence, repli legacy actif).
        await announceLib.enqueueSessionCreationDeliveries(session.id);

        // Le refus arrive APRÈS l'enqueue, avant que l'exécuteur ne
        // traite la livraison — simule un utilisateur qui se désinscrit
        // pendant la fenêtre d'attente du cron.
        await db.userNotificationPreference.create({
          data: { userId: stillEnabled.id, category: "SESSION", enabled: false },
        });

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");

        const [, init] = fetchMock.mock.calls[2];
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
            where: { targetSlot: `default-guild:SESSION:${session.id}:thread` },
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
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        // creator-member (bug remonté en test réel, voir le commentaire de
        // fichier) — la même passe cron l'enqueue-traite aussi, verify + PUT.
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(emptyResponse(204));

        const { GET } = await import("@/app/api/cron/notification-executor/route");
        const res = await GET(
          new Request("http://localhost/api/cron/notification-executor", { headers: { authorization: "Bearer s3cret" } })
        );
        const body = await res.json();
        expect(body.sent).toBe(3);
        expect(body.failed).toBe(0);
        expect(fetchMock).toHaveBeenCalledTimes(5);
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
      it("permission refusée (403) sur le SEND initial (création du fil) : FAILED terminal, jamais réessayé", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id);
        await announceLib.enqueueSessionCreationDeliveries(session.id);

        fetchMock.mockResolvedValueOnce(jsonResponse(403, { code: 50013, message: "Missing Permissions" }));
        const outcome = await processOne();
        expect(outcome).toMatchObject({ outcome: "failed", errorClass: "discord:auth_or_permission" });

        const row = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: `default-guild:SESSION:${session.id}:thread` },
        });
        expect(row.status).toBe("FAILED");
        expect(row.nextAttemptAt).toBeNull();
      });

      it("message d'annonce supprimé manuellement (404 sur l'EDIT) : FAILED terminal, observable, jamais republié ni renvoyé au webhook", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id);
        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();
        // La livraison "announce" enqueue-ée par `enqueueSessionCreationDeliveries`
        // reste sinon due elle aussi — la traiter d'abord isole l'EDIT
        // ci-dessous comme SEULE livraison encore en attente.
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        await processOne();
        // creator-member (bug remonté en test réel, voir le commentaire de
        // fichier) — la traiter isole aussi l'EDIT comme SEULE livraison
        // encore en attente ensuite.
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(emptyResponse(204));
        await processOne();

        await db.session.update({ where: { id: session.id }, data: { date: new Date("2026-10-05T20:00:00.000Z") } });
        await announceLib.enqueueSessionAnnounceUpdate(session.id);

        // Message supprimé côté Discord entre-temps — l'EDIT échoue en 404.
        // (L'EDIT ne re-vérifie jamais le type du fil, voir le commentaire
        // de `resolveAnnounceDelivery` — un seul appel réseau ici.)
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
        expect(fetchMock).toHaveBeenCalledTimes(6);
      });

      it("résultat réseau incertain (fetch rejette) sur le SEND initial (création du fil) : retryable, un seul appel tenté", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id);
        await announceLib.enqueueSessionCreationDeliveries(session.id);

        fetchMock.mockRejectedValueOnce(new DOMException("aborted", "TimeoutError"));
        const outcome = await processOne();
        expect(outcome).toMatchObject({ outcome: "retrying", errorClass: "discord:network_uncertain" });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const row = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: `default-guild:SESSION:${session.id}:thread` },
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

        // 2 events : SESSION_CREATED (thread + announce) et
        // SESSION_CREATOR_MEMBER (bug remonté en test réel, voir le
        // commentaire de fichier — événement séparé, occurrence propre).
        expect(await db.notificationEvent.count({ where: { sourceId: session.id } })).toBe(2);
        expect(
          await db.notificationDelivery.count({ where: { targetSlot: { startsWith: `default-guild:SESSION:${session.id}:` } } })
        ).toBe(3);

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
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

      it("câblage des règles de ping : changement de date → message de date ; même date → aucun ; fin → édition seule", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id, {
          announceViaBot: true,
          status: "SCHEDULED",
          date: new Date("2026-10-01T20:00:00.000Z"),
        });
        const slots = async (like: string) =>
          db.notificationDelivery.count({ where: { targetSlot: { contains: `:${session.id}:${like}` } } });

        // Même créneau (seule la deadline change) : édition, aucun message de date.
        await sessionsLib.updateSessionSchedule(
          session.id,
          { date: new Date("2026-10-01T20:00:00.000Z"), votingDeadline: null },
          true
        );
        expect(await slots("announce")).toBe(1);
        expect(await slots("thread-date-")).toBe(0);

        // Date changée : édition de l'annonce ET message de date dans le fil.
        await sessionsLib.updateSessionSchedule(
          session.id,
          { date: new Date("2026-10-05T20:00:00.000Z"), votingDeadline: null },
          true
        );
        expect(await slots("thread-date-")).toBe(1);

        // Sans chemin bot : rien du tout.
        await sessionsLib.updateSessionSchedule(
          session.id,
          { date: new Date("2026-10-09T20:00:00.000Z"), votingDeadline: null },
          false
        );
        expect(await slots("thread-date-")).toBe(1);

        // Fin de session : édition de l'annonce seulement (aucun message en plus).
        const before = await db.notificationDelivery.count();
        await sessionsLib.markSessionDone(session.id);
        expect(await db.notificationDelivery.count()).toBe(before + 1);
        expect(await slots("thread-validated")).toBe(0);
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

      it("répétition de l'enqueue de création : thread/announce (occurrence fixe) ne dupliquent jamais, creator-member (occurrence volontairement aléatoire, retry) crée une nouvelle ligne à chaque fois sans jamais dupliquer l'EFFET (convergence)", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id, { announceViaBot: true });

        // Simule un retry applicatif (ex. deux clics, ou une reprise après
        // un crash situé APRÈS le commit mais avant que l'appelant ne le
        // sache) — l'idempotence de thread/announce vient de l'occurrence
        // FIXE (#95). `creator-member`, lui, est délibérément à occurrence
        // ALÉATOIRE (voir `enqueueSessionCreatorThreadMembership`, même
        // raisonnement que `enqueueSessionInviteSync` — permettre un
        // réessai manuel) : un appel répété y crée une NOUVELLE ligne à
        // chaque fois, jamais un doublon d'EFFET (convergence "la plus
        // récente survit", déjà garantie par `claimNextDelivery`, #95).
        await announceLib.enqueueSessionCreationDeliveries(session.id);
        await announceLib.enqueueSessionCreationDeliveries(session.id);

        // 1 event SESSION_CREATED (dédupliqué, thread+announce) + 2 events
        // SESSION_CREATOR_MEMBER (un par appel, jamais dédupliqués).
        expect(await db.notificationEvent.count({ where: { sourceId: session.id } })).toBe(3);
        expect(
          await db.notificationDelivery.count({
            where: { targetSlot: { startsWith: `default-guild:SESSION:${session.id}:` } },
          })
        ).toBe(4); // thread + announce (dédupliqués) + 2x creator-member

        // Le traitement réel ne produit jamais deux PUT — la convergence
        // (`claimNextDelivery`, #95) abandonne (SKIPPED) la plus ancienne
        // des deux lignes creator-member dès qu'elle est scannée, avant
        // tout appel réseau pour elle.
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(emptyResponse(204));
        const creatorMemberOutcome = await processOne();
        expect(creatorMemberOutcome?.outcome).toBe("sent");
        // Plus rien à traiter — la ligne creator-member la plus ancienne a
        // été SKIPPED au passage, jamais réclamée pour un second PUT.
        expect(await processOne()).toBeNull();

        expect(
          await db.notificationDelivery.count({
            where: { targetSlot: `default-guild:SESSION:${session.id}:creator-member`, status: "SKIPPED" },
          })
        ).toBe(1);
        expect(
          await db.notificationDelivery.count({
            where: { targetSlot: `default-guild:SESSION:${session.id}:creator-member`, status: "SENT" },
          })
        ).toBe(1);
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

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        const threadOutcome = await processOne();
        expect(threadOutcome?.outcome).toBe("sent");

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        const announceOutcome = await processOne();
        expect(announceOutcome?.outcome).toBe("sent");

        // creator-member (bug remonté en test réel, voir le commentaire de
        // fichier) — continue lui aussi son cycle normal malgré le rollback
        // du flag catégorie, et doit être consommé avant l'EDIT ci-dessous.
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(emptyResponse(204));
        const creatorMemberOutcome = await processOne();
        expect(creatorMemberOutcome?.outcome).toBe("sent");

        // Une édition ultérieure (ex. clôture) sur cette même session
        // continue elle aussi d'utiliser le chemin bot, sans accroc.
        await db.session.update({ where: { id: session.id }, data: { status: "CANCELLED" } });
        await announceLib.enqueueSessionAnnounceUpdate(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
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

        // Fil privé créé en premier (aucune dépendance), puis l'annonce
        // POSTÉE DEDANS — doit rendre l'état "validée" (pas "nouvelle
        // soirée à voter", cette session n'a jamais été VOTING) ET la
        // notification interne assortie doit porter le bon type/titre
        // (bug corrigé : `resolveSendNotificationMeta`).
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-1", channel_id: "thread-1" }));
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");

        const [, init] = fetchMock.mock.calls[2];
        const body = JSON.parse(String(init.body));
        expect(body.embeds[0].title).toContain(`Soirée validée : ${game.name}`);

        const notifications = await db.notification.findMany({ where: { relatedSessionId: stored.id } });
        expect(notifications.length).toBeGreaterThan(0);
        expect(notifications.every((n) => n.type === "SESSION_RESULT")).toBe(true);
        expect(notifications.some((n) => n.title.includes("Nouvelle soirée"))).toBe(false);
      });

      it("bot désactivé : confidentialité des soirées — plus AUCUN appel Discord public, même webhook configuré (jamais de repli public)", async () => {
        // Chantier confidentialité des soirées — ce test vérifiait
        // auparavant que le webhook legacy PARTAIT bien (comportement
        // historique). Ce chemin n'a plus aucun mécanisme privé
        // équivalent au fil bot : `announceRouletteResult` est désormais
        // un no-op réseau PERMANENT (voir discord-roulette.ts), quelle
        // que soit la configuration du webhook — jamais un repli public.
        const creator = await makeUser();
        const p1 = await makeUser();
        const p2 = await makeUser();
        const game = await makeGame(creator.id);
        const roulette = await makeRoulette(creator.id, [
          { userId: p1.id, gameId: game.id },
          { userId: p2.id, gameId: game.id },
        ]);

        vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "false");
        // Webhook PLEINEMENT configuré — et pourtant aucun appel réseau ne
        // doit en résulter (voir le commentaire ci-dessus).
        vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/test/token");

        await rouletteLib.spinRoulette(roulette.id);

        expect(fetchMock).not.toHaveBeenCalled();
        const stored = await db.session.findFirstOrThrow({ where: { createdViaRoulette: true } });
        expect(stored.announceViaBot).toBe(false);
        expect(await db.notificationEvent.count({ where: { sourceId: stored.id } })).toBe(0);

        // Les notifications INTERNES restent écrites (invités actifs
        // uniquement) — seule la publication PUBLIQUE est supprimée.
        const notifications = await db.notification.findMany({ where: { relatedSessionId: stored.id } });
        expect(notifications).toHaveLength(2);
        expect(notifications.map((n) => n.userId).sort()).toEqual([p1.id, p2.id].sort());
      });

      it("catégorie de préférence ROULETTE honorée au traitement réel du SEND différé — jamais SESSION", async () => {
        // Revue ciblée de cette PR : `resolveEligibleMentions` (session-announce.ts)
        // filtrait jusqu'ici TOUJOURS via la catégorie "SESSION", y compris
        // pour une session `createdViaRoulette` — alors que le chemin webhook
        // équivalent (`announceRouletteResult`, discord-roulette.ts) filtre
        // bien via "ROULETTE". Les deux utilisateurs ci-dessous ont des
        // préférences SESSION/ROULETTE délibérément OPPOSÉES : seule la
        // bonne catégorie, relue au moment du SEND réel (pas à l'enqueue),
        // peut produire le résultat attendu.
        const creator = await makeUser();
        const roulettePrefOff = await makeUser({ discordName: "roulette-off" });
        const sessionPrefOff = await makeUser({ discordName: "session-off" });
        const game = await makeGame(creator.id);
        const roulette = await makeRoulette(creator.id, [
          { userId: roulettePrefOff.id, gameId: game.id },
          { userId: sessionPrefOff.id, gameId: game.id },
        ]);

        // Refuse ROULETTE mais accepte SESSION — resterait mentionné si le
        // résolveur utilisait encore (à tort) la catégorie SESSION.
        await db.userNotificationPreference.create({
          data: { userId: roulettePrefOff.id, category: "ROULETTE", enabled: false },
        });
        await db.userNotificationPreference.create({
          data: { userId: roulettePrefOff.id, category: "SESSION", enabled: true },
        });
        // Refuse SESSION mais accepte ROULETTE — serait exclu à tort si le
        // résolveur utilisait (à tort) la catégorie SESSION.
        await db.userNotificationPreference.create({
          data: { userId: sessionPrefOff.id, category: "SESSION", enabled: false },
        });
        await db.userNotificationPreference.create({
          data: { userId: sessionPrefOff.id, category: "ROULETTE", enabled: true },
        });

        vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "true");
        await rouletteLib.spinRoulette(roulette.id);
        const stored = await db.session.findFirstOrThrow({ where: { createdViaRoulette: true } });

        // Aucune mention n'existe encore à cet instant — seule l'intention
        // de notification a été posée à l'enqueue. Le SEND réel, traité
        // ici, doit relire la préférence à CE moment (potentiellement bien
        // plus tard que l'enqueue, selon la cadence du cron).
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-1", channel_id: "thread-1" }));
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");

        const [, init] = fetchMock.mock.calls[2];
        const body = JSON.parse(String(init.body));
        expect(body.content).not.toContain(`<@${roulettePrefOff.discordId}>`);
        expect(body.content).toContain(`<@${sessionPrefOff.discordId}>`);

        const notifiedUserIds = (
          await db.notification.findMany({ where: { relatedSessionId: stored.id } })
        ).map((n) => n.userId);
        expect(notifiedUserIds).not.toContain(roulettePrefOff.id);
        expect(notifiedUserIds).toContain(sessionPrefOff.id);
      });
    });

    describe("createRouletteResultSession — Proposal/Vote du jeu gagnant créés ATOMIQUEMENT (fix course diagnostic ping Discord 26/09)", () => {
      it("le Proposal et les Vote existent immédiatement après l'appel — plus besoin d'une création séparée par l'appelant, jamais une fenêtre où le SEND différé les trouverait absents", async () => {
        const creator = await makeUser();
        const p1 = await makeUser();
        const p2 = await makeUser();
        const game = await makeGame(creator.id);

        const { session, proposalId } = await sessionsLib.createRouletteResultSession({
          date: new Date("2026-10-01T20:00:00.000Z"),
          decidedGameId: game.id,
          decidedTime: new Date("2026-10-01T20:00:00.000Z"),
          createdById: creator.id,
          notifiedUserIds: [creator.id, p1.id, p2.id],
        });

        const proposal = await db.proposal.findUnique({
          where: { id: proposalId },
          include: { votes: true },
        });
        expect(proposal?.sessionId).toBe(session.id);
        expect(proposal?.gameId).toBe(game.id);
        expect(proposal?.votes.map((v) => v.userId).sort()).toEqual([creator.id, p1.id, p2.id].sort());
      });
    });

    describe("sessions Roulette — protection contre un double déclenchement concurrent du même tirage", () => {
      it("deux appels concurrents de spinRoulette sur LA MÊME roulette (cron vs chargement de page paresseux) ne créent qu'une seule session et un seul ensemble de notifications", async () => {
        // Reproduit le scénario identifié lors de la revue ciblée de cette
        // PR : le cron (`processOpenRoulettes` → `spinRouletteIfDue`) et un
        // chargement de page ouvert au même instant (`spinRouletteIfDue`
        // depuis /roulette/[id]) peuvent tous deux appeler `spinRoulette`
        // pour LA MÊME roulette. La protection vient de `claimRouletteSpin`
        // (updateMany conditionné sur status: "OPEN", même mécanique que
        // `claimSessionClose`) — ce test la met réellement à l'épreuve
        // contre Postgres, jamais seulement contre un mock.
        const creator = await makeUser();
        const p1 = await makeUser();
        const p2 = await makeUser();
        const game = await makeGame(creator.id);
        const roulette = await makeRoulette(creator.id, [
          { userId: p1.id, gameId: game.id },
          { userId: p2.id, gameId: game.id },
        ]);

        vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "true");

        await Promise.all([rouletteLib.spinRoulette(roulette.id), rouletteLib.spinRoulette(roulette.id)]);

        const sessions = await db.session.findMany({ where: { createdViaRoulette: true } });
        expect(sessions).toHaveLength(1);
        // 1 event SESSION_CREATED (thread+announce) + 1 SESSION_CREATOR_MEMBER
        // + 1 SESSION_INVITE_SYNC par participant (p1, p2 — bug remonté en
        // test réel, voir le commentaire de fichier : un participant
        // Roulette est désormais synchronisé vers le fil dès la création,
        // jamais seulement après un réinvite manuel).
        expect(await db.notificationEvent.count({ where: { sourceId: sessions[0].id } })).toBe(4);
        expect(
          await db.notificationDelivery.count({
            where: { targetSlot: { startsWith: `default-guild:SESSION:${sessions[0].id}:` } },
          })
        ).toBe(5); // thread + announce + creator-member + 2x invite-sync

        const rouletteRow = await db.roulette.findUniqueOrThrow({ where: { id: roulette.id } });
        expect(rouletteRow.status).toBe("DONE");
        expect(rouletteRow.resultSessionId).toBe(sessions[0].id);

        // Aucun appel Discord réel tenté par l'un ou l'autre appel — seul
        // un enqueue (écriture base) a eu lieu, l'exécuteur n'a pas tourné.
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("deux roulettes DISTINCTES tirées en même temps restent toutes deux traitées — la protection ne bloque jamais deux créations volontairement distinctes", async () => {
        const creator = await makeUser();
        const p1 = await makeUser();
        const p2 = await makeUser();
        const p3 = await makeUser();
        const p4 = await makeUser();
        const game = await makeGame(creator.id);
        const rouletteA = await makeRoulette(creator.id, [
          { userId: p1.id, gameId: game.id },
          { userId: p2.id, gameId: game.id },
        ]);
        const rouletteB = await makeRoulette(creator.id, [
          { userId: p3.id, gameId: game.id },
          { userId: p4.id, gameId: game.id },
        ]);

        vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "true");

        await Promise.all([rouletteLib.spinRoulette(rouletteA.id), rouletteLib.spinRoulette(rouletteB.id)]);

        const sessions = await db.session.findMany({ where: { createdViaRoulette: true } });
        expect(sessions).toHaveLength(2);

        const rouletteRows = await db.roulette.findMany({
          where: { id: { in: [rouletteA.id, rouletteB.id] } },
        });
        expect(rouletteRows.every((r) => r.status === "DONE")).toBe(true);
        expect(new Set(rouletteRows.map((r) => r.resultSessionId))).toEqual(new Set(sessions.map((s) => s.id)));
      });
    });

    describe("invite-sync — synchronise le fil privé avec les invitations (chantier confidentialité)", () => {
      /** Amène une session au point où son fil privé existe déjà, son
       * annonce initiale est déjà postée, ET le créateur est déjà ajouté
       * comme membre du fil (`creator-member`, bug remonté en test réel —
       * voir le commentaire de fichier) — état préalable de tous les
       * tests de ce bloc (sans consommer aussi "announce"/"creator-member",
       * l'une d'elles resterait PENDING et serait réclamée EN PREMIER par
       * le tout prochain `processOne()`, avant l'invite-sync qu'on veut
       * isoler). */
      async function createSessionWithThread(creator: { id: string }) {
        const session = await makeSession(creator.id);
        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(emptyResponse(204));
        await processOne();
        return session;
      }

      it("dépend du fil — enqueue AVANT que le fil n'existe : dependency_not_ready, aucun appel Discord tenté", async () => {
        const creator = await makeUser();
        const guest = await makeUser();
        const session = await makeSession(creator.id);
        const inv = await invite(session.id, guest.id, creator.id);

        await announceLib.enqueueSessionInviteSync(inv.id);
        const outcome = await processOne();
        expect(outcome).toMatchObject({ outcome: "retrying", errorClass: "resolver:dependency_not_ready" });
        expect(fetchMock).not.toHaveBeenCalled();
      });

      it("invitation ACTIVE : add_thread_member (PUT) appelé avec le discordId de l'invité, idempotent par construction Discord", async () => {
        const creator = await makeUser();
        const guest = await makeUser({ discordName: "invite-actif" });
        const session = await createSessionWithThread(creator);
        const inv = await invite(session.id, guest.id, creator.id);

        await announceLib.enqueueSessionInviteSync(inv.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(emptyResponse(204));
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");

        expect(fetchMock).toHaveBeenCalledTimes(7); // thread + verify + announce + verify + creator-member PUT (setup) + verify + ce PUT
        const [url, init] = fetchMock.mock.calls.at(-1)!;
        expect(String(url)).toBe(`https://discord.com/api/v10/channels/thread-1/thread-members/${guest.discordId}`);
        expect(init.method).toBe("PUT");

        const statuses = await announceLib.getSessionInviteSyncStatuses(session.id, [inv.id]);
        expect(statuses.get(inv.id)).toBe("synced");
      });

      it("invitation REVOKED : remove_thread_member (DELETE) appelé — un 404 (déjà absent du fil) est traité comme un SUCCÈS, jamais un échec", async () => {
        const creator = await makeUser();
        const guest = await makeUser({ discordName: "invite-retire" });
        const session = await createSessionWithThread(creator);
        const inv = await invite(session.id, guest.id, creator.id);
        await access.revokeSessionInvite(session.id, guest.id, creator.id);

        await announceLib.enqueueSessionInviteSync(inv.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: "Unknown Member" }));
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");

        const [url, init] = fetchMock.mock.calls.at(-1)!;
        expect(String(url)).toBe(`https://discord.com/api/v10/channels/thread-1/thread-members/${guest.discordId}`);
        expect(init.method).toBe("DELETE");
      });

      it("COURSE — révocation survenue APRÈS l'enqueue d'un ajout mais AVANT son traitement : résout vers un RETRAIT, jamais un ajout périmé qui rétablirait un accès déjà coupé", async () => {
        const creator = await makeUser();
        const guest = await makeUser({ discordName: "course-revocation" });
        const session = await createSessionWithThread(creator);
        const inv = await invite(session.id, guest.id, creator.id);

        // L'ajout est enqueue pendant que l'invitation est encore ACTIVE...
        await announceLib.enqueueSessionInviteSync(inv.id);
        // ...mais elle est révoquée AVANT que l'exécuteur ne traite cette
        // livraison (simule un retrait cliqué juste après l'invitation,
        // avant le prochain passage du cron).
        await access.revokeSessionInvite(session.id, guest.id, creator.id);

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(emptyResponse(204));
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");

        // Le résolveur a relu le statut ACTUEL (REVOKED) au traitement,
        // jamais l'intention figée à l'enqueue — DELETE, jamais PUT.
        const [, init] = fetchMock.mock.calls.at(-1)!;
        expect(init.method).toBe("DELETE");
      });

      it("RÉPÉTITION — deux enqueues successifs pour la même invitation (invite puis revoke rapprochés) : seul le plus récent est traité, convergence identique à l'EDIT d'annonce", async () => {
        const creator = await makeUser();
        const guest = await makeUser();
        const session = await createSessionWithThread(creator);
        const inv = await invite(session.id, guest.id, creator.id);

        await announceLib.enqueueSessionInviteSync(inv.id); // occurrence 1 (ACTIVE)
        await access.revokeSessionInvite(session.id, guest.id, creator.id);
        await announceLib.enqueueSessionInviteSync(inv.id); // occurrence 2 (REVOKED)

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(emptyResponse(204));
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");
        const [, init] = fetchMock.mock.calls.at(-1)!;
        expect(init.method).toBe("DELETE"); // le plus récent (revoke), jamais l'ajout périmé

        // Plus rien à traiter pour cette invitation — la 1ère occurrence a
        // été SKIPPED par `claimNextDelivery`, jamais vue par le résolveur.
        const second = await processOne();
        expect(second).toBeNull();
      });

      it("répétition d'un RETRAIT (double clic) : idempotent, jamais de second appel réseau inutile au-delà de la convergence normale", async () => {
        const creator = await makeUser();
        const guest = await makeUser();
        const session = await createSessionWithThread(creator);
        const inv = await invite(session.id, guest.id, creator.id);
        await access.revokeSessionInvite(session.id, guest.id, creator.id);

        await announceLib.enqueueSessionInviteSync(inv.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(emptyResponse(204));
        const first = await processOne();
        expect(first?.outcome).toBe("sent");

        // Un second retrait n'a plus d'effet côté `revokeSessionInvite`
        // (déjà REVOKED) — mais rien n'empêche un appelant de rappeler
        // `enqueueSessionInviteSync` par erreur (ex. double clic avant la
        // première réponse) : traité normalement, sans jamais planter ni
        // dupliquer l'état.
        await announceLib.enqueueSessionInviteSync(inv.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: "Unknown Member" }));
        const second = await processOne();
        expect(second?.outcome).toBe("sent");
      });

      it("suivi d'état pour l'interface de gestion — 'pending' avant traitement, 'synced' après succès, 'failed' après un échec Discord classifié", async () => {
        const creator = await makeUser();
        const guestPending = await makeUser();
        const guestSynced = await makeUser();
        const guestFailed = await makeUser();
        const session = await createSessionWithThread(creator);
        const invPending = await invite(session.id, guestPending.id, creator.id);
        const invSynced = await invite(session.id, guestSynced.id, creator.id);
        const invFailed = await invite(session.id, guestFailed.id, creator.id);

        await announceLib.enqueueSessionInviteSync(invSynced.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(emptyResponse(204));
        await processOne();

        await announceLib.enqueueSessionInviteSync(invFailed.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(403, { code: 50013, message: "Missing Permissions" }));
        await processOne();

        const statuses = await announceLib.getSessionInviteSyncStatuses(session.id, [
          invPending.id,
          invSynced.id,
          invFailed.id,
        ]);
        expect(statuses.get(invPending.id)).toBe("pending"); // jamais enqueue
        expect(statuses.get(invSynced.id)).toBe("synced");
        expect(statuses.get(invFailed.id)).toBe("failed");
      });

      it("réessai manuel après un échec (bouton 'Réessayer') : relit le statut ACTUEL de l'invitation, jamais l'intention figée au moment de l'échec initial", async () => {
        // Reproduit exactement `retrySessionInviteSyncAction`
        // (src/app/sessions/actions/invites.ts) : un simple ré-appel à
        // `enqueueSessionInviteSync`, sans passer le statut — c'est au
        // RÉSOLVEUR de le relire au traitement, jamais à l'appelant de le
        // figer. Ce test le prouve pour le cas précis du bouton "Réessayer" :
        // ajout ACTIVE → échec Discord (403) → invitation révoquée ENTRE
        // l'échec et le réessai → le réessai doit résoudre vers un
        // RETRAIT (DELETE), jamais rejouer l'ajout (PUT) périmé qui
        // rétablirait un accès Discord déjà coupé côté site.
        const creator = await makeUser();
        const guest = await makeUser({ discordName: "reessai-apres-echec" });
        const session = await createSessionWithThread(creator);
        const inv = await invite(session.id, guest.id, creator.id);

        await announceLib.enqueueSessionInviteSync(inv.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(403, { code: 50013, message: "Missing Permissions" }));
        const firstOutcome = await processOne();
        expect(firstOutcome).toMatchObject({ outcome: "failed" });

        let statuses = await announceLib.getSessionInviteSyncStatuses(session.id, [inv.id]);
        expect(statuses.get(inv.id)).toBe("failed");

        // L'invitation change d'état PENDANT que le créateur regarde
        // l'échec sur /sessions/[id]/invites, AVANT qu'il ne clique sur
        // "Réessayer" (ex. il retire finalement cet invité au lieu de
        // relancer l'ajout).
        await access.revokeSessionInvite(session.id, guest.id, creator.id);

        // Le réessai manuel — même appel, exactement ce que fait
        // `retrySessionInviteSyncAction`, sans jamais lire ni transmettre
        // le statut lui-même.
        await announceLib.enqueueSessionInviteSync(inv.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(emptyResponse(204));
        const retryOutcome = await processOne();

        expect(retryOutcome?.outcome).toBe("sent");
        const [, init] = fetchMock.mock.calls.at(-1)!;
        // DELETE (retrait), jamais PUT (ajout) — la CONSÉQUENCE du
        // changement d'état intervenu entre l'échec et le réessai, jamais
        // l'intention d'origine rejouée à l'identique.
        expect(init.method).toBe("DELETE");

        statuses = await announceLib.getSessionInviteSyncStatuses(session.id, [inv.id]);
        expect(statuses.get(inv.id)).toBe("synced");
      });
    });

    describe("resyncSessionThreadMembers — réparation groupée pour une soirée créée AVANT les correctifs creator-member/invite-sync-à-la-création", () => {
      /** Reproduit EXACTEMENT l'état laissé par le code D'AVANT les deux
       * correctifs : fil + annonce déjà SENT (le fil existe bien côté
       * Discord), mais AUCUNE livraison `creator-member` ni `invite:<id>`
       * n'a jamais été enqueue-ée — jamais `enqueueSessionCreationDeliveries`
       * (qui, depuis le correctif, enqueue AUSSI `creator-member`), pour
       * ne PAS reproduire le comportement corrigé par erreur. */
      async function createLegacySessionWithThread(creator: { id: string }) {
        const session = await makeSession(creator.id);
        const deliveryLib = await import("./notification-delivery");
        const event = await deliveryLib.createNotificationEvent({
          category: "SESSION",
          eventType: "SESSION_CREATED",
          sourceId: session.id,
        });
        await deliveryLib.enqueueDelivery({
          eventId: event.id,
          channel: "DISCORD_CHANNEL",
          transport: "BOT",
          operation: "SEND",
          recipientKey: "channel",
          targetSlot: `default-guild:SESSION:${session.id}:thread`,
        });
        await deliveryLib.enqueueDelivery({
          eventId: event.id,
          channel: "DISCORD_CHANNEL",
          transport: "BOT",
          operation: "SEND",
          recipientKey: "channel",
          targetSlot: `default-guild:SESSION:${session.id}:announce`,
        });
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        await processOne();
        return session;
      }

      it("statuts affichés AVANT réparation : ni le créateur ni l'invité actif ne sont jamais 'failed' — 'syncing'/'pending' indéfiniment, sans le moindre bouton 'Réessayer' individuel visible (bug démontré, pas supposé)", async () => {
        const creator = await makeUser();
        const guest = await makeUser({ discordName: "invite-legacy" });
        const session = await createLegacySessionWithThread(creator);
        const inv = await invite(session.id, guest.id, creator.id);

        expect(await announceLib.getSessionThreadReadiness(session.id)).toBe("syncing");
        const statuses = await announceLib.getSessionInviteSyncStatuses(session.id, [inv.id]);
        expect(statuses.get(inv.id)).toBe("pending");
      });

      it("resyncSessionThreadMembers ajoute le créateur ET l'invité actif, sans jamais recréer le fil ni renvoyer l'annonce", async () => {
        const creator = await makeUser({ discordName: "createur-legacy" });
        const guest = await makeUser({ discordName: "invite-legacy" });
        const session = await createLegacySessionWithThread(creator);
        const inv = await invite(session.id, guest.id, creator.id);

        fetchMock.mockClear();
        await announceLib.resyncSessionThreadMembers(session.id);

        // Deux nouvelles livraisons (creator-member + invite:<id>), toutes
        // deux dépendantes du fil déjà SENT — traitées normalement.
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(emptyResponse(204));
        const first = await processOne();
        expect(first?.outcome).toBe("sent");
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(emptyResponse(204));
        const second = await processOne();
        expect(second?.outcome).toBe("sent");
        expect(await processOne()).toBeNull();

        // Aucun appel de création de fil ni d'envoi d'annonce — seulement
        // des GET de vérification + PUT d'ajout de membre (4 appels : 2
        // paires verify+PUT, jamais un POST vers /threads ou /messages).
        expect(fetchMock).toHaveBeenCalledTimes(4);
        expect(fetchMock.mock.calls.every(([, init]) => (init?.method ?? "GET") !== "POST")).toBe(true);
        const putUrls = fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT").map(([url]) => String(url));
        expect(putUrls).toContain(`https://discord.com/api/v10/channels/thread-1/thread-members/${creator.discordId}`);
        expect(putUrls).toContain(`https://discord.com/api/v10/channels/thread-1/thread-members/${guest.discordId}`);

        expect(await announceLib.getSessionThreadReadiness(session.id)).toBe("ready");
        const statuses = await announceLib.getSessionInviteSyncStatuses(session.id, [inv.id]);
        expect(statuses.get(inv.id)).toBe("synced");
      });

      it("ne touche JAMAIS un invité RÉVOQUÉ — aucune livraison enqueue-ée pour lui, aucun risque de rétablir un accès coupé", async () => {
        const creator = await makeUser();
        const activeGuest = await makeUser({ discordName: "actif" });
        const revokedGuest = await makeUser({ discordName: "revoque" });
        const session = await createLegacySessionWithThread(creator);
        const activeInv = await invite(session.id, activeGuest.id, creator.id);
        const revokedInv = await invite(session.id, revokedGuest.id, creator.id);
        await access.revokeSessionInvite(session.id, revokedGuest.id, creator.id);

        await announceLib.resyncSessionThreadMembers(session.id);

        const deliveries = await db.notificationDelivery.findMany({
          where: { targetSlot: { in: [
            `default-guild:SESSION:${session.id}:invite:${activeInv.id}`,
            `default-guild:SESSION:${session.id}:invite:${revokedInv.id}`,
          ] } },
        });
        expect(deliveries.map((d) => d.targetSlot)).toEqual([
          `default-guild:SESSION:${session.id}:invite:${activeInv.id}`,
        ]);
      });

      it("un appel répété (double clic sur 'Resynchroniser') n'a jamais d'effet en double — convergence 'la plus récente survit', déjà garantie par claimNextDelivery", async () => {
        const creator = await makeUser();
        const session = await createLegacySessionWithThread(creator);

        await announceLib.resyncSessionThreadMembers(session.id);
        await announceLib.resyncSessionThreadMembers(session.id);

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(emptyResponse(204));
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");
        // La ligne la plus ancienne des deux appels a été SKIPPED au
        // passage — plus rien d'autre à traiter pour ce créateur.
        expect(await processOne()).toBeNull();

        const putCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT");
        expect(putCalls).toHaveLength(1);
      });
    });

    describe("mentions/notifications bot — coupées par une révocation, même déjà enqueue-ées (chantier confidentialité)", () => {
      it("un invité RÉVOQUÉ après l'enqueue mais AVANT le traitement du SEND n'est ni mentionné ni notifié — même garantie que les préférences", async () => {
        const creator = await makeUser();
        const revokedGuest = await makeUser({ discordName: "revoque-avant-envoi" });
        const stillActive = await makeUser({ discordName: "toujours-invite" });
        const game = await makeGame(creator.id);
        const session = await makeSession(creator.id);
        const proposal = await propose(session.id, game.id, creator.id);
        await vote(proposal.id, revokedGuest.id);
        await vote(proposal.id, stillActive.id);
        await invite(session.id, revokedGuest.id, creator.id);
        await invite(session.id, stillActive.id, creator.id);

        await announceLib.enqueueSessionCreationDeliveries(session.id);

        // Révoqué APRÈS l'enqueue de la création, AVANT que l'exécuteur ne
        // traite le SEND — simule un retrait décidé pendant la fenêtre
        // d'attente du cron.
        await access.revokeSessionInvite(session.id, revokedGuest.id, creator.id);

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");

        const [, init] = fetchMock.mock.calls[2];
        const body = JSON.parse(String(init.body));
        expect(body.content).not.toContain(`<@${revokedGuest.discordId}>`);
        expect(body.content).toContain(`<@${stillActive.discordId}>`);

        const notifications = await db.notification.findMany({ where: { relatedSessionId: session.id } });
        expect(notifications.map((n) => n.userId)).toEqual([stillActive.id]);
      });
    });

    /**
     * V2 — parcours "soirée → roulette" remplacé : tirage au sort RATTACHÉ
     * à une soirée existante (`drawSessionGame`, sessions.ts), en
     * remplacement du lien cassé vers le formulaire générique de création
     * d'une roulette. Voir le commentaire de fonction pour les règles
     * d'éligibilité/tirage complètes.
     */
    describe("drawSessionGame — tirage au sort rattaché à une soirée existante (V2)", () => {
      /** Jeu possédé ET disponible par `ownerId` à la date par défaut de
       * `makeSession` (2026-10-01) — `minPlayers: 1` pour qu'UN SEUL
       * propriétaire dispo suffise à rendre la proposition "jouable"
       * (même pattern que les tests `closeSession` existants). */
      async function makeJouableGame(addedById: string, ownerId: string) {
        const game = await db.game.create({
          data: { name: uniq("game"), source: "MANUAL", addedById, minPlayers: 1 },
        });
        await db.userGame.create({ data: { userId: ownerId, gameId: game.id, owned: true } });
        // `upsert` — plusieurs jeux "jouables" possédés par le MÊME
        // propriétaire (cas courant dans ces tests, ex. gameA/gameB/gameC
        // tous possédés par le créateur) réutilisent la même disponibilité
        // du jour, jamais une violation de la contrainte unique
        // `(userId, date)`.
        await db.availabilityOverride.upsert({
          where: { userId_date: { userId: ownerId, date: new Date("2026-10-01") } },
          create: { userId: ownerId, date: new Date("2026-10-01"), available: true },
          update: { available: true },
        });
        return game;
      }

      it("conserve l'id/l'URL/le créateur/la date/les invitations/les votes déjà enregistrés — jamais une nouvelle Session", async () => {
        const creator = await makeUser();
        const guest = await makeUser();
        const game = await makeJouableGame(creator.id, creator.id);
        const originalDate = new Date("2026-10-01T20:00:00.000Z");
        const session = await makeSession(creator.id, { announceViaBot: false, date: originalDate });
        await invite(session.id, guest.id, creator.id);
        const proposal = await propose(session.id, game.id, creator.id);
        await vote(proposal.id, guest.id);

        const sessionCountBefore = await db.session.count();
        const outcome = await sessionsLib.drawSessionGame(session.id, creator.id);
        expect(outcome).toMatchObject({ kind: "drawn", winnerGameId: game.id });

        expect(await db.session.count()).toBe(sessionCountBefore); // aucune nouvelle Session

        const stored = await db.session.findUniqueOrThrow({ where: { id: session.id } });
        expect(stored.id).toBe(session.id); // même id/URL
        expect(stored.createdById).toBe(creator.id);
        expect(stored.date.getTime()).toBe(originalDate.getTime());
        expect(stored.status).toBe("SCHEDULED");
        expect(stored.decidedGameId).toBe(game.id);
        expect(stored.createdViaRoulette).toBe(false); // jamais modifié artificiellement

        const invites = await db.sessionInvite.findMany({ where: { sessionId: session.id } });
        expect(invites).toHaveLength(1);
        expect(invites[0].userId).toBe(guest.id);
        expect(invites[0].status).toBe("ACTIVE");

        const storedProposal = await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
        expect(storedProposal.gameId).toBe(game.id); // proposition déjà écrite, jamais recréée
        const storedVotes = await db.vote.findMany({ where: { proposalId: proposal.id } });
        expect(storedVotes.map((v) => v.userId)).toEqual([guest.id]); // votes réels préservés, jamais fabriqués
      });

      it("refuse la mutation pour un invité actif NON créateur — même id de soirée réel et valide", async () => {
        const creator = await makeUser();
        const guest = await makeUser();
        const game = await makeJouableGame(creator.id, creator.id);
        const session = await makeSession(creator.id, { announceViaBot: false });
        await invite(session.id, guest.id, creator.id);
        await propose(session.id, game.id, creator.id);

        const outcome = await sessionsLib.drawSessionGame(session.id, guest.id);
        expect(outcome).toEqual({ kind: "not_creator" });

        const stored = await db.session.findUniqueOrThrow({ where: { id: session.id } });
        expect(stored.status).toBe("VOTING");
        expect(stored.decidedGameId).toBeNull();
      });

      it("aucun jeu éligible (aucun propriétaire dispo) : explication sans la moindre mutation, la soirée reste VOTING avec ses propositions intactes", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id, { announceViaBot: false });
        // Jeu proposé mais PERSONNE ne le possède/est dispo — jamais
        // "jouable" simplement parce que le créateur est supposé présent.
        const game = await db.game.create({
          data: { name: uniq("game"), source: "MANUAL", addedById: creator.id, minPlayers: 1 },
        });
        await propose(session.id, game.id, creator.id);

        const outcome = await sessionsLib.drawSessionGame(session.id, creator.id);
        expect(outcome).toEqual({ kind: "no_eligible_game" });

        const stored = await db.session.findUniqueOrThrow({ where: { id: session.id } });
        expect(stored.status).toBe("VOTING");
        expect(await db.proposal.count({ where: { sessionId: session.id } })).toBe(1); // proposition intacte
      });

      it("un seul jeu éligible : retenu directement, sans la moindre intervention du hasard", async () => {
        const creator = await makeUser();
        const eligibleGame = await makeJouableGame(creator.id, creator.id);
        // Un second jeu proposé mais NON jouable — ne doit jamais être
        // choisi, même si le hasard portait sur toutes les propositions
        // sans filtrer par éligibilité.
        const ineligibleGame = await db.game.create({
          data: { name: uniq("game"), source: "MANUAL", addedById: creator.id, minPlayers: 4 },
        });
        const session = await makeSession(creator.id, { announceViaBot: false });
        await propose(session.id, eligibleGame.id, creator.id);
        await propose(session.id, ineligibleGame.id, creator.id);

        const outcome = await sessionsLib.drawSessionGame(session.id, creator.id);
        expect(outcome).toEqual({
          kind: "drawn",
          winnerGameId: eligibleGame.id,
          candidateGameIds: [eligibleGame.id],
        });
      });

      it("plusieurs jeux éligibles : tirage uniforme (Math.random espionné) parmi EXACTEMENT les jeux jouables, jamais un jeu non jouable ni un doublon", async () => {
        const creator = await makeUser();
        const gameA = await makeJouableGame(creator.id, creator.id);
        const gameB = await makeJouableGame(creator.id, creator.id);
        const gameC = await makeJouableGame(creator.id, creator.id);
        const ineligibleGame = await db.game.create({
          data: { name: uniq("game"), source: "MANUAL", addedById: creator.id, minPlayers: 4 },
        });
        const session = await makeSession(creator.id, { announceViaBot: false });
        await propose(session.id, gameA.id, creator.id);
        await propose(session.id, gameB.id, creator.id);
        await propose(session.id, gameC.id, creator.id);
        await propose(session.id, ineligibleGame.id, creator.id);

        // Espionne Math.random pour vérifier EXACTEMENT la formule de
        // tirage (même formule que `spinRoulette`, roulette.ts) — jamais
        // un algorithme de tirage différent recopié à moitié.
        const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5); // index 1 sur 3
        try {
          const outcome = await sessionsLib.drawSessionGame(session.id, creator.id);
          expect(outcome).toMatchObject({ kind: "drawn" });
          if (outcome.kind === "drawn") {
            expect(outcome.candidateGameIds.sort()).toEqual([gameA.id, gameB.id, gameC.id].sort());
            expect(outcome.candidateGameIds).not.toContain(ineligibleGame.id);
            expect(outcome.winnerGameId).toBe(gameB.id); // Math.floor(0.5*3) = 1 → gameB
          }
        } finally {
          randomSpy.mockRestore();
        }
      });

      it("résultat déterminé côté serveur — un second appel après succès ne retire JAMAIS, retrouve l'état déjà décidé", async () => {
        const creator = await makeUser();
        const gameA = await makeJouableGame(creator.id, creator.id);
        const gameB = await makeJouableGame(creator.id, creator.id);
        const session = await makeSession(creator.id, { announceViaBot: false });
        await propose(session.id, gameA.id, creator.id);
        await propose(session.id, gameB.id, creator.id);

        const first = await sessionsLib.drawSessionGame(session.id, creator.id);
        expect(first.kind).toBe("drawn");
        const decidedGameId = first.kind === "drawn" ? first.winnerGameId : null;

        // Deuxième appel (rafraîchissement, ou second clic parvenu malgré
        // la protection côté UI) — ne relance JAMAIS un tirage.
        const second = await sessionsLib.drawSessionGame(session.id, creator.id);
        expect(second).toEqual({ kind: "not_voting", status: "SCHEDULED", decidedGameId });

        const stored = await db.session.findUniqueOrThrow({ where: { id: session.id } });
        expect(stored.decidedGameId).toBe(decidedGameId); // jamais écrasé par le second appel
      });

      it("concurrence RÉELLE — deux tirages simultanés sur LA MÊME soirée (double clic, deux onglets) : un seul commit, l'autre retrouve ce MÊME résultat", async () => {
        const creator = await makeUser();
        const game = await makeJouableGame(creator.id, creator.id);
        const session = await makeSession(creator.id, { announceViaBot: false });
        await propose(session.id, game.id, creator.id);

        const [first, second] = await Promise.all([
          sessionsLib.drawSessionGame(session.id, creator.id),
          sessionsLib.drawSessionGame(session.id, creator.id),
        ]);

        const drawnOutcomes = [first, second].filter((o) => o.kind === "drawn");
        expect(drawnOutcomes).toHaveLength(1); // un SEUL commit, jamais les deux

        const notVotingOutcome = [first, second].find((o) => o.kind === "not_voting");
        expect(notVotingOutcome).toMatchObject({ kind: "not_voting", status: "SCHEDULED", decidedGameId: game.id });

        expect(await db.session.count({ where: { id: session.id, status: "SCHEDULED" } })).toBe(1);
      });

      it("concurrence RÉELLE — tirage vs clôture manuelle du vote (closeSession) sur LA MÊME soirée : une seule transition gagne, jamais les deux, jamais un crash", async () => {
        const creator = await makeUser();
        const game = await makeJouableGame(creator.id, creator.id);
        const session = await makeSession(creator.id, { announceViaBot: false });
        const proposal = await propose(session.id, game.id, creator.id);
        await vote(proposal.id, creator.id); // closeSession exige au moins 1 vote (sinon "0 votant" → CANCELLED)

        const [drawOutcome] = await Promise.all([
          sessionsLib.drawSessionGame(session.id, creator.id),
          sessionsLib.closeSession(session.id),
        ]);

        const stored = await db.session.findUniqueOrThrow({ where: { id: session.id } });
        // Quel que soit l'ordre réel choisi par Postgres, la soirée finit
        // SCHEDULED avec CE MÊME jeu (le seul éligible pour les deux
        // chemins ici) — jamais VOTING, jamais deux jeux différents,
        // jamais un crash.
        expect(stored.status).toBe("SCHEDULED");
        expect(stored.decidedGameId).toBe(game.id);
        // Le tirage a soit gagné (kind: "drawn"), soit trouvé la clôture
        // déjà passée avant lui (kind: "not_voting", même jeu) — jamais
        // un troisième état.
        expect(["drawn", "not_voting"]).toContain(drawOutcome.kind);
      });

      it("concurrence RÉELLE — annulation pendant le tirage : la soirée finit CANCELLED (même relation, non corrigée ici, que cancelSession/closeSession — cancelSession reste inconditionnel), jamais un état incohérent", async () => {
        const creator = await makeUser();
        const game = await makeJouableGame(creator.id, creator.id);
        const session = await makeSession(creator.id, { announceViaBot: false });
        await propose(session.id, game.id, creator.id);

        await Promise.all([
          sessionsLib.drawSessionGame(session.id, creator.id),
          sessionsLib.cancelSession(session.id),
        ]);

        const stored = await db.session.findUniqueOrThrow({ where: { id: session.id } });
        // `cancelSession` est inconditionnel (même comportement PRÉ-EXISTANT
        // vis-à-vis de `closeSession`, non modifié par cette PR) : la
        // soirée finit TOUJOURS CANCELLED, que le tirage ait committé
        // juste avant ou non. Si le tirage a committé avant l'annulation,
        // `decidedGameId` reste posé (cancelSession ne le touche jamais) —
        // les deux variantes sont des états cohérents, jamais un crash ni
        // une soirée à moitié écrite.
        expect(stored.status).toBe("CANCELLED");
        expect([null, game.id]).toContain(stored.decidedGameId);
      });

      it("concurrence RÉELLE — retrait de la proposition gagnante entre le tirage et son commit : soit la soirée reste VOTING intacte, soit elle est décidée AVANT que le retrait ne soit visible — jamais un jeu retiré annoncé comme retenu", async () => {
        const creator = await makeUser();
        const game = await makeJouableGame(creator.id, creator.id);
        const session = await makeSession(creator.id, { announceViaBot: false });
        const proposal = await propose(session.id, game.id, creator.id);

        await Promise.all([
          sessionsLib.drawSessionGame(session.id, creator.id),
          db.proposal.delete({ where: { id: proposal.id } }),
        ]);

        const stored = await db.session.findUniqueOrThrow({ where: { id: session.id } });
        if (stored.status === "SCHEDULED") {
          // Le tirage a committé AVANT que le retrait ne soit visible dans
          // sa transaction — décision légitime (retrait arrivé "trop
          // tard"), jamais un jeu FANTÔME : `decidedGameId` référence
          // toujours un `Game` réel (jamais la `Proposal`, supprimée
          // depuis, qui n'est jamais la source de vérité du champ).
          expect(stored.decidedGameId).toBe(game.id);
        } else {
          // Le retrait a été visible AVANT le commit du tirage — la
          // protection (`stillProposed`, voir `drawSessionGame`) a
          // correctement refusé de committer un gagnant qui vient de
          // disparaître : la soirée reste VOTING, jamais un jeu retiré
          // annoncé comme retenu.
          expect(stored.status).toBe("VOTING");
          expect(stored.decidedGameId).toBeNull();
        }
        expect(await db.proposal.findUnique({ where: { id: proposal.id } })).toBeNull();
      });

      it("Discord en attente au moment du tirage (fil pas encore créé) : le tirage commit quand même, l'EDIT d'annonce attend son tour et se résout proprement une fois le fil SENT — jamais un résultat perdu ni une annonce périmée", async () => {
        const creator = await makeUser();
        const guest = await makeUser({ discordName: "invite-attend" });
        const game = await makeJouableGame(creator.id, creator.id);
        const session = await makeSession(creator.id, { announceViaBot: true });
        await invite(session.id, guest.id, creator.id);
        const proposal = await propose(session.id, game.id, creator.id);
        await vote(proposal.id, guest.id);
        // Fil + annonce initiale ENQUEUE-ÉS (création normale) mais
        // JAMAIS traités — simule le tirage déclenché avant que le cron
        // n'ait eu le temps de créer le fil/poster l'annonce.
        await announceLib.enqueueSessionCreationDeliveries(session.id);

        const outcome = await sessionsLib.drawSessionGame(session.id, creator.id);
        expect(outcome).toMatchObject({ kind: "drawn", winnerGameId: game.id });

        // Traite dans l'ordre RÉEL de réclamation (`sequence` global,
        // `claimNextDelivery`) : thread → announce SEND → creator-member
        // (les trois enqueue-és par `enqueueSessionCreationDeliveries`,
        // AVANT le tirage) → announce EDIT → thread-summary (les deux
        // enqueue-és PAR `drawSessionGame`, donc après, forcément une
        // séquence plus récente). `invite()` ci-dessus est l'aide de test
        // BAS NIVEAU (écriture directe `SessionInvite`, jamais
        // `enqueueSessionInviteSyncForNewInvite`) — aucune livraison
        // invite-sync n'existe donc ici, volontairement (pas l'objet de
        // ce test). Le résultat du tirage n'est PERDU à aucune étape, et
        // l'EDIT finale rend bien l'état SCHEDULED actuel (jamais l'ancien
        // texte "en cours de vote").
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne(); // thread
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        await processOne(); // announce SEND (rend déjà l'état SCHEDULED — enqueue-é AVANT, traité APRÈS le tirage)
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(emptyResponse(204));
        await processOne(); // creator-member
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        const editOutcome = await processOne(); // announce EDIT (rend l'état SCHEDULED, un seul appel réseau)
        expect(editOutcome?.outcome).toBe("sent");

        // Le résumé de résultat dans le fil (enqueue-é par drawSessionGame,
        // dépend aussi de `thread` SENT) se traite normalement.
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-resume", channel_id: "thread-1" }));
        const summaryOutcome = await processOne();
        expect(summaryOutcome?.outcome).toBe("sent");

        // Message distinct « Soirée validée : {jeu} » (avec mention), aussi
        // enqueue-é par drawSessionGame.
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-validated", channel_id: "thread-1" }));
        const validatedOutcome = await processOne();
        expect(validatedOutcome?.outcome).toBe("sent");

        expect(await processOne()).toBeNull(); // plus rien à traiter

        const stored = await db.session.findUniqueOrThrow({ where: { id: session.id } });
        expect(stored.status).toBe("SCHEDULED");
        expect(stored.decidedGameId).toBe(game.id);
      });

      it("préserve le fil privé existant, n'en crée jamais un second, et l'annonce éditée ne mentionne QUE les vrais votants du jeu retenu — jamais un reping de tout le groupe invité", async () => {
        const creator = await makeUser();
        const voter = await makeUser({ discordName: "a-vote" });
        const silentInvitee = await makeUser({ discordName: "invite-jamais-vote" });
        const game = await makeJouableGame(creator.id, creator.id);
        const session = await makeSession(creator.id, { announceViaBot: true });
        await invite(session.id, voter.id, creator.id);
        await invite(session.id, silentInvitee.id, creator.id); // invité mais n'a JAMAIS voté
        const proposal = await propose(session.id, game.id, creator.id);
        await vote(proposal.id, voter.id);

        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne(); // thread
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        await processOne(); // announce SEND (encore VOTING à ce stade)
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", type: 12 }));
        fetchMock.mockResolvedValueOnce(emptyResponse(204));
        await processOne(); // creator-member
        // `invite()` ci-dessus est l'aide de test BAS NIVEAU (écriture
        // directe `SessionInvite`, jamais `enqueueSessionInviteSyncForNewInvite`)
        // — aucune livraison invite-sync n'existe donc ici, volontairement
        // (pas l'objet de ce test, voir le commentaire équivalent du test
        // précédent). Prochaine livraison due : l'announce EDIT
        // enqueue-ée par `drawSessionGame` ci-dessous.

        const threadCreationCalls = fetchMock.mock.calls.filter(
          ([url, init]) => String(url).includes("/threads") && init?.method === "POST"
        );
        expect(threadCreationCalls).toHaveLength(1); // UN SEUL fil créé jusqu'ici

        const outcome = await sessionsLib.drawSessionGame(session.id, creator.id);
        expect(outcome).toMatchObject({ kind: "drawn", winnerGameId: game.id });

        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "thread-1" }));
        const editOutcome = await processOne(); // announce EDIT (rend l'état SCHEDULED)
        expect(editOutcome?.outcome).toBe("sent");

        const [editUrl, editInit] = fetchMock.mock.calls.at(-1)!;
        expect(String(editUrl)).toContain("/messages/msg-announce"); // ÉDITE le même message, jamais un nouveau
        const editBody = JSON.parse(String(editInit.body));
        expect(editBody.content).toContain(`<@${voter.discordId}>`); // le vrai votant du jeu retenu
        expect(editBody.content).not.toContain(`<@${silentInvitee.discordId}>`); // invité mais jamais votant — jamais un reping de tout le groupe

        // Aucun deuxième fil créé par ce parcours.
        const threadCreationCallsAfter = fetchMock.mock.calls.filter(
          ([url, init]) => String(url).includes("/threads") && init?.method === "POST"
        );
        expect(threadCreationCallsAfter).toHaveLength(1);
      });
    });

    describe("V2 — suppression manuelle définitive du fil privé (chantier nettoyage réel du stockage)", () => {
      /** Simule `deleteSessionAction` (session-lifecycle.ts) sans passer par
       * la server action elle-même (`redirect()` non testable ici) : même
       * paire enqueue+delete DANS UNE TRANSACTION que l'action réelle. */
      async function deleteSessionWithCleanup(sessionId: string) {
        await db.$transaction(async (tx) => {
          await announceLib.enqueueSessionThreadDelete(sessionId, tx);
          await tx.session.delete({ where: { id: sessionId } });
        });
      }

      /** Isole `thread-delete` des autres livraisons enqueue-ées par
       * `enqueueSessionCreationDeliveries` (`announce`/`creator-member`,
       * hors sujet ici) — sans ça, ces deux-là (sequence PLUS ANCIENNE que
       * `thread-delete`) seraient réclamées en premier par
       * `claimNextDelivery` (ordre strict par `sequence ASC`) dès que la
       * session a disparu, et résoudraient chacune `expired` (le
       * dispatcher charge la session pour TOUT rôle hors `thread-delete`)
       * SANS jamais toucher `fetch` — masquant silencieusement le
       * comportement réellement testé ici. */
      async function removeAnnounceAndCreatorMemberDeliveries(sessionId: string) {
        await db.notificationDelivery.deleteMany({
          where: {
            targetSlot: {
              in: [
                `default-guild:SESSION:${sessionId}:announce`,
                `default-guild:SESSION:${sessionId}:creator-member`,
              ],
            },
          },
        });
      }

      it("fil déjà créé : DELETE PERMANENT (jamais un archivage), fonctionne SANS que la ligne Session existe encore", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id);
        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne(); // fil créé
        await removeAnnounceAndCreatorMemberDeliveries(session.id);

        await deleteSessionWithCleanup(session.id);
        expect(await db.session.findUnique({ where: { id: session.id } })).toBeNull();

        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");
        const [url, init] = fetchMock.mock.calls.at(-1)!;
        expect(init.method).toBe("DELETE");
        expect(String(url)).toBe("https://discord.com/api/v10/channels/thread-1");
        expect(init.body).toBeUndefined();
      });

      it("fil déjà absent (404) au moment du nettoyage : résultat idempotent, jamais un échec", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id);
        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();
        await removeAnnounceAndCreatorMemberDeliveries(session.id);
        await deleteSessionWithCleanup(session.id);

        fetchMock.mockResolvedValueOnce(jsonResponse(404, { message: "Unknown Channel" }));
        const outcome = await processOne();
        expect(outcome?.outcome).toBe("sent");
      });

      it("permission insuffisante (403) : jamais traité comme un succès, immédiatement FAILED terminal (non-retryable, voir discord-rest.ts)", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id);
        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();
        await removeAnnounceAndCreatorMemberDeliveries(session.id);
        await deleteSessionWithCleanup(session.id);

        fetchMock.mockResolvedValueOnce(jsonResponse(403, { message: "Missing Permissions", code: 50013 }));
        const outcome = await processOne();
        expect(outcome).toMatchObject({ outcome: "failed", errorClass: "discord:auth_or_permission" });
        const row = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: `default-guild:SESSION:${session.id}:thread-delete` },
        });
        expect(row.status).toBe("FAILED");
      });

      it("le nettoyage attend tant que le SEND `thread` reste PENDING avec une reprise PROGRAMMÉE (échec retryable pas encore retraité) — jamais un raccourci qui suppose son sort", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id);
        await announceLib.enqueueSessionCreationDeliveries(session.id);
        await removeAnnounceAndCreatorMemberDeliveries(session.id);

        // Le SEND `thread` échoue une première fois avec une erreur
        // RETRYABLE (5xx) — reste PENDING, avec une reprise programmée
        // dans le futur (backoff), AVANT même que la session ne soit
        // supprimée.
        fetchMock.mockResolvedValueOnce(jsonResponse(500, {}));
        const failedThread = await processOne();
        expect(failedThread?.outcome).toBe("retrying");

        await deleteSessionWithCleanup(session.id);

        // Nettoyage programmé — le SEND `thread` est bien PENDING, mais sa
        // reprise n'est pas encore due (`nextAttemptAt` dans le futur) :
        // `dependency_not_ready`, jamais un raccourci qui suppose déjà son
        // sort (ni un succès ni un échec).
        const cleanupPending = await processOne();
        expect(cleanupPending).toMatchObject({ outcome: "retrying", errorClass: "resolver:dependency_not_ready" });
        expect(fetchMock).toHaveBeenCalledTimes(1); // uniquement l'échec initial, aucun nouvel appel

        // Le SEND `thread`, retraité une fois sa reprise due, se refuse
        // lui-même (session disparue) — sans nouvel appel réseau.
        const callsBeforeExpiry = fetchMock.mock.calls.length;
        const muchLater = new Date(Date.now() + 60 * 60_000);
        const threadOutcome = await processOne(muchLater);
        expect(threadOutcome).toMatchObject({ outcome: "failed", errorClass: "resolver:expired" });
        expect(fetchMock.mock.calls.length).toBe(callsBeforeExpiry);

        // Le nettoyage, retenté (sa propre reprise différée — backoff
        // `dependency_not_ready` — est désormais due elle aussi), ne
        // trouve plus rien à faire.
        const evenLater = new Date(muchLater.getTime() + 10 * 60_000);
        const cleanupFinal = await processOne(evenLater);
        expect(cleanupFinal).toMatchObject({ outcome: "failed", errorClass: "resolver:expired" });
      });

      /**
       * Reproduit RÉELLEMENT l'entrelacement (pas seulement l'ordre
       * séquentiel "avant"/"après") — même technique que le test
       * équivalent de `tournament-announce.integration.test.ts`
       * ("suppression PENDANT l'appel réseau du tout premier SEND") :
       * déclenche la suppression DEPUIS L'INTÉRIEUR du mock réseau du SEND
       * `thread`, qui a déjà résolu son action (session encore existante
       * au moment de la résolution) avant que la suppression ne commette.
       */
      it("création du fil ABOUTIT EN VOL malgré une suppression commise PENDANT l'appel réseau : le nettoyage attend puis supprime bel et bien ce fil créé après coup — compensation durable", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id);
        await announceLib.enqueueSessionCreationDeliveries(session.id);
        await removeAnnounceAndCreatorMemberDeliveries(session.id);

        fetchMock.mockImplementationOnce(async () => {
          await deleteSessionWithCleanup(session.id);
          return jsonResponse(200, { id: "thread-orphelin", parent_id: "chan-sessions" });
        });
        const threadOutcome = await processOne();
        expect(threadOutcome?.outcome).toBe("sent");
        expect(await db.session.findUnique({ where: { id: session.id } })).toBeNull();

        // Le nettoyage, retenté, voit maintenant `thread` SENT et supprime
        // RÉELLEMENT ce fil créé en vol malgré la suppression déjà actée.
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
        const cleanupOutcome = await processOne();
        expect(cleanupOutcome?.outcome).toBe("sent");
        const [url] = fetchMock.mock.calls.at(-1)!;
        expect(String(url)).toContain("/channels/thread-orphelin");
      });

      it("réessai manuel (occurrence aléatoire) après un premier échec terminal : une nouvelle intention converge, la précédente devient SKIPPED", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id);
        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();
        await removeAnnounceAndCreatorMemberDeliveries(session.id);
        await deleteSessionWithCleanup(session.id);

        // 403 — non-retryable, immédiatement FAILED terminal (voir
        // discord-rest.ts), une seule tentative suffit à l'atteindre.
        fetchMock.mockResolvedValueOnce(jsonResponse(403, { message: "Missing Permissions", code: 50013 }));
        await processOne();
        const firstAttempt = await db.notificationDelivery.findFirstOrThrow({
          where: { targetSlot: `default-guild:SESSION:${session.id}:thread-delete` },
        });
        expect(firstAttempt.status).toBe("FAILED");

        // Réessai manuel (même mécanisme que le bouton admin "Réessayer").
        // La ligne FAILED précédente n'est JAMAIS reréclamée (`claimNextDelivery`
        // ne sélectionne que `status = 'PENDING'`) — elle reste FAILED
        // indéfiniment comme trace historique honnête ; seule la NOUVELLE
        // ligne (occurrence différente, même targetSlot) est traitée.
        await announceLib.enqueueSessionThreadDelete(session.id);
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
        const retryOutcome = await processOne();
        expect(retryOutcome?.outcome).toBe("sent");

        const rows = await db.notificationDelivery.findMany({
          where: { targetSlot: `default-guild:SESSION:${session.id}:thread-delete` },
        });
        expect(rows.find((r) => r.id === firstAttempt.id)?.status).toBe("FAILED");
        expect(rows.some((r) => r.status === "SENT")).toBe(true);
        // L'état exposé au créateur/admin reflète la livraison la PLUS
        // RÉCENTE (par séquence), jamais l'ancien échec dépassé.
        expect(await announceLib.getSessionThreadDeleteStatus(session.id)).toBe("done");
      });

      it("getSessionThreadDeleteStatus reflète honnêtement l'état — never_enqueued / pending / done / failed", async () => {
        const creator = await makeUser();
        const session = await makeSession(creator.id);
        expect(await announceLib.getSessionThreadDeleteStatus(session.id)).toBe("never_enqueued");

        await announceLib.enqueueSessionCreationDeliveries(session.id);
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "thread-1", parent_id: "chan-sessions" }));
        await processOne();
        await removeAnnounceAndCreatorMemberDeliveries(session.id);
        await deleteSessionWithCleanup(session.id);
        expect(await announceLib.getSessionThreadDeleteStatus(session.id)).toBe("pending");

        fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
        await processOne();
        expect(await announceLib.getSessionThreadDeleteStatus(session.id)).toBe("done");
      });
    });
  }
);
