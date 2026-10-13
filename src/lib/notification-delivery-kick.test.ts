import { beforeEach, describe, expect, it, vi } from "vitest";

const { kick } = vi.hoisted(() => ({ kick: vi.fn() }));
vi.mock("@/lib/notification-executor-kick", () => ({ kickNotificationExecutor: kick }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { enqueueDelivery, type NotificationDb } from "./notification-delivery";

const input = { eventId: "e1", channel: "DISCORD_CHANNEL" as const, transport: "BOT" as const, recipientKey: "user:u1", targetSlot: "slot" };

describe("enqueueDelivery → kick de l'executor", () => {
  beforeEach(() => kick.mockClear());

  it("demande un passage après l'écriture d'une livraison", async () => {
    const createManyAndReturn = vi.fn().mockResolvedValue([{ id: "d1" }]);
    const db = { notificationDelivery: { createManyAndReturn } } as unknown as NotificationDb;
    await expect(enqueueDelivery(input, db)).resolves.toEqual({ id: "d1" });
    expect(createManyAndReturn).toHaveBeenCalledTimes(1);
    expect(kick).toHaveBeenCalledTimes(1);
  });

  it("livraison déjà présente : relue, sans nouveau passage", async () => {
    const findUniqueOrThrow = vi.fn().mockResolvedValue({ id: "d0" });
    const db = { notificationDelivery: { createManyAndReturn: vi.fn().mockResolvedValue([]), findUniqueOrThrow } } as unknown as NotificationDb;
    await expect(enqueueDelivery(input, db)).resolves.toEqual({ id: "d0" });
    expect(kick).not.toHaveBeenCalled();
  });

  it("ne demande rien si l'écriture échoue", async () => {
    const db = { notificationDelivery: { createManyAndReturn: vi.fn().mockRejectedValue(new Error("db")) } } as unknown as NotificationDb;
    await expect(enqueueDelivery(input, db)).rejects.toThrow("db");
    expect(kick).not.toHaveBeenCalled();
  });
});
