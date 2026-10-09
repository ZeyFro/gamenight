import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

describe.skipIf(!TEST_DATABASE_URL)("partie immédiate : annonce publique du bon serveur", () => {
  let db: import("@prisma/client").PrismaClient;
  let sessions: typeof import("./instant-sessions");
  let announce: typeof import("./instant-session-announce");
  let executor: typeof import("./notification-executor");
  beforeAll(async () => {
    db = (await import("./prisma")).prisma as unknown as typeof db;
    sessions = await import("./instant-sessions"); announce = await import("./instant-session-announce"); executor = await import("./notification-executor");
  });
  afterAll(async () => { await db?.$disconnect(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "NotificationEvent", "Community", "User", "Game", "CreationIntent" CASCADE');
    (await import("./default-community")).resetDefaultCommunityIdCache();
    for (const flag of ["COMMUNITY_ISOLATION_ENABLED", "COMMUNITY_PICKER_ENABLED", "COMMUNITY_CHANNELS_ENABLED", "DISCORD_BOT_SESSION_ANNOUNCE_ENABLED"]) vi.stubEnv(flag, "true");
    vi.stubEnv("DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED", "false");
    vi.stubEnv("VERCEL_ENV", "production"); vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "gamenight.test"); vi.stubEnv("DISCORD_BOT_TOKEN", "test");
    vi.stubGlobal("fetch", vi.fn(() => { throw Error("Discord réel interdit"); }));
    await db.community.createMany({ data: [{ id: "a", slug: "default", name: "A", discordGuildId: "guild-a", status: "ACTIVE" }, { id: "b", slug: "b", name: "The Tower", discordGuildId: "guild-b", status: "ACTIVE" }] });
    await db.communityChannelConfig.createMany({ data: ["a", "b"].map(communityId => ({ communityId, category: "SESSION", discordChannelId: `channel-${communityId}`, enabled: true })) });
    await db.user.createMany({ data: ["host", "alice", "outsider"].map(id => ({ id, discordName: id, discordId: id, activeCommunityId: id === "outsider" ? "a" : "b" })) });
    await db.membership.createMany({ data: [{ userId: "host", communityId: "a", status: "ACTIVE" }, { userId: "host", communityId: "b", status: "ACTIVE" }, { userId: "alice", communityId: "b", status: "ACTIVE" }, { userId: "outsider", communityId: "a", status: "ACTIVE" }] });
    await db.game.createMany({ data: [{ id: "game", name: "Coop", source: "MANUAL", addedById: "host" }, { id: "next-game", name: "Autre jeu", source: "MANUAL", addedById: "host" }] });
  });
  async function create(key = randomUUID()) {
    const result = await sessions.createInstantSession({ creatorId: "host", gameId: "game", notifiedUserIds: [], creationKey: key });
    if (!result.ok) throw Error(result.reason); return result.instantSession;
  }
  async function resolve(id: string, operation: "SEND" | "EDIT" = "SEND") {
    const delivery = await db.notificationDelivery.findFirstOrThrow({ where: { operation, targetSlot: `default-guild:INSTANT_SESSION:${id}:announce` }, include: { event: true }, orderBy: { createdAt: "desc" } });
    return announce.instantSessionInviteResolver.resolve({ event: delivery.event, delivery: { ...delivery, targetMessage: null }, now: new Date() });
  }
  async function markSent(id: string) {
    await db.notificationDelivery.updateMany({ where: { targetSlot: `default-guild:INSTANT_SESSION:${id}:announce`, operation: "SEND" }, data: { status: "SENT", discordChannelId: "channel-b", discordMessageId: "message" } });
  }
  it("crée une annonce sans invité/MP et ne la duplique pas au replay de création", async () => {
    const key = randomUUID(); const s = await create(key); expect((await create(key)).id).toBe(s.id);
    expect(await db.notificationDelivery.count()).toBe(1);
    const result = await resolve(s.id); expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.action).toMatchObject({ kind: "send_channel_message_verified", guildId: "guild-b", channelId: "channel-b", message: { allowedMentions: { parse: [] } } });
      expect(JSON.stringify(result.action)).toContain(`/jouer-maintenant/${s.id}`);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("la destination ne change pas avec le serveur choisi ; B peut rejoindre, A ne peut pas", async () => {
    const s = await create(); await db.user.update({ where: { id: "host" }, data: { activeCommunityId: "a" } });
    expect(await resolve(s.id)).toMatchObject({ eligible: true, action: { channelId: "channel-b" } });
    expect(await sessions.joinInstantSession(s.id, "alice")).toEqual({ ok: true });
    expect(await sessions.joinInstantSession(s.id, "outsider")).toMatchObject({ ok: false, reason: "not_found" });
    expect(await sessions.getInstantSessionView(s.id, "outsider")).toBeNull();
  });
  it("un salon désactivé n'emprunte jamais le salon default", async () => {
    const s = await create(); await db.communityChannelConfig.updateMany({ where: { communityId: "b" }, data: { enabled: false } });
    expect(await resolve(s.id)).toMatchObject({ eligible: false, reason: "configuration_unavailable" });
    vi.stubEnv("COMMUNITY_CHANNELS_ENABLED", "false");
    expect(await resolve(s.id)).toMatchObject({ eligible: false, reason: "configuration_unavailable" });
  });
  it("la fin édite l'annonce existante et retire le lien de participation", async () => {
    const s = await create(); await markSent(s.id);
    expect(await sessions.endInstantSession(s.id, "host", "creator_left")).toMatchObject({ ok: true });
    const result = await resolve(s.id, "EDIT"); expect(result.eligible).toBe(true);
    if (result.eligible) { expect(result.action).toMatchObject({ kind: "edit_channel_message", channelId: "channel-b", messageId: "message" }); expect(JSON.stringify(result.action)).not.toContain("Rejoindre"); }
    expect(await db.notificationDelivery.count({ where: { operation: "SEND" } })).toBe(1);
    expect(await sessions.joinInstantSession(s.id, "alice")).toMatchObject({ ok: false, reason: "ended" });
  });
  it("un changement de jeu édite le même message sans deuxième annonce", async () => {
    const s = await create(); await markSent(s.id);
    expect(await sessions.changeInstantSessionGame(s.id, "host", "next-game")).toEqual({ ok: true });
    const result = await resolve(s.id, "EDIT"); expect(result.eligible).toBe(true);
    if (result.eligible) { expect(result.action).toMatchObject({ kind: "edit_channel_message", messageId: "message" }); expect(JSON.stringify(result.action)).toContain("Autre jeu"); }
    expect(await db.notificationDelivery.count({ where: { operation: "SEND" } })).toBe(1);
  });
  it("retirer le créateur bloque l'annonce même flags d'isolation OFF", async () => {
    const s = await create(); vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    await db.membership.updateMany({ where: { userId: "host", communityId: "b" }, data: { status: "REMOVED" } });
    expect(await resolve(s.id)).toMatchObject({ eligible: false, reason: "expired" });
  });
  it("un SEND expiré n'annonce pas une partie périmée ; suspendre la communauté bloque", async () => {
    const s = await create(); await db.instantSession.update({ where: { id: s.id }, data: { expiresAt: new Date(0) } });
    expect(await resolve(s.id)).toMatchObject({ eligible: false, reason: "expired" });
    await db.instantSession.update({ where: { id: s.id }, data: { expiresAt: new Date("2099-01-01") } });
    await db.community.update({ where: { id: "b" }, data: { status: "SUSPENDED" } });
    expect(await resolve(s.id)).toMatchObject({ eligible: false });
  });
  it("un salon Discord du mauvais serveur est refusé avant tout POST", async () => {
    const s = await create(); const result = await resolve(s.id); if (!result.eligible) throw Error("Résolution attendue");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "channel-b", guild_id: "guild-a", type: 0 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock); const now = new Date();
    expect(await executor.performDiscordAction(result.action, new Date(now.getTime() + 10_000), now)).toMatchObject({ ok: false, kind: "destination_mismatch" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
