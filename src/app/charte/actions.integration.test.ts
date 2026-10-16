import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const getCurrentUserMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/current-user", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

if (!TEST_DATABASE_URL) console.warn("[fair-play-charter.integration] TEST_DATABASE_URL absente — isolation Postgres ignorée.");

describe.skipIf(!TEST_DATABASE_URL)("charte communautaire : écriture isolée (Postgres)", () => {
  let db: import("@prisma/client").PrismaClient;
  let saveCharter: typeof import("./actions").saveFairPlayCharterAction;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as import("@prisma/client").PrismaClient;
    ({ saveFairPlayCharterAction: saveCharter } = await import("./actions"));
  });
  afterAll(async () => { await db.$disconnect(); vi.unstubAllEnvs(); });

  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    await db.$executeRawUnsafe('TRUNCATE "Membership", "Community", "User" CASCADE');
    await db.community.createMany({ data: [
      { id: "charter-a", slug: "charter-a", name: "Serveur A", status: "ACTIVE", fairPlayCharter: "Charte A" },
      { id: "charter-b", slug: "charter-b", name: "Serveur B", status: "ACTIVE", fairPlayCharter: "Charte B" },
    ] });
    const admin = await db.user.create({ data: { id: "charter-admin", discordId: "charter-admin", discordName: "Admin", activeCommunityId: "charter-a" } });
    await db.membership.createMany({ data: [
      { userId: admin.id, communityId: "charter-a", status: "ACTIVE", role: "ADMIN" },
      { userId: admin.id, communityId: "charter-b", status: "ACTIVE", role: "OWNER" },
    ] });
    getCurrentUserMock.mockResolvedValue({ id: admin.id });
  });

  it("updates only the active server, even when the form submits another community ID", async () => {
    const data = new FormData();
    data.set("charter", "Nouvelle charte A");
    data.set("communityId", "charter-b");
    await saveCharter(data);
    expect(await db.community.findUniqueOrThrow({ where: { id: "charter-a" } })).toMatchObject({ fairPlayCharter: "Nouvelle charte A" });
    expect(await db.community.findUniqueOrThrow({ where: { id: "charter-b" } })).toMatchObject({ fairPlayCharter: "Charte B" });
  });
});
