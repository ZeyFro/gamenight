import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

/**
 * Audit du 23/11/2026, constat 1.14 : plafond de MP personnels reçus par destinataire et par jour, appliqué à l'enfilement.
 * Postgres local 127.0.0.1 uniquement ; aucun envoi Discord (aucun executor lancé).
 */
const url = process.env.TEST_DATABASE_URL;
if (url && new URL(url).hostname !== "127.0.0.1") throw new Error("Postgres local 127.0.0.1 uniquement");
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: url ? new PrismaClient({ datasourceUrl: url }) : {} };
});
vi.mock("@/lib/notification-executor-kick", () => ({ kickNotificationExecutor: vi.fn() }));
const warn = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn, error: vi.fn() } }));
if (!url) console.warn("[notification-dm-quota] TEST_DATABASE_URL absente : tests PostgreSQL SKIPPÉS.");

describe.skipIf(!url)("plafond de MP reçus par destinataire (Postgres)", () => {
  let db: import("@prisma/client").PrismaClient;
  let lib: typeof import("./notification-delivery");
  const scope = "dm-" + randomUUID().slice(0, 8);
  let counter = 0;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as import("@prisma/client").PrismaClient;
    lib = await import("./notification-delivery");
  });
  afterAll(async () => {
    await db.rateLimitWindow.deleteMany({ where: { key: { contains: scope } } });
    await db.$disconnect();
  });
  beforeEach(async () => {
    warn.mockClear();
    await db.$executeRawUnsafe(`TRUNCATE "NotificationDelivery", "NotificationEvent" CASCADE`);
    await db.rateLimitWindow.deleteMany({ where: { key: { contains: scope } } });
  });

  async function dm(recipient: string, overrides: Partial<Parameters<typeof lib.enqueueDelivery>[0]> = {}) {
    counter += 1;
    const event = await lib.createNotificationEvent({ category: "SESSION", eventType: "SESSION_INVITE", sourceId: `s-${counter}`, occurrence: String(counter) });
    return lib.enqueueDelivery({
      eventId: event.id, channel: "DISCORD_DM", transport: "BOT", operation: "SEND", recipientKey: recipient,
      targetSlot: `default-guild:SESSION:s-${counter}:invite`, ...overrides,
    });
  }

  it("le plafond est de 20 MP par destinataire et par jour", () => {
    expect(lib.DM_RECEIVED_DAILY_LIMIT).toBe(20);
  });

  it("le 21e MP du jour est abandonné (SKIPPED, motif dm_quota), conservé et journalisé, jamais perdu en silence", async () => {
    const recipient = `user:${scope}-a`;
    const statuses: string[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await dm(recipient)).status);
    expect(statuses.slice(0, 20).every((status) => status === "PENDING")).toBe(true);
    expect(statuses[20]).toBe("SKIPPED");
    const skipped = await db.notificationDelivery.findMany({ where: { recipientKey: recipient, status: "SKIPPED" } });
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({ errorClass: "dm_quota", lastError: "dm_quota_exceeded:20/24h" });
    expect(warn).toHaveBeenCalledWith("notification-delivery", expect.stringContaining("Plafond de MP"), expect.objectContaining({ deliveryId: skipped[0].id }));
    expect(await db.notificationDelivery.count({ where: { recipientKey: recipient, status: "PENDING" } })).toBe(20);
  });

  it("le plafond est propre à chaque destinataire", async () => {
    for (let i = 0; i < 21; i++) await dm(`user:${scope}-b`);
    expect((await dm(`user:${scope}-c`)).status).toBe("PENDING");
  });

  it("un rejeu idempotent ne consomme pas le plafond", async () => {
    const recipient = `user:${scope}-d`;
    const event = await lib.createNotificationEvent({ category: "SESSION", eventType: "SESSION_INVITE", sourceId: "same", occurrence: "1" });
    const input = { eventId: event.id, channel: "DISCORD_DM" as const, transport: "BOT" as const, operation: "SEND" as const, recipientKey: recipient, targetSlot: "default-guild:SESSION:same:invite" };
    for (let i = 0; i < 30; i++) expect((await lib.enqueueDelivery(input)).status).toBe("PENDING");
    expect(await db.notificationDelivery.count({ where: { recipientKey: recipient } })).toBe(1);
    expect((await dm(recipient)).status).toBe("PENDING");
  });

  it("les éditions d'un MP déjà envoyé et les messages de salon ne comptent pas", async () => {
    const recipient = `user:${scope}-e`;
    for (let i = 0; i < 20; i++) await dm(recipient);
    expect((await dm(recipient, { operation: "EDIT" })).status).toBe("PENDING");
    expect((await dm(recipient, { channel: "DISCORD_CHANNEL" })).status).toBe("PENDING");
    expect((await dm(recipient)).status).toBe("SKIPPED");
  });
});
