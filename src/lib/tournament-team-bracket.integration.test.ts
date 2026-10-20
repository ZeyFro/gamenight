import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { awardXp, postToCommunity } = vi.hoisted(() => ({ awardXp: vi.fn(), postToCommunity: vi.fn() }));
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: process.env.TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL }) : {} };
});
vi.mock("@/lib/xp-actions", () => ({ awardXp }));
vi.mock("@/lib/community-announce", () => ({ postToCommunity }));
vi.mock("@/lib/badges", () => ({ checkTournamentBadges: vi.fn() }));
vi.mock("@/lib/thread-close-on-end", () => ({ closeThreadOnEndSafely: vi.fn() }));

describe.skipIf(!TEST_DATABASE_URL)("tournois en équipes (Postgres)", () => {
  let db: import("@prisma/client").PrismaClient;
  let lib: typeof import("./tournaments");

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as import("@prisma/client").PrismaClient;
    lib = await import("./tournaments");
  });
  afterAll(async () => db.$disconnect());
  beforeEach(async () => {
    awardXp.mockReset();
    postToCommunity.mockReset().mockResolvedValue({ ok: true });
    await db.$executeRawUnsafe(
      `TRUNCATE "NotificationDelivery", "NotificationEvent", "TournamentMatch", "TournamentTeamMember", "TournamentTeam", "TournamentParticipant", "Tournament", "Game", "User" CASCADE`
    );
  });

  it("fige les duos, joue la finale par équipe et récompense les deux membres", async () => {
    const users = await Promise.all(
      ["a", "b", "c", "d", "outsider"].map((name) => db.user.create({ data: { discordId: `team-${name}`, discordName: name } }))
    );
    const game = await db.game.create({ data: { name: "g", source: "MANUAL", addedById: users[0].id } });
    const tournament = await db.tournament.create({
      data: { name: "équipes", gameId: game.id, createdById: users[0].id, maxPlayers: 4, format: "TEAMS" },
    });
    for (const user of users.slice(0, 4)) await db.tournamentParticipant.create({ data: { tournamentId: tournament.id, userId: user.id } });

    await db.$transaction((tx) => lib.buildBracketInTransaction(tx, tournament.id));
    const teams = await db.tournamentTeam.findMany({ where: { tournamentId: tournament.id }, include: { members: true } });
    const match = await db.tournamentMatch.findFirstOrThrow({ where: { tournamentId: tournament.id } });
    expect(teams).toHaveLength(2);
    expect(teams.map((team) => team.members.length)).toEqual([2, 2]);
    expect([match.team1Id, match.team2Id].sort()).toEqual(teams.map((team) => team.id).sort());

    const winner = teams.find((team) => team.id === match.team1Id)!;
    const loser = teams.find((team) => team.id === match.team2Id)!;
    expect((await lib.declareWinner(match.id, winner.id, users[4].id)).ok).toBe(false);
    const result = await lib.declareWinner(match.id, winner.id, winner.members[0].userId);

    expect(result).toEqual({ ok: true, tournamentDone: true });
    const finished = await db.tournament.findUniqueOrThrow({ where: { id: tournament.id } });
    expect([finished.championTeamId, finished.championId]).toEqual([winner.id, null]);
    expect((await db.tournamentParticipant.findMany({ where: { tournamentId: tournament.id, eliminatedAt: { not: null } } })).map((p) => p.userId).sort())
      .toEqual(loser.members.map((member) => member.userId).sort());
    expect(awardXp).toHaveBeenCalledTimes(4);
    expect(awardXp.mock.calls.map(([userId, , , , amount]) => [userId, amount]).sort(([a], [b]) => String(a).localeCompare(String(b)))).toEqual(
      teams.flatMap((team) => team.members.map((member) => [member.userId, team.id === winner.id ? 200 : 100]))
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    );
  });

  it("résout le bye d'un tournoi à trois équipes", async () => {
    const users = await Promise.all(
      ["a", "b", "c", "d", "e", "f"].map((name) => db.user.create({ data: { discordId: `bye-${name}`, discordName: name } }))
    );
    const game = await db.game.create({ data: { name: "g", source: "MANUAL", addedById: users[0].id } });
    const tournament = await db.tournament.create({
      data: { name: "bye équipes", gameId: game.id, createdById: users[0].id, maxPlayers: 6, format: "TEAMS" },
    });
    for (const user of users) await db.tournamentParticipant.create({ data: { tournamentId: tournament.id, userId: user.id } });

    await db.$transaction((tx) => lib.buildBracketInTransaction(tx, tournament.id));
    const teams = await db.tournamentTeam.findMany({ where: { tournamentId: tournament.id }, include: { members: true } });
    const firstRound = await db.tournamentMatch.findMany({ where: { tournamentId: tournament.id, round: 1 } });
    const byeMatch = firstRound.find((match) => !match.team1Id || !match.team2Id)!;
    const byeTeamId = byeMatch.team1Id ?? byeMatch.team2Id!;
    const playedMatch = firstRound.find((match) => match.team1Id && match.team2Id)!;
    expect(teams).toHaveLength(3);
    expect(byeMatch.winnerTeamId).toBe(byeTeamId);

    const firstRoundWinnerId = playedMatch.team1Id!;
    const firstRoundWinner = teams.find((team) => team.id === firstRoundWinnerId)!;
    expect((await lib.declareWinner(playedMatch.id, firstRoundWinnerId, firstRoundWinner.members[0].userId)).tournamentDone).toBe(false);
    let final = await db.tournamentMatch.findFirstOrThrow({ where: { tournamentId: tournament.id, round: 2 } });
    expect([final.team1Id, final.team2Id].sort()).toEqual([byeTeamId, firstRoundWinnerId].sort());

    const championId = final.team1Id!;
    const champion = teams.find((team) => team.id === championId)!;
    expect(await lib.declareWinner(final.id, championId, champion.members[0].userId)).toEqual({ ok: true, tournamentDone: true });
    final = await db.tournamentMatch.findFirstOrThrow({ where: { id: final.id } });
    expect(final.winnerTeamId).toBe(championId);
    expect(awardXp).toHaveBeenCalledTimes(6);
    const runnerUpId = final.team1Id === championId ? final.team2Id : final.team1Id;
    expect(awardXp.mock.calls.map(([userId]) => userId).sort()).toEqual(
      teams.flatMap((team) => team.members.map((member) => member.userId))
        .sort(),
    );
    expect(awardXp.mock.calls.map(([userId, , , , amount]) => [userId, amount]).sort(([a], [b]) => String(a).localeCompare(String(b)))).toEqual(
      teams.flatMap((team) => team.members.map((member) => [member.userId, team.id === championId ? 200 : team.id === runnerUpId ? 100 : 50]))
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    );
  });
});
