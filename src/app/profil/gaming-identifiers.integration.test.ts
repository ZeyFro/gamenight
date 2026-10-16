import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const mocks = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true }));

if (!TEST_DATABASE_URL) console.warn("[gaming-identifiers] Postgres local absent : persistance SKIPPÉE.");

describe.skipIf(!TEST_DATABASE_URL)("identifiants — action et persistance Postgres", () => {
  let db: import("@prisma/client").PrismaClient;
  let update: typeof import("./gaming-identifiers-actions").updateGamingIdentifiersAction;
  let self: string;
  let other: string;
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as typeof db;
    update = (await import("./gaming-identifiers-actions")).updateGamingIdentifiersAction;
  });
  afterAll(async () => { await db?.$disconnect(); });
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "User" CASCADE');
    self = (await db.user.create({ data: { discordId: "self", discordName: "Moi", steamId64: "76561198000000000" } })).id;
    other = (await db.user.create({ data: { discordId: "other", discordName: "Autre", psnId: "AutrePSN" } })).id;
    mocks.user.mockResolvedValue({ id: self });
  });

  function data(psnId = "MonPSN") {
    const form = new FormData();
    for (const [key, value] of Object.entries({ psnId, xboxGamertag: "Xbox#1234", switchFriendCode: "SW-1234-5678-9012", epicDisplayName: "Epic", battleTag: "Nom#1234" })) form.set(key, value);
    return form;
  }

  it("enregistre les cinq identifiants, sans toucher Steam ni le compte forgé", async () => {
    const form = data(); form.set("userId", other); form.set("steamId64", "forged");
    await expect(update(form)).rejects.toThrow("identifiants=ok");
    expect(await db.user.findUniqueOrThrow({ where: { id: self } })).toMatchObject({
      psnId: "MonPSN", xboxGamertag: "Xbox#1234", switchFriendCode: "SW-1234-5678-9012", epicDisplayName: "Epic", battleTag: "Nom#1234", steamId64: "76561198000000000",
    });
    expect((await db.user.findUniqueOrThrow({ where: { id: other } })).psnId).toBe("AutrePSN");
    await expect(update(data(""))).rejects.toThrow("identifiants=ok");
    expect(await db.user.findUniqueOrThrow({ where: { id: self } })).toMatchObject({ psnId: null, xboxGamertag: "Xbox#1234" });
  });

  it("un formulaire invalide ne modifie aucun champ", async () => {
    await expect(update(data("x".repeat(101)))).rejects.toThrow("identifiants=invalide");
    expect(await db.user.findUniqueOrThrow({ where: { id: self } })).toMatchObject({ psnId: null, xboxGamertag: null, epicDisplayName: null });
  });
});
