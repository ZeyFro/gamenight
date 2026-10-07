import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const url = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  if (url && new URL(url).hostname !== "127.0.0.1") throw new Error("Postgres local uniquement");
  return { prisma: url ? new (await import("@prisma/client")).PrismaClient({ datasourceUrl: url }) : {} };
});
vi.mock("@/lib/discord-level-up", () => ({ announceLevelUp: vi.fn() }));
vi.mock("@/lib/discord-badge-unlocked", () => ({ announceBadgeUnlocked: vi.fn() }));
if (!url) console.warn("[reward-notifications] Postgres absent : tests SKIPPÉS.");

describe.skipIf(!url)("outbox des gains : commit, interruptions et reprises concurrentes", () => {
  let db: import("@prisma/client").PrismaClient;
  let xp: typeof import("./xp-actions");
  let badges: typeof import("./badges");
  let communityId: string;
  let userId: string;
  let sessionId: string;
  beforeAll(async () => {
    db = (await import("./prisma")).prisma;
    xp = await import("./xp-actions"); badges = await import("./badges");
  });
  afterAll(async () => { await db?.$disconnect(); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "User", "Community", "Game", "Badge", "NotificationEvent" CASCADE');
    (await import("./default-community")).resetDefaultCommunityIdCache();
    for (const flag of ["COMMUNITY_ISOLATION_ENABLED", "COMMUNITY_CHANNELS_ENABLED", "DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "NOTIFICATION_EXECUTOR_ENABLED"]) vi.stubEnv(flag, "true");
    vi.stubEnv("DISCORD_WEBHOOK_URL", ""); vi.stubEnv("DISCORD_BOT_TOKEN", "test-token");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Réseau réel interdit"); }));
    communityId = (await db.community.create({ data: { slug: "b", name: "B", status: "ACTIVE", discordGuildId: "guild-b" } })).id;
    await db.communityChannelConfig.create({ data: { communityId, category: "SESSION", discordChannelId: "channel-b", enabled: true } });
    userId = (await db.user.create({ data: { discordId: "101", discordName: "Joueur" } })).id;
    await db.membership.create({ data: { communityId, userId, status: "ACTIVE" } });
    sessionId = (await db.session.create({ data: { communityId, createdById: userId, date: new Date(), status: "DONE" } })).id;
  });
  async function source(kind: "bet" | "pronostic") {
    const row = kind === "bet"
      ? await db.xpBet.create({ data: { communityId, sessionId, voterId: userId, targetUserId: userId, amount: 10 } })
      : await db.pronostic.create({ data: { communityId, sessionId, voterId: userId, predictedUserId: userId } });
    const resolve = kind === "bet" ? (await import("./xp-bets")).resolveBets : (await import("./pronostics")).resolvePronostics;
    return { id: row.id, resolve: () => resolve(sessionId, new Set([userId])),
      reason: kind === "bet" ? "XP_BET_WON" as const : "PRONOSTIC_CORRECT" as const,
      type: kind === "bet" ? "XP_BET" as const : "PRONOSTIC" as const,
      check: kind === "bet" ? "checkBetBadges" as const : "checkPronosticBadges" as const,
    };
  }
  async function assertSingle(type: "XP_BET" | "PRONOSTIC", reason: "XP_BET_WON" | "PRONOSTIC_CORRECT", id: string) {
    expect(await db.xpEvent.count({ where: { communityId, userId, reason, sourceId: id } })).toBe(1);
    expect(await db.notification.count({ where: { communityId, userId, type } })).toBe(1);
    expect(await db.notificationEvent.count({ where: { communityId, category: "REWARD" } })).toBe(1);
    expect(await db.notificationDelivery.count({ where: { event: { communityId, category: "REWARD" } } })).toBe(1);
    const credit = await db.xpEvent.findFirstOrThrow({ where: { reason, sourceId: id } });
    expect((await db.communityMemberStats.findUniqueOrThrow({ where: { communityId_userId: { communityId, userId } } })).xpTotal).toBe(credit.amount);
  }
  it.each(["bet", "pronostic"] as const)("%s : interruption après commit, puis replays concurrents", async (kind) => {
    const s = await source(kind);
    const original = xp.awardXp;
    vi.spyOn(xp, "awardXp").mockImplementationOnce(async (...args) => {
      await original(...args);
      throw new Error("Interruption après commit");
    });
    await expect(s.resolve()).rejects.toThrow("Interruption après commit");
    await assertSingle(s.type, s.reason, s.id);
    await Promise.all(Array.from({ length: 6 }, s.resolve));
    await assertSingle(s.type, s.reason, s.id);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["bet", "pronostic"] as const)("%s : échec du contrôle des badges, intentions déjà durables", async (kind) => {
    const s = await source(kind);
    vi.spyOn(badges, s.check).mockRejectedValueOnce(new Error("Contrôle badges indisponible"));
    await expect(s.resolve()).rejects.toThrow("Contrôle badges indisponible");
    await assertSingle(s.type, s.reason, s.id);
    await Promise.all([s.resolve(), s.resolve()]);
    await assertSingle(s.type, s.reason, s.id);
  });
  it.each(["bet", "pronostic"] as const)("%s : réparation d'un ancien crédit sans notification, une seule intention", async (kind) => {
    const s = await source(kind);
    await db.xpEvent.create({ data: { communityId, userId, reason: s.reason, sourceId: s.id, amount: 20 } });
    await db.communityMemberStats.create({ data: { communityId, userId, xpTotal: 20 } });
    await Promise.all(Array.from({ length: 6 }, s.resolve));
    await assertSingle(s.type, s.reason, s.id);
    await db.notification.deleteMany({ where: { type: s.type } });
    await s.resolve();
    expect(await db.notification.count({ where: { type: s.type } })).toBe(0);
    expect(await db.notificationDelivery.count()).toBe(1);
  });
  it("une panne de persistance des intentions annule aussi le crédit XP", async () => {
    const notices = await import("./reward-notifications");
    const original = notices.persistRewardNotice;
    vi.spyOn(notices, "persistRewardNotice").mockImplementationOnce(async (...args) => {
      await original(...args); throw new Error("Persistance interrompue");
    });
    const s = await source("bet");
    await expect(s.resolve()).rejects.toThrow("Persistance interrompue");
    expect(await db.xpEvent.count()).toBe(0);
    expect(await db.notification.count()).toBe(0);
    expect(await db.notificationEvent.count()).toBe(0);
    expect(await db.notificationDelivery.count()).toBe(0);
    await s.resolve(); await assertSingle(s.type, s.reason, s.id);
  });
  it("bot : livraison du gain committé malgré interruption, aucun double SEND persisté", async () => {
    const s = await source("bet");
    vi.spyOn(badges, "checkBetBadges").mockRejectedValueOnce(new Error("Interruption"));
    await expect(s.resolve()).rejects.toThrow("Interruption");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: "channel-b", guild_id: "guild-b", type: 0 }), { status: 200 }));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: "message", channel_id: "channel-b" }), { status: 200 }));
    const executor = await import("./notification-executor");
    const resolver = (await import("./community-announce")).communitySystemAnnounceResolver;
    expect((await executor.processNextDelivery({ owner: "test", resolver }))?.outcome).toBe("sent");
    await Promise.all([s.resolve(), s.resolve()]);
    expect(await executor.processNextDelivery({ owner: "test", resolver })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("flags OFF : gain default et webhook dans la file, master OFF refuse tout appel", async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false"); vi.stubEnv("COMMUNITY_CHANNELS_ENABLED", "false");
    vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "false");
    vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/123/test-token");
    communityId = await (await import("./default-community")).getDefaultCommunityId();
    await db.membership.create({ data: { communityId, userId } });
    await db.session.update({ where: { id: sessionId }, data: { communityId: null } });
    const s = await source("bet");
    await Promise.all([s.resolve(), s.resolve()]);
    await assertSingle(s.type, s.reason, s.id);
    const row = await db.notificationDelivery.findFirstOrThrow(); expect(row.transport).toBe("WEBHOOK");
    const event = await db.notificationEvent.findFirstOrThrow();
    const resolver = (await import("./community-announce")).communitySystemAnnounceResolver;
    const executor = await import("./notification-executor");
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "false");
    expect(await resolver.resolve({ delivery: { ...row, targetMessage: null }, event, now: new Date() })).toEqual({ eligible: false, reason: "not_configured" });
    expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect((await executor.processNextDelivery({ owner: "test", resolver }))?.outcome).toBe("sent");
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).not.toHaveProperty("Authorization");
    await s.resolve(); expect(await executor.processNextDelivery({ owner: "test", resolver })).toBeNull();
  });
});
