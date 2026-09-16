import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Refonte notifications Discord — fondations de livraison (PR 1/N).
 *
 * Tests d'INTÉGRATION réels contre une base PostgreSQL isolée — PAS de mock
 * Prisma (dérogation volontaire, demandée explicitement pour ce module : les
 * garanties concurrentes ici — réservation atomique, exclusivité par cible,
 * ordre des éditions — ne peuvent être prouvées que contre un vrai moteur
 * transactionnel ; un mock ne testerait que l'appel de méthodes, jamais le
 * comportement Postgres sous-jacent, ce qui invaliderait la garantie même
 * que ces tests doivent établir).
 *
 * Nécessite `TEST_DATABASE_URL` — une base PostgreSQL dédiée aux tests,
 * JAMAIS la base de production/Neon. Voir le README ("Tests d'intégration
 * notifications") pour la procédure de mise en place locale. Si la
 * variable est absente, toute la suite est SKIPPÉE explicitement (pas de
 * faux vert) avec un avertissement clair — jamais présentée comme passée.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) {
    // Jamais utilisé (suite skippée ci-dessous) — évite seulement une
    // exception au chargement du module dans les environnements sans base
    // de test configurée.
    return { prisma: {} as unknown };
  }
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn(
    "[notification-delivery.integration.test] TEST_DATABASE_URL absente — " +
      "suite SKIPPÉE. Les garanties de concurrence (réservation atomique, " +
      "exclusivité par cible, ordre des éditions) ne sont PAS validées par " +
      "cette exécution. Voir le README pour lancer une base PostgreSQL " +
      "isolée localement."
  );
}

