import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { wallClockNow } from "@/lib/wallclock";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (TEST_DATABASE_URL && new URL(TEST_DATABASE_URL).hostname !== "127.0.0.1") {
    throw new Error("Postgres local 127.0.0.1 uniquement");
  }
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

describe.skipIf(!TEST_DATABASE_URL)("annulation groupée des occurrences futures (Postgres local)", () => {
  let db: import("@prisma/client").PrismaClient;
  let sessions: typeof import("./sessions");
  const future = new Date(wallClockNow().getTime() + 24 * 60 * 60 * 1000);
  const past = new Date(wallClockNow().getTime() - 24 * 60 * 60 * 1000);

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    sessions = await import("./sessions");
  });
  afterAll(async () => { await db?.$disconnect(); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    vi.stubEnv("SESSION_SERIES_CANCEL_ENABLED", "true");
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "false");
    vi.stubEnv("DISCORD_THREAD_CLOSE_ON_END_ENABLED", "false");
    vi.stubEnv("DISCORD_THREAD_CLEANUP_ENABLED", "false");
    vi.stubEnv("DISCORD_THREAD_CLEANUP_MODE", "dry-run");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Réseau Discord interdit dans ce test"); }));
    await db.$executeRawUnsafe('TRUNCATE "NotificationDelivery", "NotificationEvent", "Session", "User", "Community" CASCADE');
    await db.community.createMany({ data: [
      { id: "community-a", slug: "default", name: "Serveur A", status: "ACTIVE" },
      { id: "community-b", slug: "other", name: "Serveur B", status: "ACTIVE" },
    ] });
    await db.user.createMany({ data: [
      { id: "owner", discordId: "1", discordName: "Créateur" },
      { id: "other-owner", discordId: "2", discordName: "Autre créateur" },
    ] });
    await db.session.createMany({ data: [
      { id: "source-past", communityId: "community-a", createdById: "owner", recurrenceGroupId: "series", date: past, status: "DONE" },
      { id: "future-voting", communityId: "community-a", createdById: "owner", recurrenceGroupId: "series", date: future, status: "VOTING" },
      { id: "future-scheduled", communityId: "community-a", createdById: "owner", recurrenceGroupId: "series", date: future, status: "SCHEDULED", announceViaBot: true },
      { id: "past-voting", communityId: "community-a", createdById: "owner", recurrenceGroupId: "series", date: past, status: "VOTING" },
      { id: "future-done", communityId: "community-a", createdById: "owner", recurrenceGroupId: "series", date: future, status: "DONE" },
      { id: "future-cancelled", communityId: "community-a", createdById: "owner", recurrenceGroupId: "series", date: future, status: "CANCELLED" },
      { id: "other-community", communityId: "community-b", createdById: "owner", recurrenceGroupId: "series", date: future },
      { id: "other-creator", communityId: "community-a", createdById: "other-owner", recurrenceGroupId: "series", date: future },
      { id: "other-series", communityId: "community-a", createdById: "owner", recurrenceGroupId: "another-series", date: future },
    ] });
  });

  it("uses a past occurrence as source and cancels only future active siblings in its exact group", async () => {
    const ids = await sessions.cancelRecurringSessions("source-past", "owner");
    expect(ids?.sort()).toEqual(["future-scheduled", "future-voting"]);

    const rows = await db.session.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true } });
    expect(Object.fromEntries(rows.map((row) => [row.id, row.status]))).toMatchObject({
      "future-voting": "CANCELLED",
      "future-scheduled": "CANCELLED",
      "past-voting": "VOTING",
      "future-done": "DONE",
      "future-cancelled": "CANCELLED",
      "other-community": "VOTING",
      "other-creator": "VOTING",
      "other-series": "VOTING",
    });
    expect(await db.notificationEvent.count({ where: { sourceId: "future-scheduled", eventType: "SESSION_MODIFIED" } })).toBe(1);
  });

  it("does not reveal a series when the source is not owned or not grouped", async () => {
    await expect(sessions.cancelRecurringSessions("other-creator", "owner")).resolves.toBeNull();
    await expect(sessions.cancelRecurringSessions("future-voting", "other-owner")).resolves.toBeNull();
  });

  it("sérialise les doubles annulations sans dupliquer l’outbox", async () => {
    const results = await Promise.all([
      sessions.cancelRecurringSessions("source-past", "owner"),
      sessions.cancelRecurringSessions("source-past", "owner"),
    ]);
    expect(results.map((ids) => ids!.length).sort()).toEqual([0, 2]);
    expect(await db.notificationEvent.count({ where: { eventType: "SESSION_MODIFIED" } })).toBe(1);
  });

  it("annule toute la mutation si l’outbox échoue", async () => {
    const announcements = await import("./session-announce");
    vi.spyOn(announcements, "enqueueSessionAnnounceUpdate").mockRejectedValueOnce(new Error("outbox unavailable"));
    await expect(sessions.cancelRecurringSessions("source-past", "owner")).rejects.toThrow("outbox unavailable");
    expect((await db.session.findUniqueOrThrow({ where: { id: "future-voting" } })).status).toBe("VOTING");
    expect((await db.session.findUniqueOrThrow({ where: { id: "future-scheduled" } })).status).toBe("SCHEDULED");
    expect(await db.notificationEvent.count()).toBe(0);
  });

  it("respecte les appartenances lorsque l’isolation est simulée ON", async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    await db.membership.create({ data: { communityId: "community-a", userId: "owner", status: "ACTIVE" } });
    expect(await sessions.cancelRecurringSessions("other-community", "owner")).toBeNull();
    await db.membership.updateMany({ where: { userId: "owner" }, data: { status: "REMOVED" } });
    expect(await sessions.cancelRecurringSessions("source-past", "owner")).toBeNull();
    expect((await db.session.findUniqueOrThrow({ where: { id: "future-voting" } })).status).toBe("VOTING");
  });
});
