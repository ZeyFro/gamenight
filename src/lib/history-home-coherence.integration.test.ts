import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const { currentUser } = vi.hoisted(() => ({ currentUser: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: currentUser }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

if (!TEST_DATABASE_URL) console.warn("[history-home-coherence] Postgres absent : test SKIPPÉ.");
/**
 * Production du 24/11/2026 : « /sessions?tab=history » vide et accueil « 0 soirée jouée » alors que 28 soirées terminées existaient.
 * Cas reproduit : serveur affiché = « The Tower », soirées terminées il y a 10, 30 et 200 jours, AUCUNE ligne GroupSessionStats.
 */
describe.skipIf(!TEST_DATABASE_URL)("historique et accueil : soirées terminées anciennes", () => {
  let db: import("@prisma/client").PrismaClient;
  const ids: Record<string, string> = {};
  beforeAll(async () => { db = (await import("@/lib/prisma")).prisma as unknown as typeof db; });
  afterAll(async () => { await db?.$disconnect(); });
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    await db.$executeRawUnsafe('TRUNCATE "User", "Game", "Community" CASCADE');
    (await import("./default-community")).resetDefaultCommunityIdCache();
    for (const [slug, name] of [["default", "GameNight"], ["tower", "The Tower"]]) {
      ids[slug] = (await db.community.create({ data: { slug, name, status: "ACTIVE", discordGuildId: `guild-${slug}` } })).id;
    }
    ids.me = (await db.user.create({ data: { discordId: "me", discordName: "moi" } })).id;
    for (const slug of ["default", "tower"]) await db.membership.create({ data: { userId: ids.me, communityId: ids[slug], status: "ACTIVE" } });
    await db.user.update({ where: { id: ids.me }, data: { activeCommunityId: ids.tower } });
    currentUser.mockResolvedValue({ id: ids.me });
    const day = 86_400_000;
    for (const [index, age] of [10, 30, 200].entries()) {
      await db.session.create({ data: { id: `s${index}`, date: new Date(Date.now() - age * day), status: "DONE", createdById: ids.me, communityId: ids.tower } });
    }
    await db.session.create({ data: { id: "other", date: new Date(Date.now() - 20 * day), status: "DONE", createdById: ids.me, communityId: ids.default } });
  });

  it("l'historique liste les soirées terminées de plus de 7 jours du serveur affiché", async () => {
    const { accessibleSessionWhereFor } = await import("./session-access");
    const { getActiveScopedPrisma } = await import("./community-scoped-client");
    const { isSessionVisibleInHistory } = await import("./sessions");
    const scopedDb = await getActiveScopedPrisma(ids.me);
    const sessions = await scopedDb.session.findMany({ where: await accessibleSessionWhereFor(ids.me), orderBy: { date: "desc" } });
    const history = sessions.filter((s) => (s.status === "DONE" || s.status === "CANCELLED") && isSessionVisibleInHistory(s));
    expect(history.map((s) => s.id)).toEqual(["s0", "s1", "s2"]);
  });

  it("l'accueil compte les soirées terminées même sans compteur durable, sans mélanger les serveurs", async () => {
    const { getGroupStats } = await import("./home");
    expect(await db.groupSessionStats.count()).toBe(0);
    expect((await getGroupStats(ids.me)).totalSessionsPlayed).toBe(3);
  });

  it("un compteur durable plus grand (soirées déjà purgées) l'emporte, jamais une addition", async () => {
    await db.groupSessionStats.create({ data: { communityId: ids.tower, totalSessionsPlayed: 28 } });
    const { getGroupStats } = await import("./home");
    expect((await getGroupStats(ids.me)).totalSessionsPlayed).toBe(28);
  });
});
