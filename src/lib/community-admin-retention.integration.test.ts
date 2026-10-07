import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient, User } from "@prisma/client";

const url = process.env.TEST_DATABASE_URL;
const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/prisma", async () => ({ prisma: url ? new (await import("@prisma/client")).PrismaClient({ datasourceUrl: url }) : {} }));
vi.mock("@/lib/admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.requireAdmin }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
if (!url) console.warn("[community-admin-retention] TEST_DATABASE_URL absente — suite SKIPPÉE.");

describe.skipIf(!url)("PR B — admin et rétention sur deux serveurs", () => {
  let db: PrismaClient;
  let retention: typeof import("./retention");
  let audit: typeof import("./storage-audit");
  let cleanup: typeof import("./discord-cleanup-status");
  let legacy: typeof import("./legacy-discord-announces");
  let delivery: typeof import("./notification-delivery");
  let notifications: typeof import("./notifications");
  let admin: User;
  let gameId: string;
  let badgeId: string;
  const ids: Record<string, string> = {};
  const now = new Date("2026-10-06T12:00:00Z");
  const old = new Date("2026-08-01T12:00:00Z");
  const scope = () => ({ communityIds: [ids.a], includesDefault: false });

  beforeAll(async () => {
    db = (await import("./prisma")).prisma;
    retention = await import("./retention");
    audit = await import("./storage-audit");
    cleanup = await import("./discord-cleanup-status");
    legacy = await import("./legacy-discord-announces");
    delivery = await import("./notification-delivery");
    notifications = await import("./notifications");
  });
  afterAll(async () => { await db.$disconnect(); });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "NotificationDelivery", "NotificationEvent", "Notification", "CommunityMemberStats", "XpEvent", "LevelUpEvent", "UserBadge", "SessionResult", "SuperlativeAward", "Pronostic", "XpBet", "Badge", "Session", "Tournament", "InstantSession", "Community", "Game", "User" CASCADE');
    (await import("./default-community")).resetDefaultCommunityIdCache();
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    vi.stubEnv("COMMUNITY_CHANNELS_ENABLED", "");
    vi.stubEnv("DISCORD_WEBHOOK_URL", "");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Réseau réel interdit dans ce test"); }));
    for (const slug of ["default", "a", "b"]) ids[slug] = (await db.community.create({ data: { slug, name: slug, status: "ACTIVE" } })).id;
    admin = await db.user.create({ data: { discordId: "admin", discordName: "admin", role: "ADMIN", activeCommunityId: ids.a } });
    for (const key of ["a", "b"]) await db.membership.create({ data: { communityId: ids[key], userId: admin.id, status: "ACTIVE" } });
    mocks.requireAdmin.mockResolvedValue(admin);
    gameId = (await db.game.create({ data: { name: "jeu", source: "MANUAL", addedById: admin.id } })).id;
    badgeId = (await db.badge.create({ data: { name: "badge", description: "d", icon: "🏅", category: "PARTICIPATION", rarity: "COMMON", criteria: {}, modifiedById: admin.id } })).id;
    for (const key of ["a", "b"]) {
      const communityId = ids[key];
      ids[`s${key}`] = (await db.session.create({ data: { communityId, createdById: admin.id, date: old, status: "DONE", superlativeVotingClosed: true } })).id;
      await db.chatMessage.create({ data: { communityId, sessionId: ids[`s${key}`], userId: admin.id, content: key } });
      await db.sessionResult.create({ data: { communityId, sessionId: ids[`s${key}`], userId: admin.id, placement: 1, gameId } });
      const proposal = await db.proposal.create({ data: { sessionId: ids[`s${key}`], gameId, proposedById: admin.id } });
      await db.vote.create({ data: { proposalId: proposal.id, userId: admin.id } });
      ids[`t${key}`] = (await db.tournament.create({ data: { communityId, name: key, createdById: admin.id, gameId, maxPlayers: 4, status: "CANCELLED", cancelledAt: old } })).id;
      await db.tournamentMatch.create({ data: { tournamentId: ids[`t${key}`], round: 1, position: 1 } });
      ids[`i${key}`] = (await db.instantSession.create({ data: { communityId, createdById: admin.id, gameId, status: "ENDED", createdAt: old, expiresAt: old, endedAt: old } })).id;
      await db.xpEvent.create({ data: { communityId, userId: admin.id, reason: "PARTICIPATE", sourceId: ids[`s${key}`], amount: 20 } });
      await db.levelUpEvent.create({ data: { communityId, userId: admin.id, level: 2 } });
      await db.userBadge.create({ data: { communityId, userId: admin.id, badgeId } });
      const season = await db.season.create({ data: { communityId, number: 1, name: key, startDate: new Date("2026-09-01Z"), endDate: now } });
      await db.seasonSnapshot.create({ data: { seasonId: season.id, userId: admin.id, xp: 20, level: 1, rank: "r", position: 1 } });
      await db.notification.create({ data: { communityId, userId: admin.id, type: "LEVEL_UP", title: key, message: key, read: true, createdAt: old } });
      const event = await db.notificationEvent.create({ data: { communityId, category: "SESSION", eventType: "SESSION_REMOVED", sourceId: ids[`s${key}`], occurrence: key, createdAt: old } });
      ids[`d${key}`] = (await db.notificationDelivery.create({ data: { eventId: event.id, channel: "DISCORD_CHANNEL", transport: "BOT", recipientKey: "channel", targetSlot: `default-guild:SESSION:${ids[`s${key}`]}:thread-delete`, status: "FAILED", createdAt: old } })).id;
    }
  });

  it("audit : parents, enfants, événements, snapshots et progression de la communauté active seulement", async () => {
    const report = await audit.generateStorageAuditReport(admin.id);
    expect(report.sessions.total).toBe(1);
    expect(report.chatMessages.total).toBe(1);
    expect(report.tournaments.total).toBe(1);
    expect(report.instantSessions.total).toBe(1);
    expect(report.sessionResults.total).toBe(1);
    expect(report.proposalsAndVotes).toEqual({ proposals: 1, votes: 1 });
    expect(report.tournamentMatches.total).toBe(1);
    expect(report.xpAndRewards).toMatchObject({ xpEvents: 1, levelUpEvents: 1, seasonSnapshots: 1, userBadges: 1 });
    expect(report.notificationDelivery.total).toBe(1);
    expect(report.notificationDelivery.byStatus).toEqual({ FAILED: 1 });
    expect(report.notifications.total).toBe(1);
    expect((await audit.generateStorageAuditReport()).sessions.total).toBe(0);
  });

  it("audit des livraisons terminales retry-safe : compte seulement les événements du serveur actif", async () => {
    await db.notificationDelivery.updateMany({ data: { status: "SENT" } });
    const report = await audit.generateStorageAuditReport(admin.id);
    expect(report.notificationDelivery.terminalRetrySafe).toBe(1);
    expect(report.notificationDelivery.byStatus).toEqual({ SENT: 1 });
  });

  it("isolation OFF : les totaux progression de l'audit restent ceux de default", async () => {
    const communityId = ids.default;
    await db.xpEvent.create({ data: { communityId, userId: admin.id, reason: "PARTICIPATE", sourceId: "historique", amount: 20 } });
    await db.levelUpEvent.create({ data: { communityId, userId: admin.id, level: 2 } });
    await db.userBadge.create({ data: { communityId, userId: admin.id, badgeId } });
    const season = await db.season.create({ data: { communityId, number: 1, name: "default", startDate: old, endDate: now } });
    await db.seasonSnapshot.create({ data: { seasonId: season.id, userId: admin.id, xp: 20, level: 1, rank: "r", position: 1 } });
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "");
    expect((await audit.generateStorageAuditReport(admin.id)).xpAndRewards).toMatchObject({ xpEvents: 1, levelUpEvents: 1, userBadges: 1, seasonSnapshots: 1 });
  });

  it("provenance event : lit le parent non committé dans sa transaction et réutilise le journal après purge", async () => {
    const event = await db.$transaction(async (tx) => {
      const session = await tx.session.create({ data: { communityId: ids.b, createdById: admin.id, date: now } });
      return delivery.createNotificationEvent({ category: "SESSION", eventType: "SESSION_CREATED", sourceId: session.id }, tx);
    });
    expect(event.communityId).toBe(ids.b);
    await db.session.delete({ where: { id: event.sourceId } });
    const retry = await delivery.createNotificationEvent({ category: "SESSION", eventType: "SESSION_REMOVED", sourceId: event.sourceId, occurrence: "retry" });
    expect(retry.communityId).toBe(ids.b);
    expect(retry.communityId).not.toBe(ids.a);
  });

  it("notifications : list/count/mark-read limités à la communauté choisie, membre commun aux deux", async () => {
    await db.notification.updateMany({ data: { read: false } });
    expect((await notifications.listRecentNotifications(admin.id)).map((row) => row.message)).toEqual(["a"]);
    expect(await notifications.getUnreadNotificationCount(admin.id)).toBe(1);
    expect((await notifications.groupNotifications(await db.notification.findMany({ orderBy: { message: "asc" } }), admin.id)).map((row) => row.message)).toEqual(["a"]);
    await (await import("@/app/notifications-actions")).markAllNotificationsReadAction();
    expect(await db.notification.count({ where: { communityId: ids.b, read: false } })).toBe(1);
  });

  it("admin réessai : refuse ID d'un autre serveur, autorise provenance après parent purgé", async () => {
    const action = (await import("@/app/admin/nettoyage/actions")).retryDiscordCleanupAction;
    await db.session.deleteMany();
    const form = new FormData();
    form.set("deliveryId", ids.db);
    await action(form);
    expect(await db.notificationEvent.count()).toBe(2);
    form.set("deliveryId", ids.da);
    await action(form);
    expect(await db.notificationEvent.count({ where: { communityId: ids.a } })).toBe(2);
    expect(await db.notificationEvent.count({ where: { communityId: ids.b } })).toBe(1);
  });

  it.each(["REMOVED", "LEFT"] as const)("membre admin %s : audit et réessai refusés malgré son rôle plateforme", async (status) => {
    await db.membership.updateMany({ where: { userId: admin.id }, data: { status } });
    expect((await cleanup.listFailedDiscordCleanupDeliveries(admin.id))).toEqual([]);
    expect((await audit.generateStorageAuditReport(admin.id)).sessions.total).toBe(0);
  });

  it("inventaire legacy et nettoyages : filtre event durable, jamais le préfixe default-guild", async () => {
    expect((await cleanup.listFailedDiscordCleanupDeliveries(admin.id)).map((row) => row.deliveryId)).toEqual([ids.da]);
    await db.notificationDelivery.updateMany({ data: { status: "SENT", targetSlot: "unused" } });
    for (const key of ["a", "b"]) await db.notificationDelivery.update({ where: { id: ids[`d${key}`] }, data: { targetSlot: `default-guild:SESSION:${ids[`s${key}`]}:announce` } });
    expect((await legacy.listLegacyPublicSessionAnnounces({ userId: admin.id })).entries.map((entry) => entry.sessionId)).toEqual([ids.sa]);
    await db.session.deleteMany();
    expect((await legacy.listLegacyPublicSessionAnnounces({ userId: admin.id })).entries.map((entry) => entry.sessionId)).toEqual([ids.sa]);
  });

  it("rétention chat/session : scope A uniquement, résumés XP/badges/résultats préservés", async () => {
    const opts = { scope: scope(), now, dryRun: false };
    expect((await retention.purgeEligibleChatMessagesBatch({ ...opts, dryRun: true })).messagesAffected).toBe(1);
    expect((await retention.purgeEligibleChatMessagesBatch(opts)).messagesAffected).toBe(1);
    expect(await db.chatMessage.count({ where: { communityId: ids.b } })).toBe(1);
    expect((await retention.purgeEligibleSessionsBatch(opts)).purgedSessionIds).toEqual([ids.sa]);
    expect(await db.session.findUnique({ where: { id: ids.sb } })).not.toBeNull();
    expect(await db.sessionResult.count({ where: { communityId: ids.a, sessionId: null } })).toBe(1);
    expect(await db.xpEvent.count()).toBe(2);
    expect(await db.userBadge.count()).toBe(2);
  });

  it("rétention tournois et instantanées : scope A uniquement", async () => {
    const opts = { scope: scope(), now, dryRun: false };
    expect((await retention.purgeEligibleTournamentsBatch(opts)).purgedTournamentIds).toEqual([ids.ta]);
    expect((await retention.purgeEligibleInstantSessionsBatch(opts)).purgedInstantSessionIds).toEqual([ids.ia]);
    expect(await db.tournament.findUnique({ where: { id: ids.tb } })).not.toBeNull();
    expect(await db.instantSession.findUnique({ where: { id: ids.ib } })).not.toBeNull();
  });

  it("programmation nettoyage de rétention : aucun événement de la communauté suspendue", async () => {
    await db.notificationDelivery.deleteMany();
    await db.session.updateMany({ data: { announceViaBot: true } });
    await db.tournament.updateMany({ data: { announceViaBot: true } });
    await db.community.update({ where: { id: ids.b }, data: { status: "SUSPENDED" } });
    const report = await retention.scheduleDiscordCleanupForEligibleEvents({ scope: scope(), now, dryRun: false });
    expect(report.sessionsEnqueued).toEqual([ids.sa]);
    expect(report.tournamentsEnqueued).toEqual([ids.ta]);
    expect(await db.notificationEvent.count({ where: { communityId: ids.b } })).toBe(1);
  });

  it("cron et fin immédiate des fils : parents ACTIVE seulement, même avec un fil historique SENT", async () => {
    await db.notificationDelivery.deleteMany();
    await db.session.updateMany({ data: { announceViaBot: true } });
    await db.tournament.updateMany({ data: { announceViaBot: true } });
    for (const key of ["a", "b"]) for (const category of ["SESSION", "TOURNAMENT"] as const) {
      const sourceId = ids[`${category === "SESSION" ? "s" : "t"}${key}`];
      const event = await db.notificationEvent.create({ data: { communityId: ids[key], category, eventType: "THREAD_CREATED", sourceId } });
      await db.notificationDelivery.create({ data: { eventId: event.id, channel: "DISCORD_CHANNEL", transport: "BOT", recipientKey: "channel", targetSlot: `default-guild:${category}:${sourceId}:thread`, status: "SENT", discordThreadId: sourceId } });
    }
    await db.community.update({ where: { id: ids.b }, data: { status: "SUSPENDED" } });
    const threads = await import("./discord-thread-cleanup");
    const report = await threads.runDiscordThreadCleanup({ now, dryRun: true });
    expect(report.sessions.archiveEnqueued).toEqual([ids.sa]);
    expect(report.tournaments.archiveEnqueued).toEqual([ids.ta]);
    expect(await threads.closeThreadOnEnd("session", ids.sb)).toBe("not_eligible");
    expect(await threads.closeThreadOnEnd("tournament", ids.tb)).toBe("not_eligible");
  });

  it("purge notifications : date de saison propre et conservation serveur B", async () => {
    expect((await retention.purgeClosedSeasonNotificationsBatch({ scope: scope(), dryRun: false })).notificationsAffected).toBe(1);
    expect(await db.notification.count({ where: { communityId: ids.b } })).toBe(1);
  });

  it("livraisons techniques : sélection et suppression suivent event.communityId", async () => {
    await db.notificationDelivery.updateMany({ data: { status: "SENT" } });
    expect((await retention.purgeTechnicalDeliveriesBatch({ scope: scope(), now, dryRun: true })).deliveriesAffected).toBe(1);
    expect((await retention.purgeTechnicalDeliveriesBatch({ scope: scope(), now, dryRun: false })).deliveriesAffected).toBe(1);
    expect(await db.notificationDelivery.findUnique({ where: { id: ids.db } })).not.toBeNull();
  });

  it("une dette de provenance incorrecte bloque toujours la cascade du parent autorisé", async () => {
    await db.debt.create({ data: { sessionId: ids.sa, communityId: ids.b, debtorId: admin.id, reason: "impayé" } });
    await db.community.update({ where: { id: ids.b }, data: { status: "SUSPENDED" } });
    expect((await retention.purgeEligibleSessionsBatch({ scope: scope(), now, dryRun: true })).purgedSessionIds).toEqual([]);
    expect((await retention.purgeEligibleSessionsBatch({ scope: scope(), now, dryRun: false })).purgedSessionIds).toEqual([]);
    expect(await db.session.findUnique({ where: { id: ids.sa } })).not.toBeNull();
  });

  it.each(["session", "tournament", "instantSession", "chatMessage", "notification", "notificationDelivery"] as const)("suspension entre sélection et mutation %s : relecture sous FOR SHARE", async (kind) => {
    if (kind === "notificationDelivery") await db.notificationDelivery.updateMany({ data: { status: "SENT" } });
    const original = db.$transaction.bind(db);
    vi.spyOn(db, "$transaction").mockImplementationOnce((async (...args: Parameters<typeof original>) => {
      await db.community.update({ where: { id: ids.a }, data: { status: "SUSPENDED" } });
      return original(...args);
    }) as typeof db.$transaction);
    const opts = { scope: scope(), now, dryRun: false };
    if (kind === "session") expect((await retention.purgeEligibleSessionsBatch(opts)).purgedSessionIds).toEqual([]);
    if (kind === "tournament") expect((await retention.purgeEligibleTournamentsBatch(opts)).purgedTournamentIds).toEqual([]);
    if (kind === "instantSession") expect((await retention.purgeEligibleInstantSessionsBatch(opts)).purgedInstantSessionIds).toEqual([]);
    if (kind === "chatMessage") expect((await retention.purgeEligibleChatMessagesBatch(opts)).messagesAffected).toBe(0);
    if (kind === "notification") expect((await retention.purgeClosedSeasonNotificationsBatch(opts)).notificationsAffected).toBe(0);
    if (kind === "notificationDelivery") expect((await retention.purgeTechnicalDeliveriesBatch(opts)).deliveriesAffected).toBe(0);
  });

  it("communauté suspendue : aucune lecture admin ni purge, le journal ne rend pas le parent default", async () => {
    await db.community.update({ where: { id: ids.a }, data: { status: "SUSPENDED" } });
    await db.membership.updateMany({ where: { communityId: ids.b }, data: { status: "REMOVED" } });
    expect(await cleanup.listFailedDiscordCleanupDeliveries(admin.id)).toEqual([]);
    expect((await audit.generateStorageAuditReport(admin.id)).sessions.total).toBe(0);
    expect((await retention.purgeEligibleSessionsBatch({ scope: scope(), now, dryRun: false })).purgedSessionIds).toEqual([]);
    expect(await delivery.isNotificationEventCommunityActive({ communityId: ids.a })).toBe(false);
  });

  it("catalogues partagés : archivage conserve badges et récompenses historiques sur les deux serveurs", async () => {
    const form = new FormData();
    form.set("id", badgeId);
    await (await import("@/app/admin/badges/actions")).deleteBadge(form);
    expect((await db.badge.findUniqueOrThrow({ where: { id: badgeId } })).active).toBe(false);
    expect(await db.userBadge.count({ where: { badgeId } })).toBe(2);
    const category = await db.superlativeCategory.create({ data: { name: "MVP", icon: "🏆", modifiedById: admin.id } });
    for (const key of ["a", "b"]) await db.superlativeAward.create({ data: { communityId: ids[key], sessionId: ids[`s${key}`], categoryId: category.id, winnerUserId: admin.id, voteCount: 1 } });
    form.set("id", category.id);
    await (await import("@/app/admin/superlatifs/actions")).deleteSuperlativeCategory(form);
    expect((await db.superlativeCategory.findUniqueOrThrow({ where: { id: category.id } })).active).toBe(false);
    expect(await db.superlativeAward.count({ where: { categoryId: category.id } })).toBe(2);
  });
});
