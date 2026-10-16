import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const mocks = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock("@/lib/prisma", async () => { const { PrismaClient } = await import("@prisma/client"); return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} }; });
vi.mock("@/lib/session-announce", () => ({ enqueueSessionAnnounceUpdate: mocks.enqueue }));
if (!TEST_DATABASE_URL) console.warn("[session-seats.integration] TEST_DATABASE_URL absente — tests Postgres SKIPPÉS.");

describe.skipIf(!TEST_DATABASE_URL)("places : transactions, FIFO et isolation Postgres", () => {
  let db: import("@prisma/client").PrismaClient;
  let change: typeof import("./session-seats").changeSessionSeat;
  let read: typeof import("./session-seats").readSessionSeats;
  let participants: typeof import("./superlative-voting").getWinningProposalParticipants;
  beforeAll(async () => { db = (await import("@/lib/prisma")).prisma as typeof db; ({ changeSessionSeat: change, readSessionSeats: read } = await import("./session-seats")); participants = (await import("./superlative-voting")).getWinningProposalParticipants; });
  afterAll(async () => { await db.$disconnect(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true"); vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true"); mocks.enqueue.mockReset();
    await db.$executeRawUnsafe('TRUNCATE "NotificationEvent", "Community", "User", "Game" CASCADE');
    await db.community.createMany({ data: [{ id: "a", slug: "default", name: "A", status: "ACTIVE" }, { id: "b", slug: "b", name: "B", status: "ACTIVE" }] });
    await db.user.createMany({ data: ["host", "alice", "bob", "outsider", "foreign"].map(id => ({ id, discordId: id, discordName: id, activeCommunityId: id === "foreign" ? "b" : "a" })) });
    await db.membership.createMany({ data: ["host", "alice", "bob", "outsider"].map(userId => ({ userId, communityId: "a", status: "ACTIVE" })) });
    await db.membership.createMany({ data: [{ userId: "host", communityId: "b", status: "ACTIVE" }, { userId: "foreign", communityId: "b", status: "ACTIVE" }] });
    await db.game.create({ data: { id: "game", name: "Coop", minPlayers: 1, maxPlayers: 2, source: "MANUAL", addedById: "host" } });
    const { wallClockNow } = await import("./wallclock");
    await db.session.create({ data: { id: "s", createdById: "host", communityId: "a", status: "SCHEDULED", date: new Date(wallClockNow().getTime() + 86_400_000), decidedGameId: "game", attendanceCapacity: 1 } });
    await db.sessionInvite.createMany({ data: ["alice", "bob", "foreign"].map(userId => ({ sessionId: "s", userId, invitedById: "host", status: "ACTIVE" })) });
    await db.proposal.create({ data: { id: "p", sessionId: "s", gameId: "game", proposedById: "host" } });
    await db.vote.create({ data: { proposalId: "p", userId: "host" } });
    await db.sessionSeat.create({ data: { sessionId: "s", userId: "host", status: "CONFIRMED" } });
  });
  const join = (userId: string) => change(userId, "s", { kind: "join" });
  const leave = (userId: string) => change(userId, "s", { kind: "leave" });
  async function discordOrigin(userId = "alice", dm = false) {
    await db.community.update({ where: { id: "a" }, data: { discordGuildId: "111" } });
    const event = await db.notificationEvent.create({ data: { category: "SESSION", eventType: dm ? "SESSION_DM" : "SESSION_CREATED", communityId: "a", sourceId: "s", occurrence: userId } });
    await db.notificationDelivery.create({ data: { eventId: event.id, channel: dm ? "DISCORD_DM" : "DISCORD_CHANNEL", transport: "BOT", status: "SENT", recipientKey: dm ? `user:${userId}` : "channel", targetSlot: `default-guild:SESSION:s:${dm ? "dm:" + userId : "announce"}`, discordMessageId: `message-${userId}`, ...(dm ? { discordChannelId: "222" } : { discordThreadId: "222" }) } });
    return { interactionId: `click-${userId}`, discordId: userId, guildId: dm ? undefined : "111", channelId: "222", messageId: `message-${userId}` };
  }
  it("Discord et site partagent la dernière place et la promotion FIFO", async () => {
    const origin = await discordOrigin();
    expect(await change("alice", "s", { kind: "join" }, origin)).toMatchObject({ ok: true, status: "WAITLIST" });
    await leave("host");
    expect(await db.sessionSeat.findFirst({ where: { userId: "alice" } })).toMatchObject({ status: "CONFIRMED" });
    expect(await db.notification.count({ where: { userId: "alice" } })).toBe(1);
  });
  it("deux retries Discord ne rejouent pas une ancienne réponse après un désistement", async () => {
    await db.sessionSeat.deleteMany({}); const origin = await discordOrigin();
    const results = await Promise.all([change("alice", "s", { kind: "join" }, origin), change("alice", "s", { kind: "join" }, origin)]);
    expect(results.filter(result => result.ok && result.replayed)).toHaveLength(1);
    expect(await db.notification.count({ where: { userId: "alice" } })).toBe(1);
    await leave("alice");
    expect(await change("alice", "s", { kind: "join" }, origin)).toMatchObject({ ok: true, replayed: true });
    expect(await db.sessionSeat.findFirst({ where: { userId: "alice" } })).toMatchObject({ status: "DECLINED" });
    expect(await db.notificationEvent.count({ where: { eventType: "SESSION_RSVP" } })).toBe(1);
  });
  it("le serveur sélectionné sur le site ne change pas l'origine d'une réponse Discord", async () => {
    const origin = await discordOrigin("host"); await db.user.update({ where: { id: "host" }, data: { activeCommunityId: "b" } });
    expect(await change("host", "s", { kind: "leave" }, origin)).toMatchObject({ ok: true });
  });
  it("refuse mauvais serveur, canal, message ou identité, sans marqueur ni siège", async () => {
    const origin = await discordOrigin();
    for (const over of [{ guildId: "999" }, { channelId: "999" }, { messageId: "999" }, { discordId: "bob" }]) expect(await change("alice", "s", { kind: "join" }, { ...origin, ...over })).toEqual({ ok: false, error: "access" });
    expect(await db.sessionSeat.count()).toBe(1); expect(await db.notificationEvent.count({ where: { eventType: "SESSION_RSVP" } })).toBe(0);
  });
  it("un message pas confirmé SENT ou une invitation révoquée ne donne aucun accès", async () => {
    const origin = await discordOrigin(); await db.notificationDelivery.updateMany({ data: { status: "FAILED" } });
    expect(await change("alice", "s", { kind: "join" }, origin)).toEqual({ ok: false, error: "access" });
    await db.notificationDelivery.updateMany({ data: { status: "SENT" } }); await db.sessionInvite.updateMany({ where: { userId: "alice" }, data: { status: "REVOKED" } });
    expect(await change("alice", "s", { kind: "join" }, origin)).toEqual({ ok: false, error: "access" });
  });
  it("MP : vérifie le destinataire, même si un autre invité connaît l'id du message", async () => {
    const origin = await discordOrigin("alice", true);
    expect(await change("bob", "s", { kind: "join" }, { ...origin, discordId: "bob" })).toEqual({ ok: false, error: "access" });
    expect(await change("alice", "s", { kind: "join" }, origin)).toMatchObject({ ok: true });
  });
  it("soirée sans capacité : RSVP confirmés illimités, désistements préservés lors de l'activation", async () => {
    await db.session.update({ where: { id: "s" }, data: { attendanceCapacity: null } });
    await db.sessionSeat.deleteMany({});
    const origin = await discordOrigin();
    expect(await change("alice", "s", { kind: "join" }, origin)).toMatchObject({ ok: true, status: "CONFIRMED" });
    expect(await change("bob", "s", { kind: "join" }, { ...origin, interactionId: "200", discordId: "bob" })).toMatchObject({ ok: true, status: "CONFIRMED" });
    await db.game.update({ where: { id: "game" }, data: { maxPlayers: 4 } });
    expect(await change("host", "s", { kind: "capacity", capacity: 2 })).toEqual({ ok: false, error: "capacity" });
    expect(await change("host", "s", { kind: "capacity", capacity: 3 })).toMatchObject({ ok: true, status: "CONFIRMED" });
    expect(await db.sessionSeat.count({ where: { status: "CONFIRMED" } })).toBe(3);
    expect(await db.session.findUniqueOrThrow({ where: { id: "s" } })).toMatchObject({ attendanceCapacity: 3 });
  });
  it("Discord revalide Membership et Community même lorsque les flags d'isolation sont OFF", async () => {
    const origin = await discordOrigin(); vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    await db.membership.updateMany({ where: { userId: "alice" }, data: { status: "REMOVED" } });
    expect(await change("alice", "s", { kind: "join" }, origin)).toEqual({ ok: false, error: "access" });
    await db.membership.updateMany({ where: { userId: "alice" }, data: { status: "ACTIVE" } }); await db.community.update({ where: { id: "a" }, data: { status: "SUSPENDED" } });
    expect(await change("alice", "s", { kind: "join" }, origin)).toEqual({ ok: false, error: "access" });
  });
  it("le reçu de réponse fait partie du commit, et disparaît en cas de rollback", async () => {
    const origin = await discordOrigin(); await db.sessionSeat.deleteMany({}); await db.session.update({ where: { id: "s" }, data: { announceViaBot: true } });
    mocks.enqueue.mockRejectedValueOnce(new Error("enqueue failure"));
    await expect(change("alice", "s", { kind: "join" }, origin)).rejects.toThrow("enqueue failure");
    expect(await db.sessionSeat.count()).toBe(0); expect(await db.notificationEvent.count({ where: { eventType: "SESSION_RSVP" } })).toBe(0);
    expect(await change("alice", "s", { kind: "join" }, origin)).toMatchObject({ ok: true, status: "CONFIRMED" });
  });
  it("compatibilité d'un message historique sans communityId uniquement pour default", async () => {
    const origin = await discordOrigin(); await db.notificationEvent.updateMany({ data: { communityId: null } });
    expect(await change("alice", "s", { kind: "join" }, origin)).toMatchObject({ ok: true });
  });
  it("aucun message sans provenance ne devient une autorité dans un autre serveur", async () => {
    const origin = await discordOrigin(); await db.community.update({ where: { id: "a" }, data: { slug: "another" } });
    await db.notificationEvent.updateMany({ data: { communityId: null } });
    expect(await change("alice", "s", { kind: "join" }, origin)).toEqual({ ok: false, error: "access" });
  });
  it("une dernière place n'est prise qu'une fois, même par des clics simultanés", async () => {
    await db.sessionSeat.deleteMany({});
    const results = await Promise.all([join("alice"), join("bob"), join("alice"), join("bob")]);
    expect(results.every(result => result.ok)).toBe(true);
    expect(await db.sessionSeat.count({ where: { status: "CONFIRMED" } })).toBe(1);
    expect(await db.sessionSeat.count({ where: { status: "WAITLIST" } })).toBe(1);
    expect(await db.notification.count()).toBe(1);
  });
  it("désistement : promotion FIFO durable une seule fois, puis réinscription en fin de file", async () => {
    await join("alice"); await join("bob");
    await db.sessionSeat.updateMany({ where: { userId: "alice" }, data: { requestedAt: new Date(1) } });
    await db.sessionSeat.updateMany({ where: { userId: "bob" }, data: { requestedAt: new Date(2) } });
    await leave("host"); await leave("host");
    expect(await db.sessionSeat.findFirst({ where: { userId: "alice" } })).toMatchObject({ status: "CONFIRMED" });
    expect(await db.notification.count({ where: { userId: "alice", communityId: "a", relatedSessionId: "s" } })).toBe(1);
    expect(await join("host")).toEqual({ ok: true, status: "WAITLIST" });
    await leave("alice");
    expect(await db.sessionSeat.findFirst({ where: { userId: "bob" } })).toMatchObject({ status: "CONFIRMED" });
    expect(await db.vote.count()).toBe(1); // Historique de vote inchangé.
  });
  it("une invitation révoquée ou un membre retiré est sauté avant toute promotion", async () => {
    await join("alice"); await join("bob");
    await db.membership.updateMany({ where: { userId: "alice" }, data: { status: "REMOVED" } });
    await leave("host");
    expect(await db.sessionSeat.findFirst({ where: { userId: "alice" } })).toMatchObject({ status: "DECLINED" });
    expect(await db.sessionSeat.findFirst({ where: { userId: "bob" } })).toMatchObject({ status: "CONFIRMED" });
    expect(await db.notification.count({ where: { userId: "alice" } })).toBe(0);
    expect(await read("alice", "s")).toBeNull();
    await db.sessionInvite.updateMany({ where: { userId: "bob" }, data: { status: "REVOKED" } });
    await change("host", "s", { kind: "refresh" });
    expect(await db.sessionSeat.findFirst({ where: { userId: "bob" } })).toMatchObject({ status: "DECLINED" });
  });
  it("refuse un membre de B, un membre non invité et une modification de capacité par un invité", async () => {
    for (const user of ["foreign", "outsider"]) expect(await join(user)).toEqual({ ok: false, error: "access" });
    expect(await change("alice", "s", { kind: "capacity", capacity: 2 })).toEqual({ ok: false, error: "access" });
    expect(await db.sessionSeat.count()).toBe(1);
  });
  it("revalide une communauté suspendue et refuse toutes les inscriptions après fermeture", async () => {
    await db.community.update({ where: { id: "a" }, data: { status: "SUSPENDED" } });
    expect(await join("host")).toEqual({ ok: false, error: "access" });
    await db.community.update({ where: { id: "a" }, data: { status: "ACTIVE" } });
    await db.session.update({ where: { id: "s" }, data: { status: "DONE" } });
    expect(await join("alice")).toEqual({ ok: false, error: "closed" });
    await db.session.update({ where: { id: "s" }, data: { status: "SCHEDULED", date: new Date(0) } });
    expect(await leave("host")).toEqual({ ok: false, error: "closed" });
  });
  it("augmenter la capacité promeut sans perte ; la réduire ne chasse aucun confirmé", async () => {
    await join("alice");
    expect((await change("host", "s", { kind: "capacity", capacity: 2 })).ok).toBe(true);
    expect(await db.sessionSeat.count({ where: { status: "CONFIRMED" } })).toBe(2);
    for (const capacity of [1, 3, 0, 101]) expect(await change("host", "s", { kind: "capacity", capacity })).toEqual({ ok: false, error: "capacity" });
    expect(await db.sessionSeat.count({ where: { status: "CONFIRMED" } })).toBe(2);
  });
  it("activation : conserve les RSVP illimités et reprend les votants sans modifier les votes", async () => {
    await db.session.update({ where: { id: "s" }, data: { attendanceCapacity: null } }); await db.sessionSeat.deleteMany({});
    expect(await join("alice")).toEqual({ ok: true, status: "CONFIRMED" });
    expect((await change("host", "s", { kind: "capacity", capacity: 2 })).ok).toBe(true);
    expect(await db.sessionSeat.findUnique({ where: { sessionId_userId: { sessionId: "s", userId: "host" } } })).toMatchObject({ status: "CONFIRMED" });
    expect(await db.sessionSeat.findFirst({ where: { userId: "alice" } })).toMatchObject({ status: "CONFIRMED" });
    expect(await db.vote.count()).toBe(1);
  });
  it("participants de résultats/pronostics : seuls les confirmés, avec compatibilité historique", async () => {
    await join("alice"); await leave("host");
    expect((await participants("s", "game")).map(user => user.id)).toEqual(["alice"]);
    await db.session.update({ where: { id: "s" }, data: { attendanceCapacity: null } });
    expect((await participants("s", "game")).map(user => user.id)).toEqual(["host"]);
  });
  it("l'échec de la mise en file Discord annule aussi la promotion et sa notification", async () => {
    await join("alice"); await db.session.update({ where: { id: "s" }, data: { announceViaBot: true } });
    mocks.enqueue.mockRejectedValueOnce(new Error("enqueue failure"));
    await expect(leave("host")).rejects.toThrow("enqueue failure");
    expect(await db.sessionSeat.findFirst({ where: { userId: "host" } })).toMatchObject({ status: "CONFIRMED" });
    expect(await db.sessionSeat.findFirst({ where: { userId: "alice" } })).toMatchObject({ status: "WAITLIST" });
    expect(await db.notification.count()).toBe(0);
  });
  it("flags OFF conserve les invitations privées ; supprimer le parent supprime ses sièges", async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    expect((await join("foreign")).ok).toBe(true);
    expect(await join("outsider")).toEqual({ ok: false, error: "access" });
    await db.session.delete({ where: { id: "s" } }); expect(await db.sessionSeat.count()).toBe(0);
  });
  it("migration à blanc avec lignes historiques : capacité NULL et votes conservés", async () => {
    const sql = readFileSync("prisma/migrations/20261008210000_session_seats/migration.sql", "utf8");
    await expect(db.$transaction(async tx => {
      await tx.$executeRawUnsafe('CREATE SCHEMA seat_rehearsal');
      await tx.$executeRawUnsafe('SET LOCAL search_path TO seat_rehearsal');
      await tx.$executeRawUnsafe('CREATE TABLE "User" (id TEXT PRIMARY KEY)');
      await tx.$executeRawUnsafe('CREATE TABLE "Session" (id TEXT PRIMARY KEY)');
      await tx.$executeRawUnsafe('CREATE TABLE "Vote" (id TEXT PRIMARY KEY)');
      await tx.$executeRawUnsafe('INSERT INTO "Session" VALUES (\'historical\')');
      await tx.$executeRawUnsafe('INSERT INTO "Vote" VALUES (\'historical_vote\')');
      for (const statement of sql.split(";").map(part => part.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
      expect(await tx.$queryRawUnsafe('SELECT id, "attendanceCapacity" FROM "Session"')).toEqual([{ id: "historical", attendanceCapacity: null }]);
      expect(await tx.$queryRawUnsafe('SELECT id FROM "Vote"')).toEqual([{ id: "historical_vote" }]);
      throw new Error("rehearsal-rollback"); // Nettoie tout le schéma isolé sans toucher aux données de test publiques.
    })).rejects.toThrow("rehearsal-rollback");
  });
});
