import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const testDatabaseGuard = (value: string) => {
  const database = new URL(value);
  if ((database.protocol === "postgresql:" || database.protocol === "postgres:")
    && database.hostname === "127.0.0.1"
    && /^\/(?:gamenight_[a-zA-Z0-9_]+|tower_test)$/.test(database.pathname)
    && !database.search && !database.hash) return;
  throw new Error("Postgres de test local uniquement : 127.0.0.1, base gamenight_* ou tower_test, sans options d'URL");
};
const clock = vi.hoisted(() => ({ now: new Date("2026-12-10T12:00:00Z") }));
const steam = vi.hoisted(() => ({ playtime: vi.fn() }));
vi.mock("@/lib/prisma", async () => {
  if (url) testDatabaseGuard(url);
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: url ? new PrismaClient({ datasourceUrl: url }) : {} };
});
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/notification-executor-kick", () => ({ kickNotificationExecutor: vi.fn() }));
vi.mock("@/lib/steam", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/steam")>()),
  getGamePlaytimeMinutes: steam.playtime,
}));
if (!url) console.warn("[tower-steam-measure] Postgres absent : intégrations ignorées.");

const guildId = "987654321098765433";
const channelId = "123456789012345673";
const communityId = "sm-community";
const users = ["sm-author", "sm-voter", "sm-new"];
const attemptId = "sm-attempt";
const slot = guildId + ":TOWER:" + attemptId + ":auto";

