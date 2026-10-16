import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const mocks = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true }));
if (!TEST_DATABASE_URL) console.warn("[player-equipment] Postgres local absent : persistance SKIPPÉE.");

describe.skipIf(!TEST_DATABASE_URL)("matériel — persistance Postgres et action", () => {
  let db: import("@prisma/client").PrismaClient;
  let update: typeof import("./player-equipment-actions").updatePlayerEquipmentAction;
  let self: string; let other: string;
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as typeof db;
    update = (await import("./player-equipment-actions")).updatePlayerEquipmentAction;
  });
  afterAll(async () => { await db?.$disconnect(); });
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "User" CASCADE');
    self = (await db.user.create({ data: { discordId: "self", discordName: "Moi", steamId64: "76561198000000000" } })).id;
    other = (await db.user.create({ data: { discordId: "other", discordName: "Autre", microphoneAvailable: true } })).id;
    mocks.user.mockResolvedValue({ id: self });
  });
  it("enregistre plusieurs options, conserve les autres données puis permet l'effacement", async () => {
    expect(await db.user.findUniqueOrThrow({ where: { id: self } })).toMatchObject({ inputDevices: [], availablePlatforms: [], microphoneAvailable: null });
    const form = new FormData(); form.append("inputDevices", "CONTROLLER"); form.append("inputDevices", "KEYBOARD_MOUSE");
    form.append("availablePlatforms", "WINDOWS"); form.append("availablePlatforms", "SWITCH"); form.set("microphoneAvailable", "no"); form.set("userId", other); form.set("steamId64", "forged");
    await expect(update(form)).rejects.toThrow("materiel=ok");
    expect(await db.user.findUniqueOrThrow({ where: { id: self } })).toMatchObject({ inputDevices: ["CONTROLLER", "KEYBOARD_MOUSE"], availablePlatforms: ["WINDOWS", "SWITCH"], microphoneAvailable: false, steamId64: "76561198000000000" });
    expect((await db.user.findUniqueOrThrow({ where: { id: other } })).microphoneAvailable).toBe(true);
    const cleared = new FormData(); cleared.set("microphoneAvailable", "");
    await expect(update(cleared)).rejects.toThrow("materiel=ok");
    expect(await db.user.findUniqueOrThrow({ where: { id: self } })).toMatchObject({ inputDevices: [], availablePlatforms: [], microphoneAvailable: null });
  });
  it("un choix non proposé ne provoque aucune écriture", async () => {
    const form = new FormData(); form.set("microphoneAvailable", "yes"); form.append("availablePlatforms", "forged");
    await expect(update(form)).rejects.toThrow("materiel=invalide");
    expect(await db.user.findUniqueOrThrow({ where: { id: self } })).toMatchObject({ inputDevices: [], availablePlatforms: [], microphoneAvailable: null });
  });
});
