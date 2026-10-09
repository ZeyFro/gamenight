import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimedDelivery } from "./notification-delivery";
import { wallClockNow } from "./wallclock";
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => { const { PrismaClient } = await import("@prisma/client"); return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} }; });
if (!TEST_DATABASE_URL) console.warn("[session-rsvp-announcements] TEST_DATABASE_URL absente — SKIPPÉ.");

describe.skipIf(!TEST_DATABASE_URL)("annonces personnalisées, MP, mentions et boutons", () => {
  let db: import("@prisma/client").PrismaClient;
  let resolver: typeof import("./session-announce").sessionAnnounceResolver;
  let count = 0;
  beforeAll(async () => { db = (await import("@/lib/prisma")).prisma as typeof db; resolver = (await import("./session-announce")).sessionAnnounceResolver; });
  afterAll(async () => { await db.$disconnect(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true"); vi.stubEnv("COMMUNITY_CHANNELS_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "true"); vi.stubEnv("DISCORD_DM_SESSION_ENABLED", "true");
    vi.stubEnv("DISCORD_DM_ROULETTE_ENABLED", "true"); vi.stubEnv("DISCORD_BOT_TOKEN", "test-only");
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "111"); vi.stubEnv("DISCORD_BOT_SESSION_CHANNEL_ID", "444");
    vi.stubEnv("DISCORD_APP_PUBLIC_KEY", "ab".repeat(32)); vi.stubEnv("DISCORD_CLIENT_ID", "555");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Aucun HTTP attendu au resolver"); }));
    await db.$executeRawUnsafe('TRUNCATE "Community", "User", "Game" CASCADE');
    await db.community.create({ data: { id: "a", slug: "default", name: "A", status: "ACTIVE", discordGuildId: "111" } });
    await db.communityChannelConfig.create({ data: { communityId: "a", category: "SESSION", discordChannelId: "444", enabled: true } });
    await db.user.createMany({ data: ["host", "alice", "bob"].map((id, index) => ({ id, discordId: String(700 + index), discordName: id })) });
    await db.membership.createMany({ data: ["host", "alice", "bob"].map(userId => ({ communityId: "a", userId, status: "ACTIVE" })) });
    await db.game.create({ data: { id: "g", name: "Coop", source: "MANUAL", addedById: "host" } });
    await db.session.create({ data: { id: "s", communityId: "a", createdById: "host", status: "SCHEDULED", date: new Date(wallClockNow().getTime() + 86_400_000), decidedGameId: "g", attendanceCapacity: 2, announceViaBot: true, notifiedUserIds: ["host", "alice", "bob"] } });
    await db.sessionInvite.createMany({ data: ["alice", "bob"].map(userId => ({ userId, sessionId: "s", invitedById: "host", status: "ACTIVE" })) });
    await db.proposal.create({ data: { id: "p", sessionId: "s", gameId: "g", proposedById: "host" } });
    await db.vote.createMany({ data: ["host", "alice"].map(userId => ({ proposalId: "p", userId })) });
    await db.sessionSeat.createMany({ data: ["host", "alice"].map(userId => ({ sessionId: "s", userId, status: "CONFIRMED" })) });
    await db.messageTemplate.create({ data: { text: "PERSONNALISÉ {createur} — {date} à {heure}", categories: ["SESSION_CREATED"], createdById: "host", modifiedById: "host" } });
    const event = await db.notificationEvent.create({ data: { category: "SESSION", sourceId: "s", communityId: "a", eventType: "SESSION_CREATED" } });
    await db.notificationDelivery.create({ data: { eventId: event.id, transport: "BOT", channel: "DISCORD_CHANNEL", recipientKey: "channel", targetSlot: "default-guild:SESSION:s:thread", status: "SENT", discordThreadId: "222" } });
  });
  async function resolve(role: string, operation: "SEND" | "EDIT" = "SEND") {
    const event = await db.notificationEvent.create({ data: { category: "SESSION", sourceId: "s", communityId: "a", eventType: "SESSION_TEST", occurrence: String(++count) } });
    const delivery = await db.notificationDelivery.create({ data: { eventId: event.id, transport: "BOT", operation, channel: role.startsWith("dm:") ? "DISCORD_DM" : "DISCORD_CHANNEL", recipientKey: role.startsWith("dm:") ? "user:alice" : "channel", targetSlot: `default-guild:SESSION:s:${role}`, ...(operation === "SEND" && role === "announce" ? { status: "SENT", discordMessageId: "333", discordThreadId: "222" } : {}) } });
    const result = await resolver.resolve({ event, delivery: delivery as ClaimedDelivery, now: new Date() });
    if (!result.eligible || !("message" in result.action)) throw new Error(JSON.stringify(result));
    return result.action.message;
  }
  it("création déjà SCHEDULED : modèle personnalisé + boutons ; invité mentionné, créateur uniquement en MP", async () => {
    const message = await resolve("announce");
    expect(message.embeds?.[0].description).toContain("PERSONNALISÉ host"); expect(message.components?.[0].components).toHaveLength(2);
    expect(message.allowedMentions.users).toEqual(["701"]); expect(message.content).not.toContain("<@700>");
    const dms = await db.notificationDelivery.findMany({ where: { channel: "DISCORD_DM", operation: "SEND" }, select: { recipientKey: true } });
    expect(dms.map(row => row.recipientKey).sort()).toEqual(["user:alice", "user:host"]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("MP d'une création SCHEDULED : modèle personnalisé, boutons et aucune mention", async () => {
    const message = await resolve("dm:announce:alice");
    expect(message.content).toContain("PERSONNALISÉ host"); expect(message.components?.[0].components).toHaveLength(2); expect(message.allowedMentions).toEqual({ parse: [] });
  });
  it("rappel : exclut attente et créateur des mentions, respecte les préférences et le texte personnalisé", async () => {
    await db.session.update({ where: { id: "s" }, data: { customReminderMessage: "PERSO {jeu} à {heure}" } });
    await db.sessionSeat.create({ data: { sessionId: "s", userId: "bob", status: "WAITLIST" } });
    const message = await resolve("thread-reminder-60");
    expect(message.content).toContain("PERSO Coop"); expect(message.allowedMentions.users).toEqual(["701"]); expect(message.components).toHaveLength(1);
    await db.userNotificationPreference.create({ data: { userId: "alice", category: "SESSION", enabled: false } });
    expect((await resolve("thread-reminder-30")).allowedMentions.users).toBeUndefined();
  });
  it("roulette planifiée : boutons et texte personnalisé, jamais de mention", async () => {
    await db.session.update({ where: { id: "s" }, data: { createdViaRoulette: true } });
    const message = await resolve("announce");
    expect(message.embeds?.[0].description).toContain("PERSONNALISÉ"); expect(message.components).toHaveLength(1); expect(message.allowedMentions.users).toBeUndefined();
  });
  it("édition après clôture : retire les boutons sans nouvel envoi de MP", async () => {
    await resolve("announce"); const before = await db.notificationDelivery.count({ where: { channel: "DISCORD_DM", operation: "SEND" } });
    await db.session.update({ where: { id: "s" }, data: { status: "DONE" } });
    expect((await resolve("announce", "EDIT")).components).toEqual([]);
    expect(await db.notificationDelivery.count({ where: { channel: "DISCORD_DM", operation: "SEND" } })).toBe(before);
  });
});
