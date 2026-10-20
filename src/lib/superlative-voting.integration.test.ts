import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (TEST_DATABASE_URL) {
    const destination = new URL(TEST_DATABASE_URL);
    if (!["postgres:", "postgresql:"].includes(destination.protocol) ||
      destination.hostname !== "127.0.0.1" || !["55439", "55443"].includes(destination.port) ||
      destination.pathname !== "/gamenight_test") {
      throw new Error("Finalisation MVP : PostgreSQL de test dédié 127.0.0.1:55439/gamenight_test uniquement.");
    }
  }
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

// Seul le transport Discord est simulé : votes, awards, XP, stats et notifications restent réels.
vi.mock("@/lib/discord-session-awards", () => ({ announceSessionAwards: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/discord-level-up", () => ({ announceLevelUp: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/web-push-delivery", () => ({ sendUserWebPush: vi.fn().mockResolvedValue(undefined) }));

if (!TEST_DATABASE_URL) console.warn("[superlative-voting] PostgreSQL local absent : finalisation MVP SKIPPÉE.");

describe.skipIf(!TEST_DATABASE_URL)("finalisation réelle des récompenses multicatégories", () => {
  let db: import("@prisma/client").PrismaClient;
  let voting: typeof import("./superlative-voting");
  const communityId = "mvp-community";
  const sessionId = "mvp-session";
  const players = ["alice", "bob", "charlie", "dana"];
  const categories = [
    { id: "mvp-category", icon: "🏆", name: "MVP de la soirée", xpReward: 13 },
    { id: "fun-category", icon: "😂", name: "Le plus drôle", xpReward: 29 },
  ];

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma;
    voting = await import("./superlative-voting");
  });

  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    vi.stubEnv("WEB_PUSH_ENABLED", "false");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Aucun réseau autorisé dans ce test MVP."); }));
    await db.$executeRawUnsafe('TRUNCATE "User", "Community", "Game", "Badge", "SuperlativeCategory" CASCADE');
    (await import("./default-community")).resetDefaultCommunityIdCache();
    await db.community.createMany({ data: [
      { id: "mvp-default", slug: "default", name: "Default", status: "ACTIVE" },
      { id: communityId, slug: "mvp-server", name: "Serveur MVP", status: "ACTIVE" },
    ] });
    await db.user.createMany({ data: players.map(id => ({ id, discordId: `mvp-${id}`, discordName: id })) });
    await db.membership.createMany({ data: players.map(userId => ({ communityId, userId, status: "ACTIVE" })) });
    await db.communityMemberStats.createMany({ data: players.map(userId => ({ communityId, userId })) });
    await db.game.create({ data: { id: "mvp-game", name: "Jeu coop", source: "MANUAL", addedById: "alice" } });
    await db.superlativeCategory.createMany({ data: categories.map(category => ({ ...category, modifiedById: "alice" })) });
    await db.session.create({ data: {
      id: sessionId, communityId, createdById: "alice", status: "DONE", decidedGameId: "mvp-game",
      date: new Date("2026-10-18T20:00:00.000Z"), superlativeVotingDeadline: new Date(0),
      attendanceCapacity: players.length,
      seats: { create: players.map(userId => ({ userId, status: "CONFIRMED" })) },
      proposals: { create: { gameId: "mvp-game", proposedById: "alice" } },
    } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  afterAll(async () => { await db?.$disconnect(); });

  it.each([
    { label: "deux gagnants distincts via clôture forcée", funWinner: "bob", force: true },
    { label: "un même gagnant dans deux catégories à l'échéance", funWinner: "alice", force: false },
  ])("récompense $label une fois, avec une source XP par catégorie", async ({ funWinner, force }) => {
    await db.superlativeVote.createMany({ data: ["charlie", "dana"].flatMap(voterUserId => [
      { sessionId, categoryId: "mvp-category", voterUserId, votedForUserId: "alice" },
      { sessionId, categoryId: "fun-category", voterUserId, votedForUserId: funWinner },
    ]) });

    const finalize = force ? voting.forceFinalizeSuperlativeVoting : voting.finalizeSuperlativeVotingIfDue;
    await finalize(sessionId);
    await finalize(sessionId); // Rafraîchir ou recliquer ne doit ni repayer ni renotifier.

    expect(await db.session.findUniqueOrThrow({ where: { id: sessionId }, select: { superlativeVotingClosed: true } }))
      .toEqual({ superlativeVotingClosed: true });
    expect(await db.superlativeAward.findMany({ where: { sessionId }, orderBy: { categoryId: "asc" },
      select: { communityId: true, categoryId: true, winnerUserId: true, voteCount: true, gameName: true },
    })).toEqual([
      { communityId, categoryId: "fun-category", winnerUserId: funWinner, voteCount: 2, gameName: "Jeu coop" },
      { communityId, categoryId: "mvp-category", winnerUserId: "alice", voteCount: 2, gameName: "Jeu coop" },
    ]);
    expect(await db.xpEvent.findMany({ orderBy: { sourceId: "asc" },
      select: { communityId: true, userId: true, reason: true, sourceId: true, amount: true },
    })).toEqual([
      { communityId, userId: funWinner, reason: "SUPERLATIVE_AWARD", sourceId: `${sessionId}:fun-category`, amount: 29 },
      { communityId, userId: "alice", reason: "SUPERLATIVE_AWARD", sourceId: `${sessionId}:mvp-category`, amount: 13 },
    ]);
    expect(await db.communityMemberStats.findMany({ where: { communityId }, orderBy: { userId: "asc" }, select: { userId: true, xpTotal: true } }))
      .toEqual(players.map(userId => ({ userId, xpTotal: (userId === "alice" ? 13 : 0) + (userId === funWinner ? 29 : 0) })));
    expect(await db.notification.count({ where: { communityId, relatedSessionId: sessionId, type: "SUPERLATIVE_AWARD" } })).toBe(2);
    expect(await db.xpEvent.count({ where: { communityId: "mvp-default" } })).toBe(0);
  });

  it("finalise une seule fois quand deux lectures déclenchent la clôture simultanément", async () => {
    await db.superlativeVote.createMany({ data: ["charlie", "dana"].flatMap(voterUserId => [
      { sessionId, categoryId: "mvp-category", voterUserId, votedForUserId: "alice" },
      { sessionId, categoryId: "fun-category", voterUserId, votedForUserId: "bob" },
    ]) });

    await expect(Promise.all([
      voting.forceFinalizeSuperlativeVoting(sessionId),
      voting.forceFinalizeSuperlativeVoting(sessionId),
    ])).resolves.toBeDefined();

    expect(await db.superlativeAward.count({ where: { sessionId } })).toBe(2);
    expect(await db.xpEvent.count({ where: { communityId, reason: "SUPERLATIVE_AWARD" } })).toBe(2);
    expect(await db.notification.count({ where: { communityId, relatedSessionId: sessionId, type: "SUPERLATIVE_AWARD" } })).toBe(2);
    expect(await db.session.findUniqueOrThrow({ where: { id: sessionId }, select: { superlativeVotingClosed: true } }))
      .toEqual({ superlativeVotingClosed: true });
  });

  it("départage les ex-aequo sans créer plusieurs awards ni crédits pour une catégorie", async () => {
    await db.superlativeVote.createMany({ data: categories.flatMap(({ id: categoryId }) => [
      { sessionId, categoryId, voterUserId: "charlie", votedForUserId: "alice" },
      { sessionId, categoryId, voterUserId: "dana", votedForUserId: "bob" },
    ]) });

    await voting.forceFinalizeSuperlativeVoting(sessionId);

    const awards = await db.superlativeAward.findMany({ where: { sessionId } });
    expect(awards).toHaveLength(2);
    for (const category of categories) {
      const award = awards.find(row => row.categoryId === category.id);
      expect(award).toMatchObject({ voteCount: 1, communityId });
      expect(["alice", "bob"]).toContain(award?.winnerUserId);
      expect(await db.xpEvent.findMany({ where: { sourceId: `${sessionId}:${category.id}` }, select: { userId: true, amount: true } }))
        .toEqual([{ userId: award!.winnerUserId, amount: category.xpReward }]);
    }
    expect(await db.xpEvent.count()).toBe(2);
  });
});
