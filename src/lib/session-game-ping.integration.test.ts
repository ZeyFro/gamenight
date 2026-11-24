import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaimedDelivery } from "./notification-delivery";
import { wallClockNow } from "./wallclock";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const listGuildRoles = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", async () => { const { PrismaClient } = await import("@prisma/client"); return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} }; });
// Aucun appel Discord réel : seule la liste des rôles du serveur est simulée.
vi.mock("@/lib/discord-rest", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/discord-rest")>()), listGuildRoles }));
vi.mock("@/lib/notification-executor-kick", () => ({ kickNotificationExecutor: vi.fn() }));
if (!TEST_DATABASE_URL) console.warn("[session-game-ping] TEST_DATABASE_URL absente — SKIPPÉ.");

const ROLE_ID = "900000000000000001";
const roles = (extra: object[] = []) => ({ ok: true, data: { roles: [{ id: ROLE_ID, name: "Coop", position: 1, permissions: "0", managed: false }, ...extra] } });

/**
 * Q19 (décision de Maxime : OUI) : ping du rôle de jeu à la création d'une soirée OUVERTE, seulement si un membre l'a demandé
 * (opt-in). Jamais pour une soirée privée, jamais @everyone ni @here, jamais un rôle autre que celui du jeu.
 */
describe.skipIf(!TEST_DATABASE_URL)("ping du rôle de jeu sur une nouvelle soirée ouverte (Q19)", () => {
  let db: import("@prisma/client").PrismaClient;
  let announce: typeof import("./session-announce");
  beforeAll(async () => { db = (await import("@/lib/prisma")).prisma as typeof db; announce = await import("./session-announce"); });
  afterAll(async () => { await db.$disconnect(); });
  afterEach(() => { vi.unstubAllEnvs(); listGuildRoles.mockReset(); });
  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true"); vi.stubEnv("COMMUNITY_CHANNELS_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "true"); vi.stubEnv("DISCORD_BOT_TOKEN", "test-only");
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "111"); vi.stubEnv("NOTIFICATION_CENTER_ENABLED", "true"); vi.stubEnv("SESSION_VISIBILITY_ENABLED", "true");
    listGuildRoles.mockResolvedValue(roles());
    await db.$executeRawUnsafe('TRUNCATE "NotificationEvent", "Community", "User", "Game" CASCADE');
    await db.community.create({ data: { id: "a", slug: "default", name: "A", status: "ACTIVE", discordGuildId: "111" } });
    await db.communityChannelConfig.create({ data: { communityId: "a", category: "SESSION", discordChannelId: "444", enabled: true } });
    await db.user.createMany({ data: ["host", "alice"].map((id, index) => ({ id, discordId: String(700 + index), discordName: id })) });
    await db.membership.createMany({ data: ["host", "alice"].map((userId) => ({ communityId: "a", userId, status: "ACTIVE" as const })) });
    await db.game.create({ data: { id: "g", name: "Coop", source: "MANUAL", addedById: "host" } });
    await db.session.create({ data: { id: "s", communityId: "a", createdById: "host", status: "VOTING", visibility: "PUBLIC", date: new Date(wallClockNow().getTime() + 86_400_000), announceViaBot: true, notifiedUserIds: ["host"] } });
    await db.proposal.create({ data: { id: "p", sessionId: "s", gameId: "g", proposedById: "host" } });
    await db.gamePingOptIn.create({ data: { userId: "alice", communityId: "a", gameId: "g" } });
  });
  const deliveries = () => db.notificationDelivery.findMany({ where: { targetSlot: { endsWith: ":game-ping" } } });

  async function resolveGamePing() {
    const [pingDelivery] = await deliveries();
    const event = await db.notificationEvent.findUniqueOrThrow({ where: { id: pingDelivery.eventId } });
    return announce.sessionAnnounceResolver.resolve({ event, delivery: pingDelivery as ClaimedDelivery, now: new Date() });
  }

  it("soirée ouverte d'un seul jeu avec un abonné : un message de salon, un seul rôle mentionné, ni @everyone ni créateur", async () => {
    await announce.enqueueSessionGamePing("s", db);
    expect(await deliveries()).toHaveLength(1);
    const result = await resolveGamePing();
    if (!result.eligible || result.action.kind !== "send_channel_message") throw new Error(JSON.stringify(result));
    const { message, channelId } = result.action;
    expect(channelId).toBe("444");
    expect(message.content).toContain(`<@&${ROLE_ID}>`);
    expect(message.content).toContain("Nouvelle soirée ouverte : Coop");
    expect(message.content).not.toMatch(/@everyone|@here|<@700>|<@701>/);
    expect(message.allowedMentions).toEqual({ parse: [], roles: [ROLE_ID] });
    const { isApprovedRolePing } = await import("./notification-policy");
    expect(isApprovedRolePing(message.allowedMentions)).toBe(true);
    const event = await db.notificationEvent.findFirstOrThrow({ where: { eventType: "SESSION_GAME_PING" } });
    expect((await deliveries())[0].channel).toBe("DISCORD_CHANNEL");
    expect(event.category).toBe("SESSION");
  });

  it("jamais pour une soirée privée, sans abonné, avec plusieurs jeux ou flags éteints", async () => {
    await db.session.update({ where: { id: "s" }, data: { visibility: "PRIVATE" } });
    await announce.enqueueSessionGamePing("s", db);
    expect(await deliveries()).toHaveLength(0);
    await db.session.update({ where: { id: "s" }, data: { visibility: "APPLICATION" } });
    await db.gamePingOptIn.deleteMany({});
    await announce.enqueueSessionGamePing("s", db);
    expect(await deliveries()).toHaveLength(0);
    await db.gamePingOptIn.create({ data: { userId: "alice", communityId: "a", gameId: "g" } });
    await db.game.create({ data: { id: "g2", name: "Autre", source: "MANUAL", addedById: "host" } });
    await db.proposal.create({ data: { id: "p2", sessionId: "s", gameId: "g2", proposedById: "host" } });
    await announce.enqueueSessionGamePing("s", db);
    expect(await deliveries()).toHaveLength(0);
    await db.proposal.delete({ where: { id: "p2" } });
    vi.stubEnv("NOTIFICATION_CENTER_ENABLED", "false");
    await announce.enqueueSessionGamePing("s", db);
    vi.stubEnv("NOTIFICATION_CENTER_ENABLED", "true");
    vi.stubEnv("SESSION_VISIBILITY_ENABLED", "false");
    await announce.enqueueSessionGamePing("s", db);
    expect(await deliveries()).toHaveLength(0);
  });

  it("l'enqueue est idempotent (un seul message même rejoué)", async () => {
    await announce.enqueueSessionGamePing("s", db);
    await announce.enqueueSessionGamePing("s", db);
    expect(await deliveries()).toHaveLength(1);
    expect(await db.notificationEvent.count({ where: { eventType: "SESSION_GAME_PING" } })).toBe(1);
  });

  it("à l'envoi : rôle absent, ambigu ou sensible = aucun ping ; abonné parti, soirée devenue privée ou terminée = aucun ping", async () => {
    await announce.enqueueSessionGamePing("s", db);
    listGuildRoles.mockResolvedValue({ ok: true, data: { roles: [] } });
    expect(await resolveGamePing()).toEqual({ eligible: false, reason: "not_configured" });
    listGuildRoles.mockResolvedValue(roles([{ id: "900000000000000002", name: "coop", position: 2, permissions: "0", managed: false }]));
    expect(await resolveGamePing()).toEqual({ eligible: false, reason: "not_configured" });
    listGuildRoles.mockResolvedValue({ ok: true, data: { roles: [{ id: ROLE_ID, name: "Coop", position: 1, permissions: String(BigInt(1) << BigInt(3)), managed: false }] } });
    expect(await resolveGamePing()).toEqual({ eligible: false, reason: "not_configured" });
    listGuildRoles.mockResolvedValue({ ok: false, kind: "network", message: "x", retryable: true });
    expect(await resolveGamePing()).toEqual({ eligible: false, reason: "configuration_unavailable" });
    listGuildRoles.mockResolvedValue(roles());
    await db.session.update({ where: { id: "s" }, data: { visibility: "PRIVATE" } });
    expect(await resolveGamePing()).toEqual({ eligible: false, reason: "expired" });
    await db.session.update({ where: { id: "s" }, data: { visibility: "PUBLIC", status: "DONE" } });
    expect(await resolveGamePing()).toEqual({ eligible: false, reason: "expired" });
    await db.session.update({ where: { id: "s" }, data: { status: "VOTING" } });
    await db.gamePingOptIn.deleteMany({});
    expect(await resolveGamePing()).toEqual({ eligible: false, reason: "preference_declined" });
  });

  it("la création d'une soirée ne pingue qu'à la création : une soirée issue d'une roulette différée n'enfile rien", async () => {
    await announce.enqueueSessionCreationDeliveries("s", db, "roulette-x", "a");
    expect(await deliveries()).toHaveLength(0);
    await announce.enqueueSessionCreationDeliveries("s", db, undefined, "a");
    expect(await deliveries()).toHaveLength(1);
  });
});
