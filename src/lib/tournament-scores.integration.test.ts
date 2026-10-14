import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `declareWinner` avec scores optionnels (TOURNAMENT_SCORES_ENABLED côté action) contre
 * une vraie base Postgres isolée. Suite SKIPPÉE sans `TEST_DATABASE_URL`.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!process.env.TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn("[tournament-scores.integration.test] TEST_DATABASE_URL absente : suite SKIPPÉE, scores non validés en base.");
}

describe.skipIf(!TEST_DATABASE_URL)("declareWinner : scores (Postgres)", () => {
  let db: import("@prisma/client").PrismaClient;
  let lib: typeof import("./tournaments");

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as import("@prisma/client").PrismaClient;
    lib = await import("./tournaments");
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  beforeEach(async () => {
    await db.$executeRawUnsafe(
      `TRUNCATE "NotificationDelivery", "NotificationEvent", "TournamentMatch", "TournamentParticipant", "Tournament", "Game", "User" CASCADE`
    );
  });

  async function setup() {
    const users = await Promise.all(
      ["a", "b", "c", "d"].map((n) => db.user.create({ data: { discordId: `s-${n}`, discordName: n } }))
    );
    const game = await db.game.create({ data: { name: "g", source: "MANUAL", addedById: users[0].id } });
    const t = await db.tournament.create({
      data: { name: "t", gameId: game.id, createdById: users[0].id, status: "REGISTRATION", maxPlayers: 4, announceViaBot: false },
    });
    for (const u of users) await db.tournamentParticipant.create({ data: { tournamentId: t.id, userId: u.id } });
    await db.$transaction((tx) => lib.buildBracketInTransaction(tx, t.id));
    const match = await db.tournamentMatch.findFirstOrThrow({ where: { tournamentId: t.id, round: 1, position: 0 } });
    return { creator: users[0], match };
  }

  it("persiste les scores avec le claim", async () => {
    const { creator, match } = await setup();
    const res = await lib.declareWinner(match.id, match.player1Id!, creator.id, { score1: 7, score2: 3 });
    expect(res.ok).toBe(true);
    const after = await db.tournamentMatch.findUniqueOrThrow({ where: { id: match.id } });
    expect([after.winnerId, after.score1, after.score2]).toEqual([match.player1Id, 7, 3]);
  });

  it("sans scores : colonnes à null (comportement historique)", async () => {
    const { creator, match } = await setup();
    expect((await lib.declareWinner(match.id, match.player2Id!, creator.id)).ok).toBe(true);
    const after = await db.tournamentMatch.findUniqueOrThrow({ where: { id: match.id } });
    expect([after.score1, after.score2]).toEqual([null, null]);
  });

  it("refuse des scores incohérents sans rien écrire", async () => {
    const { creator, match } = await setup();
    const res = await lib.declareWinner(match.id, match.player1Id!, creator.id, { score1: 1, score2: 4 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/gagnant/);
    const after = await db.tournamentMatch.findUniqueOrThrow({ where: { id: match.id } });
    expect([after.winnerId, after.completedAt, after.score1]).toEqual([null, null, null]);
  });

  it("idempotence : un match déjà tranché n'est pas réécrit", async () => {
    const { creator, match } = await setup();
    await lib.declareWinner(match.id, match.player1Id!, creator.id, { score1: 7, score2: 3 });
    const again = await lib.declareWinner(match.id, match.player2Id!, creator.id, { score1: 0, score2: 9 });
    expect(again.ok).toBe(false);
    const after = await db.tournamentMatch.findUniqueOrThrow({ where: { id: match.id } });
    expect([after.winnerId, after.score1, after.score2]).toEqual([match.player1Id, 7, 3]);
  });
});
