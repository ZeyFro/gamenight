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
vi.mock("@/lib/prisma", async () => {
  if (url) testDatabaseGuard(url);
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: url ? new PrismaClient({ datasourceUrl: url }) : {} };
});
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/notification-executor-kick", () => ({ kickNotificationExecutor: vi.fn() }));
if (!url) console.warn("[tower-discord-votes] Postgres absent : intégrations ignorées.");

const guildId = "987654321098765431";
const proofChannelId = "123456789012345671";
const communityId = "dv-community";
const users = ["dv-author", "dv-old", "dv-new", "dv-other"];
const attemptId = "dv-attempt";
const proofSlot = guildId + ":TOWER:" + attemptId + ":proof";

describe.skipIf(!url)("votes Discord des preuves Tower", () => {
  let db: import("@prisma/client").PrismaClient;
  let api: typeof import("./tower-challenges");
  const vote = (userId: string, approve: boolean) => api.voteTowerChallenge({ communityId, userId, attemptId, approve });
  const edits = () => db.notificationDelivery.findMany({ where: { targetSlot: proofSlot, operation: "EDIT" } });

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    api = await import("./tower-challenges");
    vi.spyOn(Date, "now").mockImplementation(() => clock.now.getTime());
  });
  afterAll(async () => { await db?.$disconnect(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    clock.now = new Date("2026-12-10T12:00:00Z");
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    vi.stubEnv("TOWER_DISCORD_ANNOUNCE_ENABLED", "true");
    vi.stubEnv("TOWER_DISCORD_VOTES_ENABLED", "true");
    vi.stubEnv("TOWER_DISCORD_GUILD_ID", guildId);
    vi.stubEnv("TOWER_DISCORD_CHANNEL_ID", proofChannelId);
    vi.stubEnv("TOWER_DISCORD_GENERAL_CHANNEL_ID", proofChannelId);
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    await db.notificationEvent.deleteMany({ where: { communityId } });
    await db.towerChallengeAttempt.deleteMany({ where: { communityId } });
    await db.towerChallengeDefinition.deleteMany({ where: { communityId } });
    await db.membership.deleteMany({ where: { communityId } });
    await db.community.deleteMany({ where: { id: communityId } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.community.create({ data: { id: communityId, slug: communityId, name: communityId, status: "ACTIVE", towerChallengesEnabled: true, discordGuildId: guildId } });
    await db.user.createMany({ data: users.map(id => ({ id, discordId: id, discordName: id })) });
    const old = new Date("2026-11-01T00:00:00Z");
    await db.membership.createMany({ data: users.map(userId => ({
      communityId, userId, status: "ACTIVE" as const, joinedAt: userId === "dv-new" ? new Date("2026-12-08T00:00:00Z") : old,
    })) });
    await db.towerChallengeDefinition.create({ data: { id: "dv-def", communityId, title: "Défi", instructions: "À faire", rewardFloors: 1, active: true } });
    await db.towerChallengeAttempt.create({ data: {
      id: attemptId, communityId, userId: "dv-author", definitionId: "dv-def", requestKey: "dv-request-key-0001", title: "Défi", instructions: "À faire",
      rewardFloors: 1, assignedAt: new Date("2026-12-10T08:00:00Z"), expiresAt: new Date("2026-12-12T08:00:00Z"), status: "SUBMITTED",
      submittedAt: new Date("2026-12-10T10:00:00Z"), proofText: "Preuve TWR", proofChannelId, proofMessageId: "223456789012345671", publicationConsent: true,
    } });
    const event = await db.notificationEvent.create({ data: { communityId, category: "ACHIEVEMENT", eventType: "TOWER_PROOF_SUBMITTED", sourceId: attemptId } });
    await db.notificationDelivery.create({ data: {
      eventId: event.id, channel: "DISCORD_CHANNEL", transport: "BOT", operation: "SEND", status: "SENT", sentAt: clock.now,
      recipientKey: proofChannelId, discordChannelId: proofChannelId, discordMessageId: "323456789012345671", targetSlot: proofSlot,
    } });
  });

  it("refuse un votant de moins de 3 jours et laisse l'auteur sans vote", async () => {
    expect((await vote("dv-new", true)).status).toBe("VOTER_TOO_RECENT");
    expect((await vote("dv-author", true)).status).toBe("SELF_VOTE");
    expect(await db.towerChallengeVote.count({ where: { attemptId } })).toBe(0);
    expect(await edits()).toHaveLength(0);
  });

  it("enregistre un vote, le laisse modifiable jusqu'à l'échéance et met à jour le message public via la file", async () => {
    expect((await vote("dv-old", true)).status).toBe("VOTED");
    clock.now = new Date("2026-12-10T13:00:00Z");
    expect((await vote("dv-old", false)).status).toBe("VOTE_CHANGED");
    expect((await vote("dv-old", false)).status).toBe("VOTED");
    const rows = await db.towerChallengeVote.findMany({ where: { attemptId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: "dv-old", approve: false, createdAt: new Date("2026-12-10T12:00:00Z") });
    const queued = await edits();
    expect(queued.length).toBeGreaterThanOrEqual(2);
    expect(queued.every(delivery => delivery.recipientKey === proofChannelId && delivery.status === "PENDING")).toBe(true);
  });

  it("ferme les votes après l'échéance de 24 h sans quorum prolongé et ne touche pas le vote existant", async () => {
    expect((await vote("dv-old", true)).status).toBe("VOTED");
    clock.now = new Date("2026-12-12T10:00:00Z");
    expect((await vote("dv-old", false)).status).toBe("CLOSED");
    expect((await db.towerChallengeVote.findFirstOrThrow({ where: { attemptId } })).approve).toBe(true);
  });

  it("n'envoie aucune édition quand l'annonce publique n'existe pas", async () => {
    await db.notificationDelivery.deleteMany({ where: { targetSlot: proofSlot } });
    expect((await vote("dv-old", true)).status).toBe("VOTED");
    expect(await edits()).toHaveLength(0);
  });

  it("drapeau éteint : un vote par personne, non modifiable, sans édition de message", async () => {
    vi.stubEnv("TOWER_DISCORD_VOTES_ENABLED", "false");
    expect((await vote("dv-old", true)).status).toBe("VOTED");
    expect((await vote("dv-old", false)).status).toBe("ALREADY_VOTED");
    expect(await edits()).toHaveLength(0);
  });

  it("l'ancienneté de 3 jours s'applique AUSSI drapeau éteint (audit 23/11/2026, constat 1.3)", async () => {
    vi.stubEnv("TOWER_DISCORD_VOTES_ENABLED", "false");
    expect((await vote("dv-new", true)).status).toBe("VOTER_TOO_RECENT");
    expect(await db.towerChallengeVote.count({ where: { attemptId, userId: "dv-new" } })).toBe(0);
    expect((await vote("dv-old", true)).status).toBe("VOTED");
  });

  it("ouvre un fil par preuve à la soumission, une seule fois par rang de resoumission", async () => {
    const { enqueueTowerChallengeEvent } = await import("./tower-challenge-announcements");
    await db.$transaction(async tx => {
      await enqueueTowerChallengeEvent(tx, communityId, attemptId, "proof");
      await enqueueTowerChallengeEvent(tx, communityId, attemptId, "proof");
    });
    const threads = await db.notificationDelivery.findMany({ where: { targetSlot: guildId + ":TOWER:" + attemptId + ":proof-thread" } });
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ operation: "SEND", recipientKey: proofChannelId });
  });
});