describe.skipIf(!url)("validation automatique Steam des défis Tower", () => {
  let db: import("@prisma/client").PrismaClient;
  let measure: typeof import("./tower-steam-measure");

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    measure = await import("./tower-steam-measure");
    vi.spyOn(Date, "now").mockImplementation(() => clock.now.getTime());
  });
  afterAll(async () => { await db?.$disconnect(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    clock.now = new Date("2026-12-10T12:00:00Z");
    steam.playtime.mockReset();
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    vi.stubEnv("TOWER_STEAM_AUTOVALIDATE_ENABLED", "true");
    vi.stubEnv("TOWER_DISCORD_ANNOUNCE_ENABLED", "true");
    vi.stubEnv("TOWER_DISCORD_GUILD_ID", guildId);
    vi.stubEnv("TOWER_DISCORD_CHANNEL_ID", channelId);
    vi.stubEnv("STEAM_API_KEY", "test-key");
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    await db.notificationEvent.deleteMany({ where: { communityId } });
    await db.towerChallengeAttempt.deleteMany({ where: { communityId } });
    await db.towerChallengeDefinition.deleteMany({ where: { communityId } });
    await db.towerChallengeProgress.deleteMany({ where: { communityId } });
    await db.membership.deleteMany({ where: { communityId } });
    await db.community.deleteMany({ where: { id: communityId } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.community.create({ data: { id: communityId, slug: communityId, name: communityId, status: "ACTIVE", towerChallengesEnabled: true, discordGuildId: guildId } });
    await db.user.createMany({ data: users.map(id => ({ id, discordId: id, discordName: id, ...(id === "sm-author" ? { steamId64: "76561198000000001" } : {}) })) });
    await db.membership.createMany({ data: users.map(userId => ({
      communityId, userId, status: "ACTIVE" as const, joinedAt: userId === "sm-new" ? new Date("2026-12-09T00:00:00Z") : new Date("2026-11-01T00:00:00Z"),
    })) });
    await db.towerChallengeDefinition.create({ data: { id: "sm-def", communityId, title: "Jouer 60 min", instructions: "Joue", rewardFloors: 2, active: true,
      measureKind: "STEAM_PLAYTIME", measureAppId: 440, measureTarget: 60 } });
    await db.towerChallengeAttempt.create({ data: {
      id: attemptId, communityId, userId: "sm-author", definitionId: "sm-def", requestKey: "sm-request-key-0001", title: "Jouer 60 min", instructions: "Joue",
      rewardFloors: 2, assignedAt: new Date("2026-12-10T08:00:00Z"), expiresAt: new Date("2026-12-12T08:00:00Z"), status: "ASSIGNED",
      measureKind: "STEAM_PLAYTIME", measureAppId: 440, measureTarget: 60, measureStatus: "WATCHING", measureBaseline: 500,
    } });
  });

  it("n'agit pas sans mesure atteinte, puis ouvre la fenêtre de doute et met le message public en file", async () => {
    steam.playtime.mockResolvedValue({ ok: true, minutes: 520 });
    let summary = await measure.runTowerSteamAutovalidation(new Date(clock.now.getTime() + 30_000));
    expect(summary).toMatchObject({ checked: 1, achieved: 0 });
    clock.now = new Date("2026-12-10T12:15:00Z");
    steam.playtime.mockResolvedValue({ ok: true, minutes: 565 });
    summary = await measure.runTowerSteamAutovalidation(new Date(clock.now.getTime() + 30_000));
    expect(summary).toMatchObject({ achieved: 1 });
    const row = await db.towerChallengeAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    expect(row).toMatchObject({ status: "ASSIGNED", measureStatus: "ACHIEVED", measureValue: 65, rewardedAt: null });
    expect(row.autoValidatedAt).not.toBeNull();
    expect(await db.notificationDelivery.count({ where: { targetSlot: slot, operation: "SEND" } })).toBe(1);
  });

  it("repli sur le vote pour un profil Steam privé, sans plus aucune lecture", async () => {
    steam.playtime.mockResolvedValue({ ok: false, reason: "private" });
    const summary = await measure.runTowerSteamAutovalidation(new Date(clock.now.getTime() + 30_000));
    expect(summary).toMatchObject({ fallbackToVote: 1, achieved: 0 });
    expect((await db.towerChallengeAttempt.findUniqueOrThrow({ where: { id: attemptId } })).measureStatus).toBe("PRIVATE");
    clock.now = new Date("2026-12-10T13:00:00Z");
    steam.playtime.mockClear();
    await measure.runTowerSteamAutovalidation(new Date(clock.now.getTime() + 30_000));
    expect(steam.playtime).not.toHaveBeenCalled();
  });

  async function achieve() {
    await db.towerChallengeAttempt.update({ where: { id: attemptId }, data: { autoValidatedAt: clock.now, measureStatus: "ACHIEVED", measureValue: 65 } });
    const event = await db.notificationEvent.create({ data: { communityId, category: "ACHIEVEMENT", eventType: "TOWER_AUTO_VALIDATION", sourceId: attemptId } });
    await db.notificationDelivery.create({ data: { eventId: event.id, channel: "DISCORD_CHANNEL", transport: "BOT", operation: "SEND", status: "SENT", sentAt: clock.now,
      recipientKey: channelId, discordChannelId: channelId, discordMessageId: "323456789012345673", targetSlot: slot } });
  }

  it("crédite les étages et met le MP en file seulement après la fenêtre de doute", async () => {
    await achieve();
    clock.now = new Date("2026-12-10T17:59:00Z");
    expect(await measure.runTowerSteamAutovalidation(new Date(clock.now.getTime() + 30_000))).toMatchObject({ credited: 0 });
    clock.now = new Date("2026-12-10T18:01:00Z");
    expect(await measure.runTowerSteamAutovalidation(new Date(clock.now.getTime() + 30_000))).toMatchObject({ credited: 1 });
    expect((await db.towerChallengeAttempt.findUniqueOrThrow({ where: { id: attemptId } })).status).toBe("APPROVED");
    expect(Number((await db.towerChallengeProgress.findUniqueOrThrow({ where: { communityId_userId: { communityId, userId: "sm-author" } } })).floorsClimbed)).toBe(2);
    expect(await db.notificationDelivery.count({ where: { targetSlot: guildId + ":TOWER:" + attemptId + ":auto-dm", channel: "DISCORD_DM" } })).toBe(1);
  });

  it("bascule en vote communautaire après le doute d'un membre éligible, sans crédit", async () => {
    await achieve();
    const doubt = (userId: string, messageId = "323456789012345673") => measure.reportTowerChallengeDoubt({ communityId, userId, attemptId, channelId, messageId });
    expect((await doubt("sm-author")).status).toBe("SELF_DOUBT");
    expect((await doubt("sm-new")).status).toBe("DOUBT_TOO_RECENT");
    expect((await doubt("sm-voter", "999999999999999999")).status).toBe("UNAVAILABLE");
    expect((await doubt("sm-voter")).status).toBe("DOUBT_RECORDED");
    expect((await doubt("sm-voter")).status).toBe("UNAVAILABLE");
    expect(await db.towerChallengeAttempt.findUniqueOrThrow({ where: { id: attemptId } })).toMatchObject({
      status: "SUBMITTED", doubtReportedByUserId: "sm-voter", proofMessageId: "323456789012345673", rewardedAt: null, publicationConsent: false,
    });
    clock.now = new Date("2026-12-10T19:00:00Z");
    expect(await measure.runTowerSteamAutovalidation(new Date(clock.now.getTime() + 30_000))).toMatchObject({ credited: 0 });
  });
});