describe.skipIf(!TEST_DATABASE_URL)("notification-delivery (intégration Postgres isolée)", () => {
  let db: import("@prisma/client").PrismaClient;
  let lib: typeof import("./notification-delivery");

  beforeAll(async () => {
    const prismaModule = await import("@/lib/prisma");
    db = prismaModule.prisma as unknown as import("@prisma/client").PrismaClient;
    lib = await import("./notification-delivery");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    // Isolation entre tests : uniquement les 2 tables de ce module, jamais
    // le reste de la base de test.
    await db.$executeRawUnsafe(`TRUNCATE "NotificationDelivery", "NotificationEvent" CASCADE`);
  });

  async function makeEvent(overrides: Partial<Parameters<typeof lib.createNotificationEvent>[0]> = {}) {
    return lib.createNotificationEvent({
      category: "SESSION",
      eventType: "SESSION_CREATED",
      sourceId: "session-1",
      ...overrides,
    });
  }

  describe("idempotence", () => {
    it("createNotificationEvent : deux appels identiques renvoient le même événement, pas de doublon", async () => {
      const a = await makeEvent();
      const b = await makeEvent();
      expect(b.id).toBe(a.id);

      const count = await db.notificationEvent.count();
      expect(count).toBe(1);
    });

    it("enqueueDelivery : deux appels identiques renvoient la même livraison, pas de doublon", async () => {
      const event = await makeEvent();
      const a = await lib.enqueueDelivery({
        eventId: event.id,
        channel: "DISCORD_CHANNEL",
        transport: "WEBHOOK",
        recipientKey: "guild:category:SESSION",
        targetSlot: "session:session-1:announce",
      });
      const b = await lib.enqueueDelivery({
        eventId: event.id,
        channel: "DISCORD_CHANNEL",
        transport: "WEBHOOK",
        recipientKey: "guild:category:SESSION",
        targetSlot: "session:session-1:announce",
      });
      expect(b.id).toBe(a.id);

      const count = await db.notificationDelivery.count();
      expect(count).toBe(1);
    });

    it("deux livraisons distinctes (opérations différentes) sur le même événement/cible ne se bloquent jamais l'une l'autre", async () => {
      const event = await makeEvent();
      const announce = await lib.enqueueDelivery({
        eventId: event.id,
        channel: "DISCORD_CHANNEL",
        transport: "BOT",
        operation: "EDIT",
        recipientKey: "guild:category:SESSION",
        targetSlot: "session:session-1:announce",
      });
      const thread = await lib.enqueueDelivery({
        eventId: event.id,
        channel: "DISCORD_CHANNEL",
        transport: "BOT",
        operation: "SEND",
        recipientKey: "guild:category:SESSION",
        targetSlot: "session:session-1:thread",
      });
      expect(announce.id).not.toBe(thread.id);

      const owner = "worker-1";
      const claimed1 = await lib.claimNextDelivery(owner);
      const claimed2 = await lib.claimNextDelivery(owner);
      const claimedIds = [claimed1?.id, claimed2?.id].sort();
      expect(claimedIds).toEqual([announce.id, thread.id].sort());
    });
  });

  describe("réservation atomique + concurrence réelle", () => {
    it("deux claims concurrents sur des cibles différentes réservent chacun une livraison distincte", async () => {
      const event = await makeEvent();
      const d1 = await lib.enqueueDelivery({
        eventId: event.id,
        channel: "DISCORD_CHANNEL",
        transport: "WEBHOOK",
        recipientKey: "guild:category:SESSION",
        targetSlot: "session:session-1:announce",
      });
      const d2 = await lib.enqueueDelivery({
        eventId: event.id,
        channel: "DISCORD_CHANNEL",
        transport: "WEBHOOK",
        recipientKey: "guild:category:TOURNAMENT",
        targetSlot: "tournament:t-1:announce",
      });

      const [c1, c2] = await Promise.all([
        lib.claimNextDelivery("worker-a"),
        lib.claimNextDelivery("worker-b"),
      ]);

      expect(c1).not.toBeNull();
      expect(c2).not.toBeNull();
      expect(c1!.id).not.toBe(c2!.id);
      expect(new Set([c1!.id, c2!.id])).toEqual(new Set([d1.id, d2.id]));

      const rows = await db.notificationDelivery.findMany({ where: { status: "RESERVED" } });
      expect(rows).toHaveLength(2);
    });

    it("N claims concurrents sur N livraisons ne réservent jamais deux fois la même ligne (pas de double claim)", async () => {
      const event = await makeEvent();
      const targetCount = 8;
      const deliveries = await Promise.all(
        Array.from({ length: targetCount }, (_, i) =>
          lib.enqueueDelivery({
            eventId: event.id,
            channel: "DISCORD_CHANNEL",
            transport: "WEBHOOK",
            recipientKey: `user:${i}`,
            targetSlot: `slot-${i}`,
          })
        )
      );

      const claims = await Promise.all(
        Array.from({ length: targetCount }, (_, i) => lib.claimNextDelivery(`worker-${i}`))
      );

      const claimedIds = claims.filter((c): c is NonNullable<typeof c> => c !== null).map((c) => c.id);
      expect(claimedIds).toHaveLength(targetCount);
      expect(new Set(claimedIds).size).toBe(targetCount);
      expect(new Set(claimedIds)).toEqual(new Set(deliveries.map((d) => d.id)));
    });

    it("exclusivité par cible : deux livraisons PENDING pour le même (targetSlot, operation) ne sont JAMAIS RESERVED en même temps", async () => {
      const event = await makeEvent();
      const targetSlot = "session:session-1:announce";
      // Deux lignes distinctes visant la MÊME cible (recipientKey différent
      // pour respecter la contrainte unique) — simule deux éditions en
      // attente sur le même message.
      const d1 = await lib.enqueueDelivery({
        eventId: event.id,
        channel: "DISCORD_CHANNEL",
        transport: "BOT",
        operation: "EDIT",
        recipientKey: "recipient-a",
        targetSlot,
      });
      const d2 = await lib.enqueueDelivery({
        eventId: event.id,
        channel: "DISCORD_CHANNEL",
        transport: "BOT",
        operation: "EDIT",
        recipientKey: "recipient-b",
        targetSlot,
      });
      expect(d1.targetSlot).toBe(d2.targetSlot);

      // Deux tentatives de claim RÉELLEMENT concurrentes (même tick event
      // loop, deux connexions Postgres distinctes sous le capot).
      const [c1, c2] = await Promise.all([
        lib.claimNextDelivery("worker-a"),
        lib.claimNextDelivery("worker-b"),
      ]);

      // Une seule des deux doit avoir été réservée — l'autre reste PENDING,
      // bloquée par l'exclusivité de cible, jamais réservée en parallèle.
      const claimedCount = [c1, c2].filter((c) => c !== null).length;
      expect(claimedCount).toBe(1);

      const reserved = await db.notificationDelivery.findMany({ where: { status: "RESERVED" } });
      expect(reserved).toHaveLength(1);
      const stillPending = await db.notificationDelivery.findMany({ where: { status: "PENDING" } });
      expect(stillPending).toHaveLength(1);
    });

    it("claimNextDelivery incrémente attempts et pose reservedBy/reservedUntil", async () => {
      const event = await makeEvent();
      const d = await lib.enqueueDelivery({
        eventId: event.id,
        channel: "DISCORD_CHANNEL",
        transport: "WEBHOOK",
        recipientKey: "guild:category:SESSION",
        targetSlot: "session:session-1:announce",
      });

      const claimed = await lib.claimNextDelivery("worker-1", { leaseMs: 5_000 });
      expect(claimed).not.toBeNull();
      expect(claimed!.id).toBe(d.id);
      expect(claimed!.status).toBe("RESERVED");
      expect(claimed!.reservedBy).toBe("worker-1");
      expect(claimed!.attempts).toBe(1);
      expect(claimed!.reservedUntil).not.toBeNull();
    });
  });

  describe("finalisation conditionnelle par le propriétaire", () => {
    it("finalizeDeliverySuccess réussit pour le propriétaire réel et pose les refs Discord", async () => {
      const event = await makeEvent();
      const d = await lib.enqueueDelivery({
        eventId: event.id,
        channel: "DISCORD_CHANNEL",
        transport: "WEBHOOK",
        recipientKey: "guild:category:SESSION",
        targetSlot: "session:session-1:announce",
      });
      await lib.claimNextDelivery("worker-1");

      const ok = await lib.finalizeDeliverySuccess(d.id, "worker-1", {
        discordMessageId: "msg-123",
        discordChannelId: "chan-1",
      });
      expect(ok).toBe(true);

      const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } });
      expect(row.status).toBe("SENT");
      expect(row.discordMessageId).toBe("msg-123");
      expect(row.reservedBy).toBeNull();
      expect(row.sentAt).not.toBeNull();
    });

    it("finalizeDeliverySuccess échoue silencieusement pour un propriétaire qui ne détient plus la réservation", async () => {
      const event = await makeEvent();
      const d = await lib.enqueueDelivery({
        eventId: event.id,
        channel: "DISCORD_CHANNEL",
        transport: "WEBHOOK",
        recipientKey: "guild:category:SESSION",
        targetSlot: "session:session-1:announce",
      });
      await lib.claimNextDelivery("worker-1");

      const ok = await lib.finalizeDeliverySuccess(d.id, "worker-IMPOSTEUR", {
        discordMessageId: "msg-should-not-stick",
      });
      expect(ok).toBe(false);

      const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } });
      expect(row.status).toBe("RESERVED");
      expect(row.discordMessageId).toBeNull();
    });

    it("finalizeDeliveryFailure retryable repasse à PENDING avec nextAttemptAt", async () => {
      const event = await makeEvent();
      const d = await lib.enqueueDelivery({
        eventId: event.id,
        channel: "DISCORD_CHANNEL",
        transport: "WEBHOOK",
        recipientKey: "guild:category:SESSION",
        targetSlot: "session:session-1:announce",
      });
      await lib.claimNextDelivery("worker-1");
      const nextAttemptAt = new Date(Date.now() + 60_000);

      const ok = await lib.finalizeDeliveryFailure(d.id, "worker-1", {
        retryable: true,
        errorClass: "network_error",
        lastError: "fetch failed",
        nextAttemptAt,
      });
      expect(ok).toBe(true);

      const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } });
      expect(row.status).toBe("PENDING");
      expect(row.nextAttemptAt?.getTime()).toBe(nextAttemptAt.getTime());
      expect(row.errorClass).toBe("network_error");
    });

    it("finalizeDeliveryFailure non-retryable passe en FAILED terminal, jamais re-réclamée", async () => {
      const event = await makeEvent();
      const d = await lib.enqueueDelivery({
        eventId: event.id,
        channel: "DISCORD_CHANNEL",
        transport: "WEBHOOK",
        recipientKey: "guild:category:SESSION",
        targetSlot: "session:session-1:announce",
      });
      await lib.claimNextDelivery("worker-1");

      const ok = await lib.finalizeDeliveryFailure(d.id, "worker-1", {
        retryable: false,
        errorClass: "invalid_token",
        lastError: "401 Unauthorized",
      });
      expect(ok).toBe(true);

      const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } });
      expect(row.status).toBe("FAILED");

      // Même longtemps après, une livraison FAILED n'est jamais reprise par
      // le claim — reste explicitement terminale.
      const reclaimed = await lib.claimNextDelivery("worker-2", {
        now: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      expect(reclaimed).toBeNull();
    });
  });

  describe("récupération après interruption (réservations expirées)", () => {
    it("recoverExpiredReservations repasse une réservation expirée à PENDING, de nouveau réclamable", async () => {
      const event = await makeEvent();
      const d = await lib.enqueueDelivery({
        eventId: event.id,
        channel: "DISCORD_CHANNEL",
        transport: "WEBHOOK",
        recipientKey: "guild:category:SESSION",
        targetSlot: "session:session-1:announce",
      });
      const claimedAt = new Date();
      await lib.claimNextDelivery("worker-crashed", { leaseMs: 1_000, now: claimedAt });

      // Bien après l'expiration du bail (1s) mais sans finalisation — simule
      // un crash du worker entre le claim et la finalisation.
      const muchLater = new Date(claimedAt.getTime() + 60_000);
      const recovered = await lib.recoverExpiredReservations(muchLater);
      expect(recovered).toBe(1);

      const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } });
      expect(row.status).toBe("PENDING");
      expect(row.reservedBy).toBeNull();
      expect(row.reservedUntil).toBeNull();

      const reclaimed = await lib.claimNextDelivery("worker-new", { now: muchLater });
      expect(reclaimed?.id).toBe(d.id);
      expect(reclaimed?.reservedBy).toBe("worker-new");
    });

    it("recoverExpiredReservations ne touche jamais une réservation encore dans son bail", async () => {
      const event = await makeEvent();
      await lib.enqueueDelivery({
        eventId: event.id,
        channel: "DISCORD_CHANNEL",
        transport: "WEBHOOK",
        recipientKey: "guild:category:SESSION",
        targetSlot: "session:session-1:announce",
      });
      const claimedAt = new Date();
      await lib.claimNextDelivery("worker-1", { leaseMs: 60_000, now: claimedAt });

      const stillWithinLease = new Date(claimedAt.getTime() + 1_000);
      const recovered = await lib.recoverExpiredReservations(stillWithinLease);
      expect(recovered).toBe(0);

      const row = await db.notificationDelivery.findFirst();
      expect(row?.status).toBe("RESERVED");
    });
  });

  describe("ordre des éditions (sérialisation exclusive par cible)", () => {
    it("supersedeStaleDeliveries abandonne (SKIPPED) les éditions PENDING dépassées par une plus récente sur la même cible", async () => {
      const event = await makeEvent();
      const targetSlot = "session:session-1:announce";
      const v1 = await lib.enqueueDelivery({
        eventId: event.id,
        channel: "DISCORD_CHANNEL",
        transport: "BOT",
        operation: "EDIT",
        recipientKey: "v1",
        targetSlot,
      });
      const v2 = await lib.enqueueDelivery({
        eventId: event.id,
        channel: "DISCORD_CHANNEL",
        transport: "BOT",
        operation: "EDIT",
        recipientKey: "v2",
        targetSlot,
      });
      const v3 = await lib.enqueueDelivery({
        eventId: event.id,
        channel: "DISCORD_CHANNEL",
        transport: "BOT",
        operation: "EDIT",
        recipientKey: "v3",
        targetSlot,
      });
      // sequence croît avec l'ordre d'insertion (SERIAL Postgres).
      expect(v1.sequence).toBeLessThan(v2.sequence);
      expect(v2.sequence).toBeLessThan(v3.sequence);

      const skippedCount = await lib.supersedeStaleDeliveries();
      expect(skippedCount).toBe(2);

      const rows = await db.notificationDelivery.findMany({ orderBy: { sequence: "asc" } });
      const statusById = new Map(rows.map((r) => [r.id, r.status]));
      expect(statusById.get(v1.id)).toBe("SKIPPED");
      expect(statusById.get(v2.id)).toBe("SKIPPED");
      expect(statusById.get(v3.id)).toBe("PENDING");

      // Seule la plus récente reste réclamable.
      const claimed = await lib.claimNextDelivery("worker-1");
      expect(claimed?.id).toBe(v3.id);
    });

    it("ne touche jamais une livraison RESERVED, même si une édition plus récente existe (l'envoi en cours va au bout)", async () => {
      const event = await makeEvent();
      const targetSlot = "session:session-1:announce";
      const v1 = await lib.enqueueDelivery({
        eventId: event.id,
        channel: "DISCORD_CHANNEL",
        transport: "BOT",
        operation: "EDIT",
        recipientKey: "v1",
        targetSlot,
      });
      const claimed = await lib.claimNextDelivery("worker-in-flight");
      expect(claimed?.id).toBe(v1.id);

      const v2 = await lib.enqueueDelivery({
        eventId: event.id,
        channel: "DISCORD_CHANNEL",
        transport: "BOT",
        operation: "EDIT",
        recipientKey: "v2",
        targetSlot,
      });

      const skipped = await lib.supersedeStaleDeliveries();
      expect(skipped).toBe(0);

      const v1Row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: v1.id } });
      expect(v1Row.status).toBe("RESERVED");
      const v2Row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: v2.id } });
      expect(v2Row.status).toBe("PENDING");
    });

    it("converge vers le dernier état après un échec retryable : l'édition périmée est abandonnée au lieu d'être retentée", async () => {
      const event = await makeEvent();
      const targetSlot = "session:session-1:announce";
      const v1 = await lib.enqueueDelivery({
        eventId: event.id,
        channel: "DISCORD_CHANNEL",
        transport: "BOT",
        operation: "EDIT",
        recipientKey: "v1",
        targetSlot,
      });
      await lib.claimNextDelivery("worker-1");
      // v1 échoue de façon transitoire pendant que v2 (plus récente) arrive.
      await lib.finalizeDeliveryFailure(v1.id, "worker-1", {
        retryable: true,
        errorClass: "network_error",
        nextAttemptAt: new Date(Date.now() - 1),
      });
      const v2 = await lib.enqueueDelivery({
        eventId: event.id,
        channel: "DISCORD_CHANNEL",
        transport: "BOT",
        operation: "EDIT",
        recipientKey: "v2",
        targetSlot,
      });

      await lib.supersedeStaleDeliveries();

      const v1Row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: v1.id } });
      expect(v1Row.status).toBe("SKIPPED");

      const claimed = await lib.claimNextDelivery("worker-2");
      expect(claimed?.id).toBe(v2.id);
    });
  });
});
