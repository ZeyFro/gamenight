import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const mocks = vi.hoisted(() => ({ userId: "gallery-creator", put: vi.fn(), del: vi.fn() }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (TEST_DATABASE_URL && new URL(TEST_DATABASE_URL).hostname !== "127.0.0.1") throw new Error("Postgres local uniquement");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
vi.mock("@vercel/blob", () => ({ put: mocks.put, del: mocks.del }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: async () => ({ id: mocks.userId }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));
if (!TEST_DATABASE_URL) console.warn("[gallery] Postgres absent : intégrations SKIPPÉES.");

describe.skipIf(!TEST_DATABASE_URL)("galerie : enregistrement local après Blob simulé", () => {
  let db: import("@prisma/client").PrismaClient;
  let upload: typeof import("./gallery").uploadSessionGalleryImageAction;
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma;
    upload = (await import("./gallery")).uploadSessionGalleryImageAction;
  });
  afterAll(async () => { await db?.$disconnect(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Réseau interdit"); }));
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    vi.stubEnv("SESSION_MEDIA_BLOB_TOKEN", "local-test-no-network");
    mocks.userId = "gallery-creator";
    mocks.put.mockImplementation(async (pathname: string) => ({ pathname }));
    mocks.del.mockResolvedValue(undefined);
    (await import("@/lib/default-community")).resetDefaultCommunityIdCache();
    const users = ["gallery-creator", "gallery-admin"];
    await db.session.deleteMany({ where: { createdById: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.community.deleteMany({ where: { id: "gallery-community" } });
    await db.community.create({ data: { id: "gallery-community", slug: "gallery-community", name: "Galerie", status: "ACTIVE", sessionGalleryEnabled: true } });
    await db.user.createMany({ data: users.map(id => ({ id, discordId: id, discordName: id, activeCommunityId: "gallery-community" })) });
    await db.membership.createMany({ data: users.map(userId => ({ userId, communityId: "gallery-community", role: userId === "gallery-admin" ? "ADMIN" as const : "MEMBER" as const })) });
  });

  const form = (sessionId: string) => {
    const value = new FormData();
    value.set("sessionId", sessionId);
    value.set("media", new File([Uint8Array.from([0xff, 0xd8, 0xff])], "photo.jpg", { type: "image/jpeg" }));
    value.set("consent", "on");
    return value;
  };
  const session = () => db.session.create({ data: { createdById: "gallery-creator", communityId: "gallery-community", date: new Date(), status: "DONE" } });

  it("sérialise deux derniers envois pour garder huit médias maximum", async () => {
    const row = await session();
    await db.sessionGalleryMedia.createMany({ data: Array.from({ length: 7 }, (_, i) => ({ sessionId: row.id, uploadedById: "gallery-creator", pathname: `gallery-fixture/${row.id}/${i}`, mimeType: "image/jpeg", sizeBytes: 3 })) });
    let arrivals = 0;
    let release!: () => void;
    const bothUploaded = new Promise<void>(resolve => { release = resolve; });
    mocks.put.mockImplementation(async (pathname: string) => {
      if (++arrivals === 2) release();
      await bothUploaded;
      return { pathname };
    });
    const results = await Promise.allSettled([upload(form(row.id)), upload(form(row.id))]);
    expect(results.map(result => result.status === "rejected" ? result.reason.message : "resolved").sort()).toEqual([
      `REDIRECT:/sessions/${row.id}?gallery=echec`, `REDIRECT:/sessions/${row.id}?gallery=ok`,
    ]);
    expect(await db.sessionGalleryMedia.count({ where: { sessionId: row.id } })).toBe(8);
    expect(mocks.del).toHaveBeenCalledOnce();
  });

  it.each(["demotion", "revocation"])("refuse une %s pendant Blob et ne conserve aucun média", async change => {
    const row = await session();
    await db.sessionInvite.create({ data: { sessionId: row.id, userId: "gallery-admin", invitedById: "gallery-creator" } });
    mocks.userId = "gallery-admin";
    mocks.put.mockImplementationOnce(async (pathname: string) => {
      if (change === "demotion") await db.membership.update({ where: { communityId_userId: { communityId: "gallery-community", userId: "gallery-admin" } }, data: { role: "MEMBER" } });
      else await db.sessionInvite.update({ where: { sessionId_userId: { sessionId: row.id, userId: "gallery-admin" } }, data: { status: "REVOKED" } });
      return { pathname };
    });
    await expect(upload(form(row.id))).rejects.toThrow(`REDIRECT:/sessions/${row.id}?gallery=echec`);
    expect(await db.sessionGalleryMedia.count({ where: { sessionId: row.id } })).toBe(0);
    expect(mocks.del).toHaveBeenCalledOnce();
  });

  it("accepte une soirée historique de la communauté default", async () => {
    const defaultId = await (await import("@/lib/default-community")).getDefaultCommunityId();
    const original = await db.community.findUniqueOrThrow({ where: { id: defaultId } });
    try {
      await db.community.update({ where: { id: defaultId }, data: { status: "ACTIVE", sessionGalleryEnabled: true } });
      await db.membership.create({ data: { communityId: defaultId, userId: "gallery-creator" } });
      await db.user.update({ where: { id: "gallery-creator" }, data: { activeCommunityId: defaultId } });
      const row = await db.session.create({ data: { createdById: "gallery-creator", communityId: null, date: new Date(), status: "DONE" } });
      await expect(upload(form(row.id))).rejects.toThrow(`REDIRECT:/sessions/${row.id}?gallery=ok`);
      expect(await db.sessionGalleryMedia.count({ where: { sessionId: row.id } })).toBe(1);
    } finally {
      await db.community.update({ where: { id: defaultId }, data: { status: original.status, sessionGalleryEnabled: original.sessionGalleryEnabled } });
    }
  });
});
