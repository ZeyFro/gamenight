import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const { getCurrentUserMock, redirectMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  redirectMock: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

if (!TEST_DATABASE_URL) console.warn("[calendar actions integration] TEST_DATABASE_URL absente — tests d'écriture des dates ignorés.");

describe.skipIf(!TEST_DATABASE_URL)("dates communautaires : autorisation et portée (Postgres)", () => {
  let db: import("@prisma/client").PrismaClient;
  let saveBirthday: typeof import("./actions").saveCommunityBirthdayAction;
  let createDate: typeof import("./actions").createCommunityDateAction;
  let deleteDate: typeof import("./actions").deleteCommunityDateAction;
  let memberId: string;
  let adminId: string;
  let outsiderId: string;
  let communityId: string;
  let otherCommunityId: string;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as import("@prisma/client").PrismaClient;
    ({ saveCommunityBirthdayAction: saveBirthday, createCommunityDateAction: createDate, deleteCommunityDateAction: deleteDate } = await import("./actions"));
  });
  afterAll(async () => { await db.$disconnect(); vi.unstubAllEnvs(); });

  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    await db.$executeRawUnsafe('TRUNCATE "CommunityDate", "Membership", "Community", "User" CASCADE');
    communityId = (await db.community.create({ data: { id: "dates-a", slug: "dates-a", name: "A", status: "ACTIVE" } })).id;
    otherCommunityId = (await db.community.create({ data: { id: "dates-b", slug: "dates-b", name: "B", status: "ACTIVE" } })).id;
    memberId = (await db.user.create({ data: { id: "dates-member", discordId: "dates-member", discordName: "Membre", activeCommunityId: communityId } })).id;
    adminId = (await db.user.create({ data: { id: "dates-admin", discordId: "dates-admin", discordName: "Admin", activeCommunityId: communityId } })).id;
    outsiderId = (await db.user.create({ data: { id: "dates-outsider", discordId: "dates-outsider", discordName: "Autre", activeCommunityId: otherCommunityId } })).id;
    await db.membership.createMany({ data: [
      { userId: memberId, communityId, status: "ACTIVE", role: "MEMBER" },
      { userId: adminId, communityId, status: "ACTIVE", role: "ADMIN" },
      { userId: outsiderId, communityId: otherCommunityId, status: "ACTIVE", role: "OWNER" },
    ] });
    getCurrentUserMock.mockResolvedValue({ id: memberId });
    redirectMock.mockClear();
  });

  const form = (values: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(values)) data.set(key, value);
    return data;
  };

  it("enregistre uniquement le jour et le mois du membre authentifié, jamais un id fourni par le formulaire", async () => {
    await expect(saveBirthday(form({ date: "1996-02-29", memberId: outsiderId }))).rejects.toThrow("REDIRECT:/calendrier?date=1996-02-29");
    const birthday = await db.communityDate.findFirstOrThrow();
    expect(birthday).toMatchObject({ communityId, memberId, createdById: memberId, kind: "BIRTHDAY", title: null, repeatsAnnually: true });
    expect(birthday.date.toISOString()).toBe("2000-02-29T00:00:00.000Z");
  });

  it("refuse une date importante à un membre, mais laisse un admin la créer dans son serveur", async () => {
    const values = { title: "Anniversaire du serveur", date: "2026-10-08", annual: "on" };
    await createDate(form(values));
    expect(await db.communityDate.count()).toBe(0);

    getCurrentUserMock.mockResolvedValue({ id: adminId });
    await expect(createDate(form(values))).rejects.toThrow("REDIRECT:/calendrier?date=2026-10-08");
    expect(await db.communityDate.findMany()).toMatchObject([
      { communityId, createdById: adminId, memberId: null, kind: "IMPORTANT", title: values.title, repeatsAnnually: true, date: new Date("2000-10-08T00:00:00.000Z") },
    ]);
  });

  it("ne permet pas à un autre membre ni à un autre serveur de retirer un anniversaire", async () => {
    const birthday = await db.communityDate.create({ data: { communityId, createdById: memberId, memberId, kind: "BIRTHDAY", date: new Date("2000-10-08T00:00:00Z"), repeatsAnnually: true } });
    getCurrentUserMock.mockResolvedValue({ id: adminId });
    await deleteDate(form({ id: birthday.id }));
    expect(await db.communityDate.findUnique({ where: { id: birthday.id } })).not.toBeNull();

    getCurrentUserMock.mockResolvedValue({ id: outsiderId });
    await deleteDate(form({ id: birthday.id }));
    expect(await db.communityDate.findUnique({ where: { id: birthday.id } })).not.toBeNull();
  });
});
