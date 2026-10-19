import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { wallClockNow } from "./wallclock";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_DATABASE_URL ? describe : describe.skip;
if (!TEST_DATABASE_URL) console.warn("[calendar-feed] TEST_DATABASE_URL absente : intégration iCal ignorée.");
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (TEST_DATABASE_URL && new URL(TEST_DATABASE_URL).hostname !== "127.0.0.1") {
    throw new Error("Postgres local 127.0.0.1 uniquement");
  }
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

suite("calendar feed integration", () => {
  let db: typeof import("@/lib/prisma").prisma;
  let feed: typeof import("./calendar-feed");

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as typeof db;
    feed = await import("./calendar-feed");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    vi.stubEnv("CALENDAR_SUBSCRIPTIONS_ENABLED", "true");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Réseau interdit dans cette intégration."); }));
    await db.$executeRawUnsafe('TRUNCATE "Community", "User" CASCADE');
    await db.community.createMany({ data: [
      { id: "default", slug: "default", name: "Serveur A", status: "ACTIVE" },
      { id: "other", slug: "other", name: "Serveur B", status: "ACTIVE" },
    ] });
    await db.user.createMany({ data: [
      { id: "owner", discordId: "1", discordName: "Créateur", activeCommunityId: "default" },
      { id: "guest", discordId: "2", discordName: "Invité" },
    ] });
    await db.membership.createMany({ data: [
      { userId: "owner", communityId: "default", status: "ACTIVE" },
      { userId: "owner", communityId: "other", status: "ACTIVE" },
      { userId: "guest", communityId: "default", status: "ACTIVE" },
    ] });
  });

  afterAll(async () => {
    await db.$disconnect();
    vi.unstubAllEnvs();
  });

  it("rotates and revokes only the current community's opaque bearer", async () => {
    const first = await feed.createCalendarFeedToken("owner");
    const second = await feed.createCalendarFeedToken("owner");
    expect(first?.communityName).toBe("Serveur A");
    expect(first?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second?.token).not.toBe(first?.token);
    const stored = await db.calendarFeedToken.findUnique({ where: { userId_communityId: { userId: "owner", communityId: "default" } } });
    expect(stored).toMatchObject({
      tokenHash: createHash("sha256").update(second!.token).digest("hex"),
      revokedAt: null,
    });
    expect(stored?.tokenHash).not.toContain(second!.token);
    expect(await feed.readCalendarFeed(first!.token, "https://gamenight.example")).toBeNull();
    await db.user.update({ where: { id: "owner" }, data: { activeCommunityId: "other" } });
    const other = (await feed.createCalendarFeedToken("owner"))!;
    expect(await feed.revokeCalendarFeedToken("owner")).toBe(true);
    expect(await feed.readCalendarFeed(other.token, "https://gamenight.example")).toBeNull();
    expect(await feed.readCalendarFeed(second!.token, "https://gamenight.example")).not.toBeNull();
    await db.user.update({ where: { id: "owner" }, data: { activeCommunityId: "default" } });
    expect(await feed.revokeCalendarFeedToken("owner")).toBe(true);
    expect(await feed.readCalendarFeed(second!.token, "https://gamenight.example")).toBeNull();
    expect(await feed.revokeCalendarFeedToken("owner")).toBe(true);
  });

  it("limits each read to accessible sessions in the captured community, and rechecks membership", async () => {
    const date = new Date(wallClockNow().getTime() + 60 * 60 * 1000);
    await db.session.createMany({ data: [
      { id: "visible", communityId: "default", createdById: "owner", date },
      { id: "legacy", communityId: null, createdById: "owner", date },
      { id: "other-server", communityId: "other", createdById: "owner", date },
      { id: "invited", communityId: "default", createdById: "guest", date },
      { id: "private", communityId: "default", createdById: "guest", date },
    ] });
    await db.sessionInvite.create({ data: { sessionId: "invited", userId: "owner", invitedById: "guest", status: "ACTIVE" } });
    const { token } = (await feed.createCalendarFeedToken("owner"))!;
    await db.user.update({ where: { id: "owner" }, data: { activeCommunityId: "other" } });
    const calendar = await feed.readCalendarFeed(token, "https://gamenight.example");
    expect(calendar).toContain("/sessions/visible");
    expect(calendar).toContain("/sessions/legacy");
    expect(calendar).toContain("/sessions/invited");
    expect(calendar).not.toContain("other-server");
    expect(calendar).not.toContain("/sessions/private");

    await db.sessionInvite.updateMany({ where: { sessionId: "invited", userId: "owner" }, data: { status: "REVOKED" } });
    expect(await feed.readCalendarFeed(token, "https://gamenight.example")).not.toContain("/sessions/invited");
    await db.community.update({ where: { id: "default" }, data: { status: "SUSPENDED" } });
    expect(await feed.readCalendarFeed(token, "https://gamenight.example")).toBeNull();
    await db.community.update({ where: { id: "default" }, data: { status: "ACTIVE" } });

    await db.membership.update({ where: { communityId_userId: { communityId: "default", userId: "owner" } }, data: { status: "REMOVED" } });
    expect(await feed.readCalendarFeed(token, "https://gamenight.example")).toBeNull();
  });

  it("refuse les jetons inconnus et n’émet rien pour un membre retiré", async () => {
    expect(await feed.readCalendarFeed("A".repeat(43), "https://gamenight.example")).toBeNull();
    await db.membership.updateMany({ where: { userId: "owner" }, data: { status: "REMOVED" } });
    expect(await feed.createCalendarFeedToken("owner")).toBeNull();
    expect(await feed.revokeCalendarFeedToken("owner")).toBe(false);
    expect(await db.calendarFeedToken.count()).toBe(0);
  });
});
