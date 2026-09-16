import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeliveryResolver } from "./notification-executor";

/**
 * Exécuteur de notifications (PR 3/N) — tests combinant PostgreSQL isolé
 * (fondations de livraison réelles, #95) ET HTTP entièrement simulé
 * (client Discord REST, #96 — `fetch` mocké, JAMAIS d'appel réseau réel).
 * Même dérogation volontaire que `notification-delivery.integration.test.ts`
 * pour la partie Postgres (garanties de concurrence non mockables) ; la
 * partie Discord suit le même principe que `discord-rest.test.ts` (mock de
 * `fetch`, jamais de mock de Prisma pour cette partie-là non plus).
 *
 * Nécessite `TEST_DATABASE_URL` — voir le README. Suite entièrement
 * SKIPPÉE si absente (pas de faux vert), y compris les tests de route
 * (authentification/désactivation) : la route importe la chaîne complète
 * jusqu'à `@/lib/prisma`, donc ils partagent le même mock que le reste de
 * cette suite plutôt que de risquer une instanciation Prisma non mockée
 * avec un `DATABASE_URL` absent.
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
    "[notification-executor.integration.test] TEST_DATABASE_URL absente — " +
      "suite SKIPPÉE. Les garanties de bout en bout (claim → appel Discord " +
      "simulé → finalisation) ne sont PAS validées par cette exécution."
  );
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe.skipIf(!TEST_DATABASE_URL)("notification-executor (intégration Postgres isolée + Discord HTTP simulé)", () => {
  let db: import("@prisma/client").PrismaClient;
  let deliveryLib: typeof import("./notification-delivery");
  let executorLib: typeof import("./notification-executor");
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const prismaModule = await import("@/lib/prisma");
    db = prismaModule.prisma as unknown as import("@prisma/client").PrismaClient;
    deliveryLib = await import("./notification-delivery");
    executorLib = await import("./notification-executor");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(`TRUNCATE "NotificationDelivery", "NotificationEvent" CASCADE`);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-bot-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  let eventCounter = 0;
  async function makeEvent(overrides: Partial<Parameters<typeof deliveryLib.createNotificationEvent>[0]> = {}) {
    eventCounter += 1;
    return deliveryLib.createNotificationEvent({
      category: "SESSION",
      eventType: "SESSION_CREATED",
      sourceId: "session-1",
      occurrence: String(eventCounter),
      ...overrides,
    });
  }

  async function makeDelivery(
    eventId: string,
    overrides: Partial<Parameters<typeof deliveryLib.enqueueDelivery>[0]> = {}
  ) {
    return deliveryLib.enqueueDelivery({
      eventId,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: "guild:category:SESSION",
      targetSlot: "default-guild:SESSION:session-1:announce",
      ...overrides,
    });
  }

  /** Résolveur synthétique minimal — envoie toujours le même contenu dans
   * le salon donné. Utilisé pour les scénarios où le contenu exact importe
   * peu, seul le cycle claim→appel→finalisation est testé. */
  function sendResolver(channelId: string, content = "contenu de test"): DeliveryResolver {
    return {
      async resolve() {
        return {
          eligible: true,
          action: {
            kind: "send_channel_message",
            channelId,
            message: { content, allowedMentions: { parse: [] } },
          },
        };
      },
    };
  }

  describe("cycle complet claim → appel Discord simulé → finalisation", () => {
    it("SEND réussi : statut SENT, refs Discord persistées, un seul appel réseau", async () => {
      const event = await makeEvent();
      const delivery = await makeDelivery(event.id);
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-1", channel_id: "chan-1" }));

      const outcome = await executorLib.processNextDelivery({ resolver: sendResolver("chan-1"), owner: "worker-1" });
      expect(outcome).toEqual({ deliveryId: delivery.id, outcome: "sent" });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(row.status).toBe("SENT");
      expect(row.discordMessageId).toBe("msg-1");
      expect(row.discordChannelId).toBe("chan-1");
      expect(row.reservationToken).toBeNull();
    });

    it("rien à réclamer → renvoie null sans toucher au réseau", async () => {
      const outcome = await executorLib.processNextDelivery({ resolver: sendResolver("chan-1"), owner: "worker-1" });
      expect(outcome).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("concurrence", () => {
    it("deux exécuteurs concurrents sur la même cible : un seul traite la livraison, l'autre ne réclame rien", async () => {
      const event = await makeEvent();
      const delivery = await makeDelivery(event.id);
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-1", channel_id: "chan-1" }));

      const [a, b] = await Promise.all([
        executorLib.processNextDelivery({ resolver: sendResolver("chan-1"), owner: "worker-a" }),
        executorLib.processNextDelivery({ resolver: sendResolver("chan-1"), owner: "worker-b" }),
      ]);

      const claimed = [a, b].filter((o) => o !== null);
      expect(claimed).toHaveLength(1);
      expect(claimed[0]).toEqual({ deliveryId: delivery.id, outcome: "sent" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("progression de cibles indépendantes dans un même batch", async () => {
      const event = await makeEvent();
      await makeDelivery(event.id, { targetSlot: "default-guild:SESSION:session-1:announce", recipientKey: "guild:1" });
      await makeDelivery(event.id, { targetSlot: "default-guild:SESSION:session-1:thread", recipientKey: "guild:2" });

      fetchMock
        .mockResolvedValueOnce(jsonResponse(200, { id: "msg-a", channel_id: "chan-1" }))
        .mockResolvedValueOnce(jsonResponse(200, { id: "msg-b", channel_id: "chan-1" }));

      const summary = await executorLib.runExecutorBatch({ resolver: sendResolver("chan-1"), owner: "batch-1" });
      expect(summary.sent).toBe(2);
      expect(summary.processed).toBe(2);
      expect(summary.stoppedReason).toBe("no_more_deliveries");
      expect(summary.recovered).toBe(0);
    });

    it("refus d'une finalisation tardive avec un reservationToken périmé, sans écraser l'état repris", async () => {
      const event = await makeEvent();
      const delivery = await makeDelivery(event.id);

      // "Worker perdu" : réclame directement via les fondations (simule un
      // exécuteur qui aurait crashé avant de finaliser).
      const claimedAt = new Date();
      const lostClaim = await deliveryLib.claimNextDelivery("lost-worker", { leaseMs: 1_000, now: claimedAt });
      const staleToken = lostClaim!.reservationToken!;

      const muchLater = new Date(claimedAt.getTime() + 60_000);
      const recovered = await deliveryLib.recoverExpiredReservations(muchLater);
      expect(recovered).toBe(1);

      fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-new", channel_id: "chan-1" }));
      const outcome = await executorLib.processNextDelivery({
        resolver: sendResolver("chan-1"),
        owner: "worker-b",
        now: muchLater,
      });
      expect(outcome?.outcome).toBe("sent");

      const lateFinalize = await deliveryLib.finalizeDeliverySuccess(delivery.id, staleToken, {
        discordMessageId: "msg-from-lost-worker",
      });
      expect(lateFinalize).toBe(false);

      const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(row.discordMessageId).toBe("msg-new");
      expect(row.status).toBe("SENT");
    });
  });

  describe("succès partiel — SEND réussi, opération dépendante échouée", () => {
    it("SEND réussi puis création de fil échouée : le SEND n'est jamais renvoyé, seule la reprise du fil est retentée", async () => {
      const announceEvent = await makeEvent();
      const announce = await makeDelivery(announceEvent.id, {
        operation: "SEND",
        targetSlot: "default-guild:SESSION:session-1:announce",
      });
      const threadEvent = await makeEvent();
      const thread = await makeDelivery(threadEvent.id, {
        operation: "SEND",
        targetSlot: "default-guild:SESSION:session-1:thread",
      });

      fetchMock
        .mockResolvedValueOnce(jsonResponse(200, { id: "msg-announce", channel_id: "chan-1" }))
        .mockResolvedValueOnce(jsonResponse(500, {}));

      const outcome1 = await executorLib.processNextDelivery({
        resolver: sendResolver("chan-1", "Annonce"),
        owner: "w-announce",
      });
      expect(outcome1).toEqual({ deliveryId: announce.id, outcome: "sent" });

      // Résolveur "création de fil" — recherche lui-même la référence du
      // message de l'annonce sur SON PROPRE targetSlot : aucune dépendance
      // inter-targetSlot n'est fournie automatiquement par
      // `claimNextDelivery` (qui ne résout `targetMessage` que pour une
      // EDIT/ARCHIVE sur le MÊME targetSlot que son SEND) — illustre le
      // contrat attendu d'un futur résolveur métier réel.
      const threadResolver: DeliveryResolver = {
        async resolve() {
          const announceRow = await db.notificationDelivery.findFirst({
            where: { targetSlot: "default-guild:SESSION:session-1:announce", status: "SENT" },
          });
          if (!announceRow?.discordMessageId || !announceRow.discordChannelId) {
            return { eligible: false, reason: "dependency_not_ready" };
          }
          return {
            eligible: true,
            action: {
              kind: "create_thread",
              channelId: announceRow.discordChannelId,
              messageId: announceRow.discordMessageId,
              name: "Discussion",
            },
          };
        },
      };

      const outcome2 = await executorLib.processNextDelivery({ resolver: threadResolver, owner: "w-thread" });
      expect(outcome2).toEqual({ deliveryId: thread.id, outcome: "retrying", errorClass: "discord:server_error" });

      expect(fetchMock).toHaveBeenCalledTimes(2);

      const announceRow = await db.notificationDelivery.findUniqueOrThrow({ where: { id: announce.id } });
      expect(announceRow.status).toBe("SENT");
      expect(announceRow.discordMessageId).toBe("msg-announce");

      const threadRow = await db.notificationDelivery.findUniqueOrThrow({ where: { id: thread.id } });
      expect(threadRow.status).toBe("PENDING");
      expect(threadRow.nextAttemptAt).not.toBeNull();
    });
  });

  describe("dépendance EDIT au message initial et ordre des éditions", () => {
    it("EDIT résout automatiquement targetMessage (channelId/messageId du SEND) sur la MÊME cible", async () => {
      const targetSlot = "default-guild:SESSION:session-1:announce";
      const sendEvent = await makeEvent();
      await makeDelivery(sendEvent.id, { operation: "SEND", targetSlot });
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-1", channel_id: "chan-1" }));
      const sendOutcome = await executorLib.processNextDelivery({
        resolver: sendResolver("chan-1", "Annonce initiale"),
        owner: "w-send",
      });
      expect(sendOutcome?.outcome).toBe("sent");

      const editEvent = await makeEvent();
      const edit = await makeDelivery(editEvent.id, { operation: "EDIT", targetSlot });
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-1", channel_id: "chan-1" }));

      const editResolver: DeliveryResolver = {
        async resolve({ delivery }) {
          expect(delivery.targetMessage).toEqual({
            discordMessageId: "msg-1",
            discordChannelId: "chan-1",
            discordThreadId: null,
          });
          return {
            eligible: true,
            action: {
              kind: "edit_channel_message",
              channelId: delivery.targetMessage!.discordChannelId!,
              messageId: delivery.targetMessage!.discordMessageId,
              message: { content: "Annonce modifiée", allowedMentions: { parse: [] } },
            },
          };
        },
      };

      const editOutcome = await executorLib.processNextDelivery({ resolver: editResolver, owner: "w-edit" });
      expect(editOutcome).toEqual({ deliveryId: edit.id, outcome: "sent" });

      const [url, init] = fetchMock.mock.calls[1];
      expect(String(url)).toBe("https://discord.com/api/v10/channels/chan-1/messages/msg-1");
      expect(init.method).toBe("PATCH");
    });

    it("édition dépassée : seule la plus récente est traitée, l'ancienne jamais vue par le résolveur (SKIPPED avant résolution)", async () => {
      const targetSlot = "default-guild:SESSION:session-1:announce";
      const sendEvent = await makeEvent();
      await makeDelivery(sendEvent.id, { operation: "SEND", targetSlot });
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-1", channel_id: "chan-1" }));
      await executorLib.processNextDelivery({ resolver: sendResolver("chan-1"), owner: "w-send" });

      const v1 = await makeDelivery((await makeEvent()).id, { operation: "EDIT", targetSlot });
      const v2 = await makeDelivery((await makeEvent()).id, { operation: "EDIT", targetSlot });

      const seenIds: string[] = [];
      const resolver: DeliveryResolver = {
        async resolve({ delivery }) {
          seenIds.push(delivery.id);
          return {
            eligible: true,
            action: {
              kind: "edit_channel_message",
              channelId: "chan-1",
              messageId: "msg-1",
              message: { content: "v2", allowedMentions: { parse: [] } },
            },
          };
        },
      };
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "msg-1", channel_id: "chan-1" }));

      const outcome = await executorLib.processNextDelivery({ resolver, owner: "w-edit" });
      expect(outcome).toEqual({ deliveryId: v2.id, outcome: "sent" });
      expect(seenIds).toEqual([v2.id]);

      const v1Row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: v1.id } });
      expect(v1Row.status).toBe("SKIPPED");
    });
  });

  describe("résolution non éligible — préférence refusée, expiration, configuration absente", () => {
    it.each([["preference_declined"], ["expired"]] as const)(
      "résolution non éligible (%s) : FAILED terminal, aucun appel Discord",
      async (reason) => {
        const event = await makeEvent();
        const delivery = await makeDelivery(event.id);
        const resolver: DeliveryResolver = {
          async resolve() {
            return { eligible: false, reason };
          },
        };
        const outcome = await executorLib.processNextDelivery({ resolver, owner: "w1" });
        expect(outcome).toEqual({ deliveryId: delivery.id, outcome: "failed", errorClass: `resolver:${reason}` });
        expect(fetchMock).not.toHaveBeenCalled();

        const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
        expect(row.status).toBe("FAILED");
      }
    );

    it("transport non pris en charge (WEBHOOK) : jamais considéré comme envoyé, aucun appel Discord", async () => {
      const event = await makeEvent();
      const delivery = await makeDelivery(event.id, { transport: "WEBHOOK" });
      const outcome = await executorLib.processNextDelivery({ resolver: sendResolver("chan-1"), owner: "w1" });
      expect(outcome).toEqual({ deliveryId: delivery.id, outcome: "failed", errorClass: "unsupported_transport" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("MP — deadline partagé entre ouverture et envoi", () => {
    it("sendDirectMessage : les deux appels dérivent le même budget de timeout, un seul échec bloquerait les deux", async () => {
      const event = await makeEvent();
      const delivery = await makeDelivery(event.id, {
        channel: "DISCORD_DM",
        targetSlot: "default-guild:SESSION:session-1:dm:user-1",
        recipientKey: "user:user-1",
      });

      fetchMock
        .mockResolvedValueOnce(jsonResponse(200, { id: "dmchan-1" }))
        .mockResolvedValueOnce(jsonResponse(200, { id: "msg-1", channel_id: "dmchan-1" }));

      const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
      timeoutSpy.mockClear();

      const resolver: DeliveryResolver = {
        async resolve() {
          return {
            eligible: true,
            action: {
              kind: "send_direct_message",
              userId: "user-1",
              message: { content: "Coucou", allowedMentions: { parse: [] } },
            },
          };
        },
      };

      const outcome = await executorLib.processNextDelivery({ resolver, owner: "w-dm" });
      expect(outcome).toEqual({ deliveryId: delivery.id, outcome: "sent" });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const [openUrl] = fetchMock.mock.calls[0];
      const [sendUrl] = fetchMock.mock.calls[1];
      expect(String(openUrl)).toBe("https://discord.com/api/v10/users/@me/channels");
      expect(String(sendUrl)).toBe("https://discord.com/api/v10/channels/dmchan-1/messages");

      // Les deux appels dérivent le même budget de timeout, dérivé du même
      // `deadline`/`now` — jamais réinitialisé entre l'ouverture et l'envoi
      // (voir `sendDirectMessage`, discord-rest.ts, et son usage dans
      // `performDiscordAction`, notification-executor.ts).
      expect(timeoutSpy).toHaveBeenCalledTimes(2);
      expect(timeoutSpy.mock.calls[0][0]).toBe(timeoutSpy.mock.calls[1][0]);

      const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(row.discordMessageId).toBe("msg-1");
      expect(row.discordChannelId).toBe("dmchan-1");
    });
  });

  describe("erreurs Discord classifiées", () => {
    it("rate limit (429) : nextAttemptAt respecte exactement le Retry-After indiqué par Discord", async () => {
      const event = await makeEvent();
      const delivery = await makeDelivery(event.id);
      fetchMock.mockResolvedValueOnce(
        jsonResponse(429, { message: "rate limited", retry_after: 3, global: false }, { "Retry-After": "3" })
      );
      const now = new Date("2026-01-01T00:00:00.000Z");
      const outcome = await executorLib.processNextDelivery({ resolver: sendResolver("chan-1"), owner: "w1", now });
      expect(outcome).toEqual({ deliveryId: delivery.id, outcome: "retrying", errorClass: "discord:rate_limited" });
      // Aucun retry immédiat caché : un seul appel réseau, la reprise
      // passe entièrement par `nextAttemptAt`/une future exécution cron.
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(row.status).toBe("PENDING");
      expect(row.nextAttemptAt?.getTime()).toBe(now.getTime() + 3000);
    });

    it("échec permanent (403 générique) : FAILED terminal, jamais de nextAttemptAt", async () => {
      const event = await makeEvent();
      const delivery = await makeDelivery(event.id);
      fetchMock.mockResolvedValueOnce(jsonResponse(403, { code: 50013, message: "Missing Permissions" }));
      const outcome = await executorLib.processNextDelivery({ resolver: sendResolver("chan-1"), owner: "w1" });
      expect(outcome).toEqual({ deliveryId: delivery.id, outcome: "failed", errorClass: "discord:auth_or_permission" });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(row.status).toBe("FAILED");
      expect(row.nextAttemptAt).toBeNull();
    });

    it("résultat réseau incertain (fetch rejette) : retryable, backoff appliqué, jamais un succès, jamais un second appel immédiat", async () => {
      const event = await makeEvent();
      const delivery = await makeDelivery(event.id);
      fetchMock.mockRejectedValueOnce(new DOMException("aborted", "TimeoutError"));
      const now = new Date("2026-01-01T00:00:00.000Z");
      const outcome = await executorLib.processNextDelivery({ resolver: sendResolver("chan-1"), owner: "w1", now });
      expect(outcome).toEqual({ deliveryId: delivery.id, outcome: "retrying", errorClass: "discord:network_uncertain" });
      // Aucun retry immédiat caché : un seul `fetch` malgré l'incertitude
      // du résultat — la reprise attend nextAttemptAt, jamais tentée dans
      // la foulée de cette même requête.
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(row.status).toBe("PENDING");
      // Backoff de base (RETRY_BASE_MS) pour la 1ère tentative — voir
      // notification-executor.ts, computeRetryBackoffMs.
      expect(row.nextAttemptAt?.getTime()).toBe(now.getTime() + 60_000);
    });
  });

  describe("budget — arrêt avant tout appel réseau", () => {
    it("budget de bail insuffisant avant appel : aucun fetch tenté, repassée PENDING", async () => {
      const event = await makeEvent();
      const delivery = await makeDelivery(event.id);
      // leaseMs < MIN_CALL_MARGIN_MS (5000ms, notification-delivery.ts) :
      // hasSufficientLeaseRemaining est fausse dès la réservation posée.
      const outcome = await executorLib.processNextDelivery({
        resolver: sendResolver("chan-1"),
        owner: "w1",
        leaseMs: 1_000,
      });
      expect(outcome).toEqual({ deliveryId: delivery.id, outcome: "retrying", errorClass: "insufficient_lease" });
      expect(fetchMock).not.toHaveBeenCalled();

      const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(row.status).toBe("PENDING");
    });

    it("budget GLOBAL de l'exécuteur insuffisant (batchDeadline plus proche que le bail) : aucun fetch tenté, jamais le bail seul consulté", async () => {
      const event = await makeEvent();
      const delivery = await makeDelivery(event.id);
      const now = new Date("2026-01-01T00:00:00.000Z");
      // Bail large (30s par défaut) largement suffisant à lui seul — mais
      // le budget du BATCH expire dans 500ms, bien sous MIN_CALL_MARGIN_MS
      // (5000ms) : c'est cette échéance-là qui doit bloquer l'appel, pas
      // le bail. Preuve que `processNextDelivery` respecte les DEUX
      // contraintes, pas seulement `reservedUntil`.
      const batchDeadline = new Date(now.getTime() + 500);
      const outcome = await executorLib.processNextDelivery({
        resolver: sendResolver("chan-1"),
        owner: "w1",
        now,
        batchDeadline,
      });
      expect(outcome).toEqual({
        deliveryId: delivery.id,
        outcome: "retrying",
        errorClass: "insufficient_batch_budget",
      });
      expect(fetchMock).not.toHaveBeenCalled();

      const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(row.status).toBe("PENDING");
    });

    it("runExecutorBatch propage sa propre échéance à chaque livraison traitée (pas seulement entre deux réclamations)", async () => {
      const event = await makeEvent();
      const delivery = await makeDelivery(event.id);
      // `now` volontairement PAS fixé ici (temps réel des deux côtés,
      // boucle et `processNextDelivery`) pour éviter de faire courir la
      // vérification "temps mur écoulé" de la boucle (`Date.now()` réel)
      // contre une horloge figée dans le passé. Budget de batch choisi
      // entre deux bornes : assez large pour survivre à l'aller-retour
      // réel réservation+claim sans faire échouer la vérification
      // GROSSIÈRE de la boucle elle-même (`Date.now() >= batchDeadlineMs`
      // avant même de réclamer), mais strictement sous MIN_CALL_MARGIN_MS
      // (5000ms) pour que le nouveau contrôle FIN, à l'intérieur de
      // `processNextDelivery` une fois la livraison déjà réclamée,
      // échoue lui de façon déterministe.
      const summary = await executorLib.runExecutorBatch({
        resolver: sendResolver("chan-1"),
        owner: "batch-tight",
        batchBudgetMs: 2_000,
      });
      expect(summary.processed).toBe(1);
      expect(summary.retrying).toBe(1);
      expect(fetchMock).not.toHaveBeenCalled();

      const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(row.status).toBe("PENDING");
      expect(row.errorClass).toBe("insufficient_batch_budget");
    });
  });

  describe("plafond de tentatives", () => {
    it("au-delà de MAX_DELIVERY_ATTEMPTS, un échec Discord par ailleurs retryable devient FAILED terminal", async () => {
      const event = await makeEvent();
      const delivery = await makeDelivery(event.id);
      // `claimNextDelivery` incrémente `attempts` de 1 à la réservation —
      // partir de MAX-1 amène `attempts` exactement à MAX après le claim
      // de ce test, le point de bascule retryable → terminal.
      await db.notificationDelivery.update({
        where: { id: delivery.id },
        data: { attempts: executorLib.MAX_DELIVERY_ATTEMPTS - 1 },
      });

      fetchMock.mockResolvedValueOnce(jsonResponse(500, {}));
      const outcome = await executorLib.processNextDelivery({ resolver: sendResolver("chan-1"), owner: "w1" });
      expect(outcome).toEqual({
        deliveryId: delivery.id,
        outcome: "failed",
        errorClass: "discord:server_error:max_attempts_exceeded",
      });

      const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(row.status).toBe("FAILED");
      expect(row.nextAttemptAt).toBeNull();
      expect(row.attempts).toBe(executorLib.MAX_DELIVERY_ATTEMPTS);
    });

    it("juste EN DESSOUS du plafond, le même échec reste retryable (PENDING avec nextAttemptAt)", async () => {
      const event = await makeEvent();
      const delivery = await makeDelivery(event.id);
      await db.notificationDelivery.update({
        where: { id: delivery.id },
        data: { attempts: executorLib.MAX_DELIVERY_ATTEMPTS - 2 },
      });

      fetchMock.mockResolvedValueOnce(jsonResponse(500, {}));
      const outcome = await executorLib.processNextDelivery({ resolver: sendResolver("chan-1"), owner: "w1" });
      expect(outcome).toEqual({ deliveryId: delivery.id, outcome: "retrying", errorClass: "discord:server_error" });

      const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(row.status).toBe("PENDING");
      expect(row.nextAttemptAt).not.toBeNull();
    });
  });

  describe("route cron — désactivée par défaut, authentification", () => {
    it("CRON_SECRET absente → 503, aucune réservation, aucun appel Discord", async () => {
      const event = await makeEvent();
      const delivery = await makeDelivery(event.id);
      vi.stubEnv("CRON_SECRET", "");
      const { GET } = await import("@/app/api/cron/notification-executor/route");
      const res = await GET(new Request("http://localhost/api/cron/notification-executor"));
      expect(res.status).toBe(503);
      expect(fetchMock).not.toHaveBeenCalled();

      const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(row.status).toBe("PENDING");
      expect(row.attempts).toBe(0);
    });

    it("en-tête Authorization incorrect → 401, aucune réservation, aucun appel Discord", async () => {
      const event = await makeEvent();
      const delivery = await makeDelivery(event.id);
      vi.stubEnv("CRON_SECRET", "s3cret");
      const { GET } = await import("@/app/api/cron/notification-executor/route");
      const res = await GET(
        new Request("http://localhost/api/cron/notification-executor", { headers: { authorization: "Bearer wrong" } })
      );
      expect(res.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();

      const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(row.status).toBe("PENDING");
      expect(row.attempts).toBe(0);
    });

    it("désactivée par défaut (NOTIFICATION_EXECUTOR_ENABLED absente) : aucune réservation, aucune tentative, aucun appel Discord", async () => {
      vi.stubEnv("CRON_SECRET", "s3cret");
      const event = await makeEvent();
      const delivery = await makeDelivery(event.id);

      const { GET } = await import("@/app/api/cron/notification-executor/route");
      const res = await GET(
        new Request("http://localhost/api/cron/notification-executor", { headers: { authorization: "Bearer s3cret" } })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ enabled: false, processed: 0 });
      expect(fetchMock).not.toHaveBeenCalled();

      const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(row.status).toBe("PENDING");
      expect(row.attempts).toBe(0);
    });

    it("activée mais sans résolveur métier réel branché : NOT_CONFIGURED_RESOLVER refuse tout, aucun appel Discord", async () => {
      vi.stubEnv("CRON_SECRET", "s3cret");
      vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
      const event = await makeEvent();
      const delivery = await makeDelivery(event.id);

      const { GET } = await import("@/app/api/cron/notification-executor/route");
      const res = await GET(
        new Request("http://localhost/api/cron/notification-executor", { headers: { authorization: "Bearer s3cret" } })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.enabled).toBe(true);
      expect(body.sent).toBe(0);
      expect(body.failed).toBe(1);
      expect(fetchMock).not.toHaveBeenCalled();

      const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(row.status).toBe("FAILED");
      expect(row.errorClass).toBe("resolver:not_configured");
    });
  });
});
