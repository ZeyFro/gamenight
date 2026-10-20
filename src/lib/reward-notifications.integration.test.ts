import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const url = process.env.TEST_DATABASE_URL;
const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
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
  it.each(["bet", "pronostic"] as const)("%s : ancien crédit avec ou sans notification, aucune renotification", async (kind) => {
    const s = await source(kind);
    await db.xpEvent.create({ data: { communityId, userId, reason: s.reason, sourceId: s.id, amount: 20 } });
    await db.communityMemberStats.create({ data: { communityId, userId, xpTotal: 20 } });
    // L'absence de notification peut aussi signifier une ancienne purge : silence conservateur.
    await Promise.all(Array.from({ length: 6 }, s.resolve));
    expect(await db.notification.count({ where: { type: s.type } })).toBe(0);
    await db.notification.create({ data: { communityId, userId, type: s.type, title: "Ancien gain", message: "Historique", relatedSessionId: sessionId } });
    await Promise.all(Array.from({ length: 6 }, s.resolve));
    expect(await db.notification.count({ where: { type: s.type } })).toBe(1);
    expect(await db.notificationEvent.count()).toBe(0);
    expect(await db.notificationDelivery.count()).toBe(0);
    expect(await db.xpEvent.count()).toBe(1);
    expect((await db.communityMemberStats.findFirstOrThrow()).xpTotal).toBe(20);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("notification purgée : replay du nouveau crédit sans résurrection ni double intention", async () => {
    const s = await source("bet"); await s.resolve();
    await db.notification.deleteMany();
    await Promise.all(Array.from({ length: 6 }, s.resolve));
    expect(await db.notification.count()).toBe(0);
    expect(await db.notificationEvent.count()).toBe(1);
    expect(await db.notificationDelivery.count()).toBe(1);
    expect(await db.xpEvent.count()).toBe(1);
    expect((await db.communityMemberStats.findFirstOrThrow()).xpTotal).toBe(20);
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
  async function defaultWebhook() {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false"); vi.stubEnv("COMMUNITY_CHANNELS_ENABLED", "false");
    vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "false");
    vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/123/test-token");
    communityId = await (await import("./default-community")).getDefaultCommunityId();
    await db.membership.create({ data: { communityId, userId } });
    await db.session.update({ where: { id: sessionId }, data: { communityId: null } });
  }
  it("flags OFF et executor OFF : tentative historique après commit, un seul envoi", async () => {
    await defaultWebhook(); vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "false");
    const unrelated = await db.notificationEvent.create({ data: { category: "SESSION", eventType: "UNRELATED", sourceId: "unrelated" } });
    const other = await db.notificationDelivery.create({ data: { eventId: unrelated.id, channel: "DISCORD_CHANNEL", transport: "BOT", recipientKey: "other", targetSlot: "other" } });
    vi.mocked(fetch).mockImplementation(async () => {
      expect(await db.xpEvent.count()).toBe(1);
      expect(await db.notification.count()).toBe(1);
      return new Response(null, { status: 204 });
    });
    const s = await source("bet");
    await Promise.all([s.resolve(), s.resolve()]);
    await assertSingle(s.type, s.reason, s.id);
    const row = await db.notificationDelivery.findFirstOrThrow({ where: { event: { category: "REWARD" } } }); expect(row.transport).toBe("WEBHOOK");
    expect(row.status).toBe("SENT");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).not.toHaveProperty("Authorization");
    await s.resolve(); expect(fetch).toHaveBeenCalledTimes(1);
    expect((await db.notificationDelivery.findUniqueOrThrow({ where: { id: other.id } })).status).toBe("PENDING");
  });
  it("concurrence tentative immédiate / executor : une seule réservation et un seul HTTP", async () => {
    await defaultWebhook();
    const notices = await import("./reward-notifications");
    const pause = vi.spyOn(notices, "attemptDefaultRewardDelivery").mockResolvedValueOnce();
    const s = await source("bet"); await s.resolve(); pause.mockRestore();
    const credit = await db.xpEvent.findFirstOrThrow();
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    const executor = await import("./notification-executor");
    const resolver = (await import("./community-announce")).communitySystemAnnounceResolver;
    await Promise.all([notices.attemptDefaultRewardDelivery(credit.id), executor.runExecutorBatch({ owner: "cron", resolver })]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await db.notificationDelivery.findFirstOrThrow()).status).toBe("SENT");
    await assertSingle(s.type, s.reason, s.id);
  });
  it("WEBHOOK en attente puis bot activé : configuration absente puis rétablie, reprise sans épuisement", async () => {
    await defaultWebhook(); vi.stubEnv("DISCORD_WEBHOOK_URL", "");
    const s = await source("bet"); await s.resolve();
    vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "true");
    const executor = await import("./notification-executor");
    const resolver = (await import("./community-announce")).communitySystemAnnounceResolver;
    let now = Date.now();
    for (let i = 0; i < 10; i++) {
      now += 180_000;
      expect((await executor.processNextDelivery({ owner: "cron", resolver, now: new Date(now) }))?.outcome).toBe("retrying");
    }
    const pending = await db.notificationDelivery.findFirstOrThrow();
    expect(pending).toMatchObject({ status: "PENDING", transport: "WEBHOOK", attempts: 0 });
    expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/123/test-token");
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }));
    expect((await executor.processNextDelivery({ owner: "cron", resolver, now: new Date(now + 180_000) }))?.outcome).toBe("sent");
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://discord.com/api/webhooks/123/test-token");
    await s.resolve(); await assertSingle(s.type, s.reason, s.id);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["retrait", "suspension"])("%s avant la livraison : refus même sur reprise", async (cause) => {
    const s = await source("bet"); await s.resolve();
    if (cause === "retrait") await db.membership.updateMany({ where: { communityId, userId }, data: { status: "REMOVED" } });
    else await db.community.update({ where: { id: communityId }, data: { status: "SUSPENDED" } });
    const executor = await import("./notification-executor");
    const resolver = (await import("./community-announce")).communitySystemAnnounceResolver;
    expect(await executor.processNextDelivery({ owner: "cron", resolver })).toMatchObject({ outcome: "failed", errorClass: "resolver:expired" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("BOT : flag puis token indisponibles, reprise au bon guild sans repli webhook", async () => {
    const s = await source("bet"); await s.resolve();
    const executor = await import("./notification-executor");
    const resolver = (await import("./community-announce")).communitySystemAnnounceResolver;
    const now = Date.now();
    vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "false");
    expect((await executor.processNextDelivery({ owner: "cron", resolver, now: new Date(now) }))?.outcome).toBe("retrying");
    vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "true"); vi.stubEnv("DISCORD_BOT_TOKEN", "");
    expect((await executor.processNextDelivery({ owner: "cron", resolver, now: new Date(now + 180_000) }))?.outcome).toBe("retrying");
    expect(fetch).not.toHaveBeenCalled();
    expect((await db.notificationDelivery.findFirstOrThrow()).attempts).toBe(0);
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-token");
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: "channel-b", guild_id: "guild-b", type: 0 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "message", channel_id: "channel-b" }), { status: 200 }));
    expect((await executor.processNextDelivery({ owner: "cron", resolver, now: new Date(now + 360_000) }))?.outcome).toBe("sent");
    expect(vi.mocked(fetch).mock.calls[1][0]).toContain("/channels/channel-b/messages");
    expect((await db.notificationDelivery.findFirstOrThrow()).transport).toBe("BOT");
    await assertSingle(s.type, s.reason, s.id);
  });
  it.each(["retrait", "suspension"])("default flags OFF : %s bloque aussi la tentative immédiate", async (cause) => {
    await defaultWebhook(); vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "false");
    vi.stubEnv("DISCORD_WEBHOOK_URL", "");
    const s = await source("bet"); await s.resolve();
    await db.notificationDelivery.updateMany({ data: { nextAttemptAt: null } });
    if (cause === "retrait") await db.membership.updateMany({ where: { communityId, userId }, data: { status: "REMOVED" } });
    else await db.community.update({ where: { id: communityId }, data: { status: "SUSPENDED" } });
    vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/123/test-token");
    await s.resolve();
    await (await import("./reward-notifications")).attemptDefaultRewardDelivery((await db.xpEvent.findFirstOrThrow()).id);
    expect((await db.notificationDelivery.findFirstOrThrow()).errorClass).toBe("resolver:expired");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("admin REWARD : refuse non-admin, autre sélection, membre retiré et communauté suspendue ; reprise unique", async () => {
    const s = await source("bet"); await s.resolve();
    const row = await db.notificationDelivery.findFirstOrThrow();
    await db.notificationDelivery.update({ where: { id: row.id }, data: { status: "FAILED", errorClass: "discord:auth_or_permission" } });
    const action = (await import("@/app/admin/nettoyage/actions")).retryRewardDeliveryAction;
    const form = new FormData(); form.set("deliveryId", row.id);
    mocks.requireAdmin.mockResolvedValue(null); await action(form);
    expect((await db.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("FAILED");
    const otherCommunity = await db.community.create({ data: { slug: "a", name: "A", status: "ACTIVE" } });
    const admin = await db.user.create({ data: { discordId: "202", discordName: "Admin", role: "ADMIN", activeCommunityId: otherCommunity.id } });
    await db.membership.createMany({ data: [{ userId: admin.id, communityId: otherCommunity.id }, { userId: admin.id, communityId }] });
    mocks.requireAdmin.mockResolvedValue(admin); await action(form);
    const retry = await import("./reward-delivery-retry");
    expect(await retry.listFailedRewardDeliveries(admin.id)).toEqual([]);
    expect((await db.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("FAILED");
    await db.user.update({ where: { id: admin.id }, data: { activeCommunityId: communityId } });
    await db.membership.updateMany({ where: { userId: admin.id }, data: { status: "REMOVED" } });
    expect(await retry.retryRewardDelivery(admin.id, row.id)).toBe(false);
    await db.membership.updateMany({ where: { userId: admin.id, communityId }, data: { status: "ACTIVE" } });
    await db.community.update({ where: { id: communityId }, data: { status: "SUSPENDED" } });
    expect(await retry.retryRewardDelivery(admin.id, row.id)).toBe(false);
    await db.community.update({ where: { id: communityId }, data: { status: "ACTIVE" } });
    expect(await retry.listFailedRewardDeliveries(admin.id)).toHaveLength(1);
    const progress = await import("./member-stats");
    const originalLock = progress.lockCommunityProgress;
    vi.spyOn(progress, "lockCommunityProgress").mockImplementationOnce(async (...args) => {
      // Suspension après sélection de la livraison, avant verrouillage de l'autorité.
      await db.community.update({ where: { id: communityId }, data: { status: "SUSPENDED" } });
      return originalLock(...args);
    });
    expect(await retry.retryRewardDelivery(admin.id, row.id)).toBe(false);
    await db.community.update({ where: { id: communityId }, data: { status: "ACTIVE" } });
    await Promise.all([action(form), action(form)]);
    expect(await db.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: "PENDING", transport: "BOT", attempts: 0 });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: "channel-b", guild_id: "guild-b", type: 0 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "message", channel_id: "channel-b" }), { status: 200 }));
    const executor = await import("./notification-executor");
    const resolver = (await import("./community-announce")).communitySystemAnnounceResolver;
    expect((await executor.processNextDelivery({ owner: "cron", resolver }))?.outcome).toBe("sent");
    await action(form);
    expect((await db.notificationDelivery.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("SENT");
    await assertSingle(s.type, s.reason, s.id);
  });
});
