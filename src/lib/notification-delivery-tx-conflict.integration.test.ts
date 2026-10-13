import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sous Postgres, une violation d'unicité (P2002) dans une transaction
 * interactive annule toute la transaction (25P02) : le repli « relire
 * l'existant » de `createNotificationEvent`/`enqueueDelivery` doit donc
 * fonctionner avec un `tx`, sans lever ni perdre les écritures précédentes.
 *
 * Nécessite `TEST_DATABASE_URL` : suite SKIPPÉE sinon.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn("[notification-delivery-tx-conflict] TEST_DATABASE_URL absente — suite SKIPPÉE.");
}

describe.skipIf(!TEST_DATABASE_URL)("createNotificationEvent / enqueueDelivery — doublon dans une transaction (Postgres)", () => {
  let db: import("@prisma/client").PrismaClient;
  let delivery: typeof import("./notification-delivery");

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    delivery = await import("./notification-delivery");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(`TRUNCATE "NotificationDelivery", "NotificationEvent" CASCADE`);
  });

  const eventInput = { category: "SESSION" as const, eventType: "SESSION_CREATED", sourceId: "s-1", communityId: null };

  it("événement déjà présent : le tx relit l'existant et la transaction reste utilisable", async () => {
    const existing = await delivery.createNotificationEvent(eventInput);
    const result = await db.$transaction(async (tx) => {
      const again = await delivery.createNotificationEvent(eventInput, tx);
      const other = await delivery.createNotificationEvent({ ...eventInput, sourceId: "s-2" }, tx);
      return { again, other };
    });
    expect(result.again.id).toBe(existing.id);
    expect(await db.notificationEvent.count()).toBe(2);
    expect(result.other.sourceId).toBe("s-2");
  });

  it("livraison déjà présente : le tx relit l'existante et la transaction reste utilisable", async () => {
    const event = await delivery.createNotificationEvent(eventInput);
    const input = { eventId: event.id, channel: "DISCORD_CHANNEL" as const, transport: "BOT" as const, recipientKey: "channel", targetSlot: "g:SESSION:s-1:thread" };
    const existing = await delivery.enqueueDelivery(input);
    const result = await db.$transaction(async (tx) => {
      const again = await delivery.enqueueDelivery(input, tx);
      const other = await delivery.enqueueDelivery({ ...input, targetSlot: "g:SESSION:s-1:announce" }, tx);
      return { again, other };
    });
    expect(result.again.id).toBe(existing.id);
    expect(result.other.targetSlot).toBe("g:SESSION:s-1:announce");
    expect(await db.notificationDelivery.count()).toBe(2);
  });
});
