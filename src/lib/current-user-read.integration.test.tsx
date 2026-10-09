import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const { auth, temporalBadges, context } = vi.hoisted(() => ({
  auth: vi.fn(), temporalBadges: vi.fn(), context: { enabled: true },
}));
vi.mock("@/auth", () => ({ auth }));
vi.mock("@/lib/badges", () => ({ checkTemporalBadges: temporalBadges }));
vi.mock("@/lib/community-read-context", async (original) => {
  const actual = await original<typeof import("./community-read-context")>();
  return { ...actual, withCommunityReadContext: <T,>(read: () => Promise<T>) =>
    context.enabled ? actual.withCommunityReadContext(read) : read() };
});
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({
    datasourceUrl: TEST_DATABASE_URL, log: [{ emit: "event", level: "query" }],
  }) : {} };
});

if (!TEST_DATABASE_URL) console.warn("[current-user-read] Postgres absent : tests de lectures SKIPPÉS.");
describe.skipIf(!TEST_DATABASE_URL)("lectures header/chat : coût SQL et autorisations fraîches", () => {
  let db: import("@prisma/client").PrismaClient;
  let getCurrentUser: typeof import("./current-user").getCurrentUser;
  let poll: typeof import("@/app/chat/actions").getChatMessagesAction;
  let header: typeof import("@/components/Header").Header;
  let userId: string;
  const communities: Record<string, string> = {};
  const queries: string[] = [];
  beforeAll(async () => {
    db = (await import("./prisma")).prisma as unknown as typeof db;
    // Prisma's default generic omits event names; this test client emits query events.
    (db as import("@prisma/client").PrismaClient<import("@prisma/client").Prisma.PrismaClientOptions, "query">)
      .$on("query", (event) => queries.push(event.query));
    getCurrentUser = (await import("./current-user")).getCurrentUser;
    poll = (await import("@/app/chat/actions")).getChatMessagesAction;
    header = (await import("@/components/Header")).Header;
  });
  afterAll(async () => { await db?.$disconnect(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); context.enabled = true; });
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const flag of ["COMMUNITY_ISOLATION_ENABLED", "COMMUNITY_PICKER_ENABLED"]) vi.stubEnv(flag, "true");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Réseau interdit en test"); }));
    await db.$executeRawUnsafe('TRUNCATE "User", "Community" CASCADE');
    (await import("./default-community")).resetDefaultCommunityIdCache();
    for (const slug of ["default", "a", "b"]) communities[slug] = (await db.community.create({
      data: { slug, name: slug, status: "ACTIVE", discordGuildId: `guild-${slug}` },
    })).id;
    userId = (await db.user.create({ data: {
      discordId: "reader", discordName: "Zoé", activeCommunityId: communities.a, xpTotal: 9999,
    } })).id;
    for (const [slug, xpTotal] of [["a", 30], ["b", 800]] as const) {
      await db.membership.create({ data: { userId, communityId: communities[slug], status: "ACTIVE" } });
      await db.communityMemberStats.create({ data: {
        userId, communityId: communities[slug], xpTotal, streakCount: 2,
        streakLastActiveAt: new Date(Date.now() - 13 * 60 * 60 * 1000),
      } });
      await db.chatMessage.create({ data: { communityId: communities[slug], userId, content: `chat-${slug}` } });
    }
    auth.mockResolvedValue({ user: { discordId: "reader", sessionCreatedAt: Date.now() - 1000 } });
    queries.length = 0;
  });
  function expectReadOnly() {
    expect(queries.filter((q) => /\b(BEGIN|COMMIT|INSERT|UPDATE|DELETE|FOR UPDATE|FOR SHARE)\b/i.test(q))).toEqual([]);
    expect(temporalBadges).not.toHaveBeenCalled();
  }

  it("lecture sans activité : XP du serveur choisi, sans transaction de streak", async () => {
    const before = await db.communityMemberStats.findMany({ where: { userId }, orderBy: { communityId: "asc" } });
    queries.length = 0;
    expect(await getCurrentUser({ recordActivity: false })).toMatchObject({ xpTotal: 30, streakCount: 2 });
    expectReadOnly();
    expect(await db.communityMemberStats.findMany({ where: { userId }, orderBy: { communityId: "asc" } })).toEqual(before);
  });

  it("visite ordinaire : activité et badges toujours enregistrés", async () => {
    expect(await getCurrentUser()).toMatchObject({ xpTotal: 30, streakCount: 3 });
    expect(temporalBadges).toHaveBeenCalledOnce();
    expect(queries.some((q) => /FOR UPDATE/i.test(q))).toBe(true);
  });

  it("visite ordinaire déjà comptée il y a moins de 12 h : une lecture, ni transaction ni verrou", async () => {
    await db.communityMemberStats.updateMany({ where: { userId }, data: { streakLastActiveAt: new Date(Date.now() - 60 * 60 * 1000) } });
    const before = await db.communityMemberStats.findMany({ where: { userId }, orderBy: { communityId: "asc" } });
    queries.length = 0;
    expect(await getCurrentUser()).toMatchObject({ xpTotal: 30, streakCount: 2 });
    expect(queries.length).toBeLessThanOrEqual(8); // 11 avant la voie rapide (transaction + verrou)
    expectReadOnly();
    expect(await db.communityMemberStats.findMany({ where: { userId }, orderBy: { communityId: "asc" } })).toEqual(before);
  });

  it("serveur retiré : une visite récente ne montre aucune progression", async () => {
    await db.communityMemberStats.updateMany({ where: { userId }, data: { streakLastActiveAt: new Date(Date.now() - 60 * 60 * 1000) } });
    await db.membership.update({ where: { communityId_userId: { communityId: communities.a, userId } }, data: { status: "REMOVED" } });
    await db.user.update({ where: { id: userId }, data: { activeCommunityId: communities.b } });
    expect(await getCurrentUser()).toMatchObject({ xpTotal: 800 });
    await db.membership.update({ where: { communityId_userId: { communityId: communities.b, userId } }, data: { status: "REMOVED" } });
    expect(await getCurrentUser()).toMatchObject({ xpTotal: 0, streakCount: 0 });
  });

  it("chaque polling prend le nouveau choix A/B sans prolonger le streak", async () => {
    expect((await poll(null))?.map((m) => m.content)).toEqual(["chat-a"]);
    expectReadOnly();
    await db.user.update({ where: { id: userId }, data: { activeCommunityId: communities.b } });
    queries.length = 0;
    expect((await poll(null))?.map((m) => m.content)).toEqual(["chat-b"]);
    expect(await getCurrentUser({ recordActivity: false })).toMatchObject({ xpTotal: 800 });
    expectReadOnly();
  });

  it("retrait puis suspension : aucun chat ni progression du serveur inaccessible", async () => {
    await db.membership.update({ where: { communityId_userId: { communityId: communities.a, userId } }, data: { status: "REMOVED" } });
    expect((await poll(null))?.map((m) => m.content)).toEqual(["chat-b"]);
    await db.community.update({ where: { id: communities.b }, data: { status: "SUSPENDED" } });
    queries.length = 0;
    expect(await poll(null)).toEqual([]);
    expect(await getCurrentUser({ recordActivity: false })).toMatchObject({ xpTotal: 0, streakCount: 0 });
    expectReadOnly();
  });

  it("reconnexion forcée revalidée au prochain polling", async () => {
    expect(await poll(null)).toHaveLength(1);
    await db.user.update({ where: { id: userId }, data: { forceReloginAt: new Date() } });
    queries.length = 0;
    expect(await poll(null)).toBeNull();
    expect(await getCurrentUser({ recordActivity: false })).toBeNull();
    expectReadOnly();
  });

  it("header : mutualisation locale réduit les SQL, aucun droit conservé entre chargements", async () => {
    // Même vrai header et mêmes données : seules les lectures mutualisées changent.
    await (await import("./default-community")).getDefaultCommunityId();
    queries.length = 0;
    context.enabled = false;
    await header();
    const uncached = queries.length;
    expectReadOnly();
    context.enabled = true;
    queries.length = 0;
    await header();
    const cached = queries.length;
    expectReadOnly();
    console.info("[header-sql]", JSON.stringify({ withoutReadContext: uncached, withReadContext: cached }));
    expect(cached).toBeLessThan(uncached);
    await db.membership.updateMany({ where: { userId }, data: { status: "REMOVED" } });
    const tree = await header();
    // Server elements only: inspect the actual props sent to the chat and picker.
    const props: Record<string, unknown>[] = [];
    function visit(value: unknown) {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== "object" || !("props" in value)) return;
      const p = (value as { props: Record<string, unknown> }).props;
      props.push(p); visit(p.children);
    }
    visit(tree);
    expect(props.find((p) => "communities" in p)?.communities).toEqual([]);
    expect(props.find((p) => "initialMessages" in p)?.initialMessages).toEqual([]);
  });

  it("polling : moins de SQL que le gate de visite + lecture de chat, aucune écriture", async () => {
    const { getChatMessages } = await import("./chat");
    await (await import("./default-community")).getDefaultCommunityId();
    await db.communityMemberStats.updateMany({ where: { userId }, data: { streakLastActiveAt: new Date() } });
    queries.length = 0;
    const user = await getCurrentUser();
    const expected = await getChatMessages(null, user!.id);
    const visitQueries = queries.length;
    queries.length = 0;
    expect(await poll(null)).toEqual(expected);
    const pollingQueries = queries.length;
    expectReadOnly();
    console.info("[polling-sql]", JSON.stringify({ visitAndChat: visitQueries, readOnlyPolling: pollingQueries }));
    expect(pollingQueries).toBeLessThan(visitQueries);
  });
});
