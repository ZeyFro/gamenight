import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (TEST_DATABASE_URL && new URL(TEST_DATABASE_URL).hostname !== "127.0.0.1") throw new Error("Postgres local uniquement");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
if (!TEST_DATABASE_URL) console.warn("[tournament-predictions] Postgres local absent : tests SKIPPÉS.");

describe.skipIf(!TEST_DATABASE_URL)("pronostics tournoi : droits, clôture et concurrence", () => {
  let db: import("@prisma/client").PrismaClient;
  let submit: typeof import("./tournament-predictions").submitTournamentPrediction;
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma;
    submit = (await import("./tournament-predictions")).submitTournamentPrediction;
  });
  afterAll(async () => { await db?.$disconnect(); });
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(async () => {
    vi.stubEnv("TOURNAMENT_PREDICTIONS_ENABLED", "true");
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    await db.$executeRawUnsafe('TRUNCATE "User", "Community", "Game" CASCADE');
    (await import("./default-community")).resetDefaultCommunityIdCache();
    for (const c of ["a", "b"]) ids[c] = (await db.community.create({ data: { slug: c, name: c, status: "ACTIVE" } })).id;
    for (const name of ["alice", "bob", "outsider"]) ids[name] = (await db.user.create({ data: { discordId: name, discordName: name } })).id;
    for (const name of ["alice", "bob"]) await db.membership.create({ data: { communityId: ids.a, userId: ids[name] } });
    await db.membership.create({ data: { communityId: ids.b, userId: ids.outsider } });
    ids.game = (await db.game.create({ data: { name: "Jeu", source: "MANUAL", addedById: ids.alice } })).id;
    ids.tournament = (await db.tournament.create({ data: { name: "Tournoi", communityId: ids.a, createdById: ids.alice, gameId: ids.game, maxPlayers: 4, participants: { create: [{ userId: ids.alice }, { userId: ids.bob }] } } })).id;
    ids.match = (await db.tournamentMatch.create({ data: { tournamentId: ids.tournament, round: 1, position: 0, player1Id: ids.alice, player2Id: ids.bob } })).id;
  });
  it("un seul choix immuable même sous soumissions concurrentes", async () => {
    const results = await Promise.all([submit(ids.alice, ids.tournament, "champion", ids.bob), submit(ids.alice, ids.tournament, "champion", ids.alice)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await db.tournamentPrediction.count()).toBe(1);
    expect(await submit(ids.alice, ids.tournament, "champion", ids.outsider)).toBe(false);
  });
  it("refuse étrangers, membres sortis, serveur suspendu et flag éteint", async () => {
    expect(await submit(ids.outsider, ids.tournament, "champion", ids.alice)).toBe(false);
    await db.membership.update({ where: { communityId_userId: { communityId: ids.a, userId: ids.alice } }, data: { status: "LEFT" } });
    expect(await submit(ids.alice, ids.tournament, "champion", ids.bob)).toBe(false);
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    expect(await submit(ids.alice, ids.tournament, "champion", ids.bob)).toBe(false);
    await db.community.update({ where: { id: ids.a }, data: { status: "PENDING" } });
    expect(await submit(ids.bob, ids.tournament, "champion", ids.bob)).toBe(false);
    vi.stubEnv("TOURNAMENT_PREDICTIONS_ENABLED", "false");
    expect(await submit(ids.bob, ids.tournament, "champion", ids.bob)).toBe(false);
    expect(await db.tournamentPrediction.count()).toBe(0);
  });
  it("refuse le champion après lancement et les matchs fermés ou étrangers", async () => {
    await db.tournament.update({ where: { id: ids.tournament }, data: { status: "IN_PROGRESS" } });
    expect(await submit(ids.alice, ids.tournament, "champion", ids.bob)).toBe(false);
    expect(await submit(ids.alice, ids.tournament, ids.match, ids.bob)).toBe(true);
    expect(await submit(ids.bob, ids.tournament, "absent", ids.alice)).toBe(false);
    await db.tournamentMatch.update({ where: { id: ids.match }, data: { winnerId: ids.bob, completedAt: new Date() } });
    expect(await submit(ids.bob, ids.tournament, ids.match, ids.alice)).toBe(false);
    await db.tournament.update({ where: { id: ids.tournament }, data: { status: "CANCELLED" } });
    expect(await submit(ids.bob, ids.tournament, ids.match, ids.bob)).toBe(false);
  });
  it("relit le lancement après attente du verrou de tournoi", async () => {
    let locked!: () => void;
    const ready = new Promise<void>(resolve => { locked = resolve; });
    let release!: () => void;
    const proceed = new Promise<void>(resolve => { release = resolve; });
    const launch = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Tournament" WHERE id = ${ids.tournament} FOR UPDATE`;
      locked();
      await proceed;
      await tx.tournament.update({ where: { id: ids.tournament }, data: { status: "IN_PROGRESS" } });
    });
    await ready;
    const prediction = submit(ids.alice, ids.tournament, "champion", ids.bob);
    release();
    await launch;
    expect(await prediction).toBe(false);
    expect(await db.tournamentPrediction.count()).toBe(0);
  });
  it("ne prend pas un match appartenant à un autre tournoi", async () => {
    const foreign = await db.tournament.create({ data: { name: "Autre", communityId: ids.b, createdById: ids.outsider, gameId: ids.game, maxPlayers: 4, status: "IN_PROGRESS" } });
    const match = await db.tournamentMatch.create({ data: { tournamentId: foreign.id, round: 1, position: 0, player1Id: ids.alice, player2Id: ids.bob } });
    await db.tournament.update({ where: { id: ids.tournament }, data: { status: "IN_PROGRESS" } });
    expect(await submit(ids.alice, ids.tournament, match.id, ids.bob)).toBe(false);
  });
  it("relit un résultat concurrent avant d'accepter un pronostic de match", async () => {
    await db.tournament.update({ where: { id: ids.tournament }, data: { status: "IN_PROGRESS" } });
    let locked!: () => void;
    const ready = new Promise<void>(resolve => { locked = resolve; });
    let release!: () => void;
    const proceed = new Promise<void>(resolve => { release = resolve; });
    const resolution = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "TournamentMatch" WHERE id = ${ids.match} FOR UPDATE`;
      locked();
      await proceed;
      await tx.tournamentMatch.update({ where: { id: ids.match }, data: { winnerId: ids.bob, completedAt: new Date() } });
    });
    await ready;
    const prediction = submit(ids.alice, ids.tournament, ids.match, ids.bob);
    release();
    await resolution;
    expect(await prediction).toBe(false);
    expect(await db.tournamentPrediction.count()).toBe(0);
  });
});
