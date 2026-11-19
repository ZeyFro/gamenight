import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: process.env.TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL }) : {} };
});
vi.mock("@/lib/xp-actions", () => ({ awardXp: vi.fn() }));
vi.mock("@/lib/community-announce", () => ({ postToCommunity: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock("@/lib/badges", () => ({ checkTournamentBadges: vi.fn() }));
vi.mock("@/lib/thread-close-on-end", () => ({ closeThreadOnEndSafely: vi.fn() }));
if (!TEST_DATABASE_URL) console.warn("[game-levels-matchmaking] TEST_DATABASE_URL absente : tests PostgreSQL SKIPPÉS, appariement par niveau NON validé sur SQL réel.");

describe.skipIf(!TEST_DATABASE_URL)("niveau par jeu : appariement de tournoi (Postgres)", () => {
  let db: import("@prisma/client").PrismaClient;
  let lib: typeof import("./tournaments");
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    lib = await import("./tournaments");
  });
  afterAll(async () => { await db?.$disconnect(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.stubEnv("GAME_LEVELS_ENABLED", "true");
    vi.stubEnv("GAME_LEVELS_MATCHMAKING_ENABLED", "true");
    await db.$executeRawUnsafe(`TRUNCATE "UserGameLevel", "TournamentMatch", "TournamentTeamMember", "TournamentTeam", "TournamentParticipant", "Tournament", "Game", "User" CASCADE`);
    for (const name of ["pro", "good", "mid", "newbie"]) ids[name] = (await db.user.create({ data: { discordId: `lvl-${name}`, discordName: name } })).id;
    ids.game = (await db.game.create({ data: { name: "Deadlock", source: "MANUAL", addedById: ids.pro } })).id;
    ids.other = (await db.game.create({ data: { name: "Autre", source: "MANUAL", addedById: ids.pro } })).id;
    ids.tournament = (await db.tournament.create({ data: { name: "duos", gameId: ids.game, createdById: ids.pro, maxPlayers: 4, format: "TEAMS" } })).id;
    for (const name of ["pro", "good", "mid", "newbie"]) await db.tournamentParticipant.create({ data: { tournamentId: ids.tournament, userId: ids[name] } });
  });

  async function teamsByName() {
    const teams = await db.tournamentTeam.findMany({ where: { tournamentId: ids.tournament }, include: { members: { include: { participant: { include: { user: true } } } } } });
    return teams.map(team => team.members.map(member => member.participant.user.discordName).sort()).sort();
  }

  it("apparie le plus fort avec le plus faible selon le niveau du jeu du tournoi", async () => {
    await db.userGameLevel.createMany({ data: [
      { userId: ids.pro, gameId: ids.game, level: "EXPERT" }, { userId: ids.good, gameId: ids.game, level: "AVANCE" },
      { userId: ids.mid, gameId: ids.game, level: "INTERMEDIAIRE" }, { userId: ids.newbie, gameId: ids.game, level: "DEBUTANT" },
      // Un niveau sur un autre jeu ne compte pas.
      { userId: ids.newbie, gameId: ids.other, level: "EXPERT" },
    ] });
    await db.$transaction((tx) => lib.buildBracketInTransaction(tx, ids.tournament));
    expect(await teamsByName()).toEqual([["good", "mid"], ["newbie", "pro"]]);
  });

  it("flag éteint ou aucun niveau : appariement aléatoire inchangé (2 équipes de 2)", async () => {
    await db.$transaction((tx) => lib.buildBracketInTransaction(tx, ids.tournament));
    const teams = await teamsByName();
    expect(teams).toHaveLength(2);
    expect(teams.every(team => team.length === 2)).toBe(true);
  });

  it("un profil masqué n'influence pas l'appariement", async () => {
    vi.stubEnv("PROFILE_VISIBILITY_ENABLED", "true");
    await db.userProfileVisibility.create({ data: { userId: ids.pro, visibility: "HIDDEN" } });
    await db.userGameLevel.createMany({ data: [
      { userId: ids.pro, gameId: ids.game, level: "EXPERT" }, { userId: ids.newbie, gameId: ids.game, level: "DEBUTANT" },
    ] });
    const { loadGameLevels } = await import("./game-levels-matchmaking");
    const levels = await loadGameLevels([ids.pro, ids.newbie], ids.game);
    expect([...levels.keys()]).toEqual([ids.newbie]);
  });
});
