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
 * Historique : la toute première version de `claimNextDelivery` (verrou
 * advisory seul, sans vérification explicite de réservation active) a été
 * mise en défaut PAR CES MÊMES TESTS avant d'être corrigée — le test
 * "deux réservations séquentielles" ci-dessous a d'abord échoué (les deux
 * réservations aboutissaient) avant le correctif. Le laisser dans cette
 * suite est volontaire : il documente et verrouille la garantie contre une
 * régression future.
 *
 * Nécessite `TEST_DATABASE_URL` — une base PostgreSQL dédiée aux tests,
 * JAMAIS la base de production/Neon. Voir docs/DEVELOPPEMENT_LOCAL.md ("Tests d'intégration
 * notifications") pour la procédure de mise en place locale. Si la
 * variable est absente, toute la suite est SKIPPÉE explicitement (pas de
 * faux vert) avec un avertissement clair.
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
      "cette exécution. Voir docs/DEVELOPPEMENT_LOCAL.md pour lancer une base PostgreSQL " +
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

  let eventCounter = 0;
  it("claim : le fuseau PostgreSQL ne rend pas une échéance UTC future éligible", async () => {
    const now = new Date("2026-10-06T12:00:00Z");
    const event = await makeEvent();
    const delivery = await makeDelivery(event.id);
    await db.notificationDelivery.update({ where: { id: delivery.id }, data: { nextAttemptAt: new Date(now.getTime() + 12_000) } });
    const original = await db.$queryRawUnsafe<Array<{ TimeZone: string }>>("SHOW TimeZone");
    const [database] = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    expect(new URL(TEST_DATABASE_URL!).hostname).toBe("127.0.0.1");
    expect(database.name).toMatch(/^[a-zA-Z0-9_]+$/);
    // Toutes les connexions du pool utilisent le même fuseau non UTC, puis restauration.
    await db.$executeRawUnsafe(`ALTER DATABASE "${database.name}" SET timezone TO 'Europe/Paris'`);
    await db.$disconnect();
    try {
      const zone = await db.$queryRawUnsafe<Array<{ TimeZone: string }>>("SHOW TimeZone");
      expect(zone[0].TimeZone).toBe("Europe/Paris");
      expect(await lib.claimNextDelivery("early", { now: new Date(now.getTime() + 5_000) })).toBeNull();
      expect((await lib.claimNextDelivery("due", { now: new Date(now.getTime() + 13_000) }))?.id).toBe(delivery.id);
    } finally {
      await db.$executeRawUnsafe(`ALTER DATABASE "${database.name}" SET timezone TO '${original[0].TimeZone.replaceAll("'", "''")}'`);
      await db.$disconnect();
    }
  });
  async function makeEvent(overrides: Partial<Parameters<typeof lib.createNotificationEvent>[0]> = {}) {
    eventCounter += 1;
    return lib.createNotificationEvent({
      category: "SESSION",
      eventType: "SESSION_MODIFIED",
      sourceId: "session-1",
      occurrence: String(eventCounter),
      ...overrides,
    });
  }

  async function makeDelivery(
    eventId: string,
    overrides: Partial<Parameters<typeof lib.enqueueDelivery>[0]> = {}
  ) {
    return lib.enqueueDelivery({
      eventId,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: "guild:category:SESSION",
      targetSlot: "default-guild:SESSION:session-1:announce",
      ...overrides,
    });
  }

  describe("idempotence", () => {
    it("createNotificationEvent : deux appels identiques renvoient le même événement, pas de doublon", async () => {
      const a = await lib.createNotificationEvent({
        category: "SESSION",
        eventType: "SESSION_CREATED",
        sourceId: "session-1",
      });
      const b = await lib.createNotificationEvent({
        category: "SESSION",
        eventType: "SESSION_CREATED",
        sourceId: "session-1",
      });
      expect(b.id).toBe(a.id);
      expect(await db.notificationEvent.count()).toBe(1);
    });

    it("enqueueDelivery : deux appels identiques renvoient la même livraison, pas de doublon", async () => {
      const event = await makeEvent();
      const a = await makeDelivery(event.id);
      const b = await makeDelivery(event.id);
      expect(b.id).toBe(a.id);
      expect(await db.notificationDelivery.count()).toBe(1);
    });

    it("deux targetSlot différents (ex. annonce et fil) ne se bloquent jamais l'un l'autre", async () => {
      const event = await makeEvent();
      const announce = await makeDelivery(event.id, {
        operation: "EDIT",
        targetSlot: "default-guild:SESSION:session-1:announce",
      });
      const thread = await makeDelivery(event.id, {
        operation: "SEND",
        targetSlot: "default-guild:SESSION:session-1:thread",
      });
      // L'EDIT de l'annonce dépend d'un SEND déjà SENT sur SA cible — ici
      // absent, donc bloquée ; le SEND du fil, cible différente, n'est pas
      // concerné et doit rester réclamable immédiatement.
      const claimed = await lib.claimNextDelivery("worker-1");
      expect(claimed?.id).toBe(thread.id);
      void announce;
    });
  });

  describe("exclusivité par cible — corrigée (simultanée ET séquentielle)", () => {
    /**
     * EDIT et ARCHIVE (jamais deux SEND) — volontaire : deux livraisons de
     * la MÊME opération sur la même cible sont comparées par
     * `supersedeStaleDeliveries`/la logique intégrée au claim (la plus
     * récente périme l'autre, voir "ordre des éditions" plus bas), ce qui
     * fausserait un test d'EXCLUSIVITÉ pure. EDIT et ARCHIVE sont deux
     * opérations distinctes, jamais comparées entre elles pour la
     * péremption, mais doivent quand même s'exclure mutuellement (même
     * cible) — isole proprement le mécanisme testé ici.
     */
    async function makeEditAndArchiveCandidates(targetSlot: string) {
      const sendEvent = await makeEvent();
      const send = await makeDelivery(sendEvent.id, { operation: "SEND", targetSlot });
      const claimedSend = await lib.claimNextDelivery("worker-send");
      await lib.finalizeDeliverySuccess(send.id, claimedSend!.reservationToken!, {
        discordMessageId: "msg-announce",
      });

      const editEvent = await makeEvent();
      const archiveEvent = await makeEvent();
      const edit = await makeDelivery(editEvent.id, { operation: "EDIT", targetSlot });
      const archive = await makeDelivery(archiveEvent.id, { operation: "ARCHIVE", targetSlot });
      return { edit, archive };
    }

    it("deux réservations SÉQUENTIELLES sur la même cible : la seconde est refusée tant que la première n'est pas finalisée", async () => {
      const targetSlot = "default-guild:SESSION:session-1:announce";
      const { edit, archive } = await makeEditAndArchiveCandidates(targetSlot);

      const claimedFirst = await lib.claimNextDelivery("worker-1");
      expect(claimedFirst).not.toBeNull();
      const [first, second] = claimedFirst!.id === edit.id ? [edit, archive] : [archive, edit];

      // `second` est le seul autre candidat PENDING pour cette cible — tant
      // que `first` reste RESERVED, une tentative séquentielle (pas
      // concurrente) doit échouer : c'est exactement le défaut confirmé
      // avant correctif (le verrou advisory seul, relâché au commit de la
      // réservation de `first`, n'aurait rien empêché ici).
      const secondAttempt = await lib.claimNextDelivery("worker-2");
      expect(secondAttempt).toBeNull();

      const rows = await db.notificationDelivery.findMany({ orderBy: { id: "asc" } });
      const statusById = new Map(rows.map((r) => [r.id, r.status]));
      expect(statusById.get(first.id)).toBe("RESERVED");
      expect(statusById.get(second.id)).toBe("PENDING");

      // Une fois `first` finalisée, la cible est libre : `second` devient
      // réclamable.
      await lib.finalizeDeliverySuccess(first.id, claimedFirst!.reservationToken!, {});
      const claimedSecond = await lib.claimNextDelivery("worker-3");
      expect(claimedSecond?.id).toBe(second.id);
    });

    it("deux réservations SIMULTANÉES sur la même cible : au plus une aboutit", async () => {
      const targetSlot = "default-guild:SESSION:session-1:announce";
      const { edit, archive } = await makeEditAndArchiveCandidates(targetSlot);

      const [claim1, claim2] = await Promise.all([
        lib.claimNextDelivery("worker-a"),
        lib.claimNextDelivery("worker-b"),
      ]);

      const claimedCount = [claim1, claim2].filter((c) => c !== null).length;
      expect(claimedCount).toBe(1);

      const reserved = await db.notificationDelivery.findMany({ where: { status: "RESERVED" } });
      expect(reserved).toHaveLength(1);
      const pending = await db.notificationDelivery.findMany({ where: { status: "PENDING" } });
      expect(pending).toHaveLength(1);
      expect(new Set([...reserved.map((r) => r.id), ...pending.map((r) => r.id)])).toEqual(
        new Set([edit.id, archive.id])
      );
    });

    it("SEND, EDIT et ARCHIVE visant la même cible s'excluent mutuellement", async () => {
      const targetSlot = "default-guild:SESSION:session-1:announce";
      const sendEvent = await makeEvent();
      const send = await makeDelivery(sendEvent.id, { operation: "SEND", targetSlot });
      const claimedSend = await lib.claimNextDelivery("worker-send");
      expect(claimedSend?.id).toBe(send.id);
      await lib.finalizeDeliverySuccess(send.id, claimedSend!.reservationToken!, {
        discordMessageId: "msg-1",
        discordChannelId: "chan-1",
      });

      const editEvent = await makeEvent();
      const archiveEvent = await makeEvent();
      const edit = await makeDelivery(editEvent.id, { operation: "EDIT", targetSlot });
      const archive = await makeDelivery(archiveEvent.id, { operation: "ARCHIVE", targetSlot });

      const claimedFirst = await lib.claimNextDelivery("worker-1");
      expect([edit.id, archive.id]).toContain(claimedFirst?.id);

      // L'autre opération sur la MÊME cible doit être bloquée pendant que
      // la première est RESERVED — même si ce sont des opérations
      // DIFFÉRENTES (contrairement à l'ancienne portée d'exclusion, qui
      // était par (targetSlot, operation) et aurait laissé passer les deux
      // en parallèle).
      const claimedSecond = await lib.claimNextDelivery("worker-2");
      expect(claimedSecond).toBeNull();
    });

    it("N claims concurrents sur N cibles indépendantes obtiennent chacun une livraison distincte", async () => {
      const targetCount = 8;
      const event = await makeEvent();
      const deliveries = await Promise.all(
        Array.from({ length: targetCount }, (_, i) =>
          makeDelivery(event.id, {
            recipientKey: `user:${i}`,
            targetSlot: `default-guild:SESSION:session-1:slot-${i}`,
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

    it("claimNextDelivery incrémente attempts et pose reservedBy/reservationToken/reservedUntil", async () => {
      const event = await makeEvent();
      const d = await makeDelivery(event.id);

      const claimed = await lib.claimNextDelivery("worker-1", { leaseMs: 5_000 });
      expect(claimed).not.toBeNull();
      expect(claimed!.id).toBe(d.id);
      expect(claimed!.status).toBe("RESERVED");
      expect(claimed!.reservedBy).toBe("worker-1");
      expect(claimed!.attempts).toBe(1);
      expect(claimed!.reservedUntil).not.toBeNull();
      expect(claimed!.reservationToken).toBeTruthy();
      expect(claimed!.targetMessage).toBeNull();
    });
  });

  describe("finalisation conditionnelle par reservationToken", () => {
    it("succès avec le bon jeton pose les refs Discord", async () => {
      const event = await makeEvent();
      const d = await makeDelivery(event.id);
      const claimed = await lib.claimNextDelivery("worker-1");

      const ok = await lib.finalizeDeliverySuccess(d.id, claimed!.reservationToken!, {
        discordMessageId: "msg-123",
        discordChannelId: "chan-1",
      });
      expect(ok).toBe(true);

      const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } });
      expect(row.status).toBe("SENT");
      expect(row.discordMessageId).toBe("msg-123");
      expect(row.reservedBy).toBeNull();
      expect(row.reservationToken).toBeNull();
      expect(row.sentAt).not.toBeNull();
    });

    it("succès avec un jeton qui ne correspond plus échoue silencieusement, rien n'est écrasé", async () => {
      const event = await makeEvent();
      const d = await makeDelivery(event.id);
      await lib.claimNextDelivery("worker-1");

      const ok = await lib.finalizeDeliverySuccess(d.id, "jeton-invente", {
        discordMessageId: "msg-should-not-stick",
      });
      expect(ok).toBe(false);

      const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } });
      expect(row.status).toBe("RESERVED");
      expect(row.discordMessageId).toBeNull();
    });

    it("échec retryable repasse à PENDING avec nextAttemptAt", async () => {
      const event = await makeEvent();
      const d = await makeDelivery(event.id);
      const claimed = await lib.claimNextDelivery("worker-1");
      const nextAttemptAt = new Date(Date.now() + 60_000);

      const ok = await lib.finalizeDeliveryFailure(d.id, claimed!.reservationToken!, {
        retryable: true,
        errorClass: "network_error",
        lastError: "fetch failed",
        nextAttemptAt,
      });
      expect(ok).toBe(true);

      const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } });
      expect(row.status).toBe("PENDING");
      expect(row.nextAttemptAt?.getTime()).toBe(nextAttemptAt.getTime());
      expect(row.reservationToken).toBeNull();
    });

    it("échec non-retryable passe en FAILED terminal, jamais re-réclamée", async () => {
      const event = await makeEvent();
      const d = await makeDelivery(event.id);
      const claimed = await lib.claimNextDelivery("worker-1");

      const ok = await lib.finalizeDeliveryFailure(d.id, claimed!.reservationToken!, {
        retryable: false,
        errorClass: "invalid_token",
        lastError: "401 Unauthorized",
      });
      expect(ok).toBe(true);

      const row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } });
      expect(row.status).toBe("FAILED");

      const reclaimed = await lib.claimNextDelivery("worker-2", {
        now: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      expect(reclaimed).toBeNull();
    });
  });

  describe("réservations expirées — chaîne complète", () => {
    it("réservation A → expiration → récupération → réservation B (même reservedBy réutilisé) → finalisation tardive de A refusée", async () => {
      const event = await makeEvent();
      const d = await makeDelivery(event.id);

      const claimedAt = new Date();
      const claimedByA = await lib.claimNextDelivery("worker-pool", { leaseMs: 1_000, now: claimedAt });
      expect(claimedByA).not.toBeNull();
      const tokenA = claimedByA!.reservationToken!;

      // A "crashe" sans jamais finaliser. Bien après l'expiration du bail :
      const muchLater = new Date(claimedAt.getTime() + 60_000);
      const recovered = await lib.recoverExpiredReservations(muchLater);
      expect(recovered).toBe(1);

      const afterRecovery = await db.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } });
      expect(afterRecovery.status).toBe("PENDING");
      expect(afterRecovery.reservationToken).toBeNull();

      // B réclame la même ligne, en réutilisant EXACTEMENT le même
      // identifiant `reservedBy` que A ("worker-pool") — un worker qui
      // redémarre avec un identifiant statique est un cas réaliste, pas un
      // artefact de test.
      const claimedByB = await lib.claimNextDelivery("worker-pool", { now: muchLater });
      expect(claimedByB?.id).toBe(d.id);
      const tokenB = claimedByB!.reservationToken!;

      // Les jetons sont différents malgré le même `reservedBy` — c'est ce
      // qui protège la finalisation tardive ci-dessous.
      expect(tokenB).not.toBe(tokenA);

      const lateFinalizeByA = await lib.finalizeDeliverySuccess(d.id, tokenA, {
        discordMessageId: "msg-from-crashed-A",
      });
      expect(lateFinalizeByA).toBe(false);

      const stillOwnedByB = await db.notificationDelivery.findUniqueOrThrow({ where: { id: d.id } });
      expect(stillOwnedByB.status).toBe("RESERVED");
      expect(stillOwnedByB.reservationToken).toBe(tokenB);
      expect(stillOwnedByB.discordMessageId).toBeNull();

      // B, légitime, peut finaliser normalement.
      const finalizeByB = await lib.finalizeDeliverySuccess(d.id, tokenB, {
        discordMessageId: "msg-from-B",
      });
      expect(finalizeByB).toBe(true);
    });

    it("ne touche jamais une réservation encore dans son bail", async () => {
      const event = await makeEvent();
      await makeDelivery(event.id);
      const claimedAt = new Date();
      await lib.claimNextDelivery("worker-1", { leaseMs: 60_000, now: claimedAt });

      const stillWithinLease = new Date(claimedAt.getTime() + 1_000);
      const recovered = await lib.recoverExpiredReservations(stillWithinLease);
      expect(recovered).toBe(0);

      const row = await db.notificationDelivery.findFirst();
      expect(row?.status).toBe("RESERVED");
    });
  });

  describe("ordre des éditions et dépendance au message initial", () => {
    it("EDIT reste bloquée tant que son SEND n'est pas SENT, puis se débloque avec targetMessage résolu", async () => {
      const targetSlot = "default-guild:SESSION:session-1:announce";
      const editEvent = await makeEvent();
      const edit = await makeDelivery(editEvent.id, { operation: "EDIT", targetSlot });

      // Aucun SEND n'existe encore pour cette cible — l'EDIT est le seul
      // candidat PENDING, mais reste bloquée (dépendance non remplie),
      // jamais marquée en erreur.
      const blocked = await lib.claimNextDelivery("worker-1");
      expect(blocked).toBeNull();
      const editRow = await db.notificationDelivery.findUniqueOrThrow({ where: { id: edit.id } });
      expect(editRow.status).toBe("PENDING");

      const sendEvent = await makeEvent();
      const send = await makeDelivery(sendEvent.id, { operation: "SEND", targetSlot });
      const claimedSend = await lib.claimNextDelivery("worker-send");
      expect(claimedSend?.id).toBe(send.id);
      expect(claimedSend?.targetMessage).toBeNull();
      await lib.finalizeDeliverySuccess(send.id, claimedSend!.reservationToken!, {
        discordMessageId: "msg-announce",
        discordChannelId: "chan-1",
      });

      const claimedEdit = await lib.claimNextDelivery("worker-edit");
      expect(claimedEdit?.id).toBe(edit.id);
      expect(claimedEdit?.targetMessage).toEqual({
        discordMessageId: "msg-announce",
        discordChannelId: "chan-1",
        discordThreadId: null,
      });
    });

    it("convergence intégrée au chemin de claim — sans jamais appeler supersedeStaleDeliveries", async () => {
      const targetSlot = "default-guild:SESSION:session-1:announce";
      const sendEvent = await makeEvent();
      const send = await makeDelivery(sendEvent.id, { operation: "SEND", targetSlot });
      const claimedSend = await lib.claimNextDelivery("worker-send");
      await lib.finalizeDeliverySuccess(send.id, claimedSend!.reservationToken!, {
        discordMessageId: "msg-1",
      });

      const v1Event = await makeEvent();
      const v2Event = await makeEvent();
      const v3Event = await makeEvent();
      const v1 = await makeDelivery(v1Event.id, { operation: "EDIT", targetSlot });
      const v2 = await makeDelivery(v2Event.id, { operation: "EDIT", targetSlot });
      const v3 = await makeDelivery(v3Event.id, { operation: "EDIT", targetSlot });
      expect(v1.sequence).toBeLessThan(v2.sequence);
      expect(v2.sequence).toBeLessThan(v3.sequence);

      // Un seul appel à claimNextDelivery, AUCUN appel à
      // supersedeStaleDeliveries — la fonction doit converger seule.
      const claimed = await lib.claimNextDelivery("worker-1");
      expect(claimed?.id).toBe(v3.id);

      const rows = await db.notificationDelivery.findMany({ where: { operation: "EDIT" } });
      const statusById = new Map(rows.map((r) => [r.id, r.status]));
      expect(statusById.get(v1.id)).toBe("SKIPPED");
      expect(statusById.get(v2.id)).toBe("SKIPPED");
      expect(statusById.get(v3.id)).toBe("RESERVED");
    });

    it("ne supprime jamais deux messages distincts légitimes (ex. deux rappels différents)", async () => {
      const event = await makeEvent();
      const reminder1h = await makeDelivery(event.id, {
        operation: "SEND",
        targetSlot: "default-guild:SESSION:session-1:reminder-1h",
      });
      const reminder1d = await makeDelivery(event.id, {
        operation: "SEND",
        targetSlot: "default-guild:SESSION:session-1:reminder-1d",
      });

      const claim1 = await lib.claimNextDelivery("worker-1");
      const claim2 = await lib.claimNextDelivery("worker-2");

      // Les deux rappels sont des messages DISTINCTS (targetSlot
      // différents) — aucun des deux ne doit jamais être marqué SKIPPED au
      // prétexte que l'autre existe.
      expect(new Set([claim1?.id, claim2?.id])).toEqual(new Set([reminder1h.id, reminder1d.id]));
      const rows = await db.notificationDelivery.findMany();
      expect(rows.every((r) => r.status === "RESERVED")).toBe(true);
    });

    it("ne touche jamais une livraison RESERVED, même si une édition plus récente existe (l'envoi en cours va au bout)", async () => {
      const targetSlot = "default-guild:SESSION:session-1:announce";
      const sendEvent = await makeEvent();
      const send = await makeDelivery(sendEvent.id, { operation: "SEND", targetSlot });
      const claimedSend = await lib.claimNextDelivery("worker-send");
      await lib.finalizeDeliverySuccess(send.id, claimedSend!.reservationToken!, {
        discordMessageId: "msg-1",
      });

      const v1 = await makeDelivery((await makeEvent()).id, { operation: "EDIT", targetSlot });
      const claimedV1 = await lib.claimNextDelivery("worker-in-flight");
      expect(claimedV1?.id).toBe(v1.id);

      const v2 = await makeDelivery((await makeEvent()).id, { operation: "EDIT", targetSlot });

      const skipped = await lib.supersedeStaleDeliveries();
      expect(skipped).toBe(0);

      const v1Row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: v1.id } });
      expect(v1Row.status).toBe("RESERVED");
      const v2Row = await db.notificationDelivery.findUniqueOrThrow({ where: { id: v2.id } });
      expect(v2Row.status).toBe("PENDING");
    });
  });
});
