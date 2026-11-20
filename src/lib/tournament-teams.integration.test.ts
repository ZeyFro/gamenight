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
if (!TEST_DATABASE_URL) console.warn("[tournament-teams] TEST_DATABASE_URL absente : tests PostgreSQL SKIPPÉS, tournois d'équipes NON validés sur SQL réel.");

describe.skipIf(!TEST_DATABASE_URL)("tournois par équipes inscrites : PostgreSQL isolé", () => {
  let db: import("@prisma/client").PrismaClient;
  let tt: typeof import("./tournament-teams");
  let read: typeof import("./tournament-teams-read");
  let teams: typeof import("./community-teams");
  let tournaments: typeof import("./tournaments");
  let registration: typeof import("./tournament-registration");
  const ids: Record<string, string> = {};
  const H = 3600_000;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    tt = await import("./tournament-teams");
    read = await import("./tournament-teams-read");
    teams = await import("./community-teams");
    tournaments = await import("./tournaments");
    registration = await import("./tournament-registration");
  });
  afterAll(async () => { await db?.$disconnect(); vi.unstubAllEnvs(); });

  beforeEach(async () => {
    awardXp.mockReset();
    postToCommunity.mockReset().mockResolvedValue({ ok: true });
    vi.stubEnv("TOURNAMENT_TEAMS_ENABLED", "true");
    vi.stubEnv("TOURNAMENT_SCORES_ENABLED", "");
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "");
    await db.$executeRawUnsafe(
      `TRUNCATE "NotificationDelivery", "NotificationEvent", "TournamentMatchReport", "TournamentTeamEntry", "TournamentTeamSettings", "TournamentMatch", "TournamentTeamMember", "TournamentTeam", "TournamentParticipant", "Tournament", "CommunityTeamMember", "CommunityTeam", "Membership", "Game", "User", "Community" CASCADE`
    );
    ids.community = (await db.community.create({ data: { slug: "tower-tt", name: "The Tower", status: "ACTIVE", communityTeamsEnabled: true } })).id;
    for (const name of ["org", "a1", "a2", "b1", "b2", "c1", "c2", "d1", "d2", "outsider"]) {
      ids[name] = (await db.user.create({ data: { discordId: `tt-${name}`, discordName: name } })).id;
      await db.membership.create({ data: { userId: ids[name], communityId: ids.community, status: "ACTIVE", joinedAt: new Date() } });
    }
    ids.game = (await db.game.create({ data: { name: "Deadlock", source: "MANUAL", addedById: ids.org } })).id;
    for (const [letter, captain, member] of [["A", "a1", "a2"], ["B", "b1", "b2"], ["C", "c1", "c2"], ["D", "d1", "d2"]]) {
      await teams.createCommunityTeam({ userId: ids[captain], communityId: ids.community, gameId: ids.game, name: `Équipe ${letter}`, description: "Une équipe de tournoi sérieuse.", platform: "PC", maxMembers: 4 });
      ids[`team${letter}`] = (await db.communityTeam.findFirstOrThrow({ where: { name: `Équipe ${letter}` } })).id;
      await teams.joinCommunityTeam(ids[member], ids.community, ids[`team${letter}`]);
    }
  });

  const create = async (maxTeams: number, extra: Partial<{ isPrivate: boolean; registrationClosesAt: Date | null }> = {}) => {
    const created = await tt.createTeamTournament(ids.org, ids.community, { name: "Coupe Deadlock", gameId: ids.game, maxTeams, isPrivate: false, registrationClosesAt: null, ...extra });
    if (created.result !== "created") throw new Error(created.result);
    ids.tournament = created.tournamentId;
    return created.tournamentId;
  };
  const enter = (letter: string, captain: string) => tt.enterTeamInTournament(ids[captain], ids.community, { tournamentId: ids.tournament, teamId: ids[`team${letter}`] });
  const finalMatch = () => db.tournamentMatch.findFirstOrThrow({ where: { tournamentId: ids.tournament }, orderBy: { round: "desc" } });

  it("est inactif sans le drapeau et n'écrit rien", async () => {
    vi.stubEnv("TOURNAMENT_TEAMS_ENABLED", "false");
    expect(await tt.createTeamTournament(ids.org, ids.community, { name: "Coupe", gameId: ids.game, maxTeams: 2, isPrivate: false, registrationClosesAt: null })).toEqual({ result: "unavailable" });
    expect(await db.tournamentTeamSettings.count()).toBe(0);
  });

  it("deux équipes : lancement à la dernière place, confirmation par les deux capitaines, victoire et XP existants", async () => {
    await create(2);
    expect(await enter("A", "a2")).toBe("forbidden");
    expect(await enter("A", "a1")).toBe("registered");
    expect(await enter("A", "a1")).toBe("already");
    expect(await enter("B", "b1")).toBe("launched");
    expect(await enter("C", "c1")).toBe("closed");
    const match = await finalMatch();
    expect(match.team1Id && match.team2Id).toBeTruthy();
    expect(await db.tournamentParticipant.count({ where: { tournamentId: ids.tournament } })).toBe(4);
    expect(await db.tournament.findUniqueOrThrow({ where: { id: ids.tournament } })).toMatchObject({ status: "IN_PROGRESS", format: "TEAMS" });

    // Ni déclaration unilatérale, ni inscription individuelle.
    expect((await tournaments.declareWinner(match.id, match.team1Id!, ids.org)).ok).toBe(false);
    expect(await registration.registerTournamentParticipant(ids.outsider, ids.tournament)).toBe("unavailable");

    const entryOf = async (letter: string) => (await db.tournamentTeamEntry.findFirstOrThrow({ where: { tournamentId: ids.tournament, teamId: ids[`team${letter}`] } })).tournamentTeamId!;
    const teamA = await entryOf("A");
    expect(await tt.submitMatchReport(ids.outsider, ids.community, { matchId: match.id, winnerTeamId: teamA })).toBe("forbidden");
    expect(await tt.submitMatchReport(ids.a2, ids.community, { matchId: match.id, winnerTeamId: teamA })).toBe("forbidden");
    expect(await tt.submitMatchReport(ids.a1, ids.community, { matchId: match.id, winnerTeamId: teamA })).toBe("waiting");
    expect(await tt.submitMatchReport(ids.a1, ids.community, { matchId: match.id, winnerTeamId: teamA })).toBe("already_reported");
    expect((await db.tournamentMatch.findUniqueOrThrow({ where: { id: match.id } })).completedAt).toBeNull();
    expect(await tt.submitMatchReport(ids.b1, ids.community, { matchId: match.id, winnerTeamId: teamA })).toBe("confirmed");

    const done = await db.tournament.findUniqueOrThrow({ where: { id: ids.tournament } });
    expect(done).toMatchObject({ status: "DONE", championTeamId: teamA });
    expect(awardXp).toHaveBeenCalled();
    expect(await tt.submitMatchReport(ids.b1, ids.community, { matchId: match.id, winnerTeamId: teamA })).toBe("already_decided");
    expect(await db.tournamentMatchReport.count({ where: { matchId: match.id } })).toBe(2);
  });

  it("désaccord : l'organisateur est prévenu et tranche, les autres non", async () => {
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_TOKEN", "faux-jeton");
    await create(2);
    await enter("A", "a1");
    await enter("B", "b1");
    const match = await finalMatch();
    expect(await tt.submitMatchReport(ids.a1, ids.community, { matchId: match.id, winnerTeamId: match.team1Id! })).toBe("waiting");
    expect(await tt.submitMatchReport(ids.b1, ids.community, { matchId: match.id, winnerTeamId: match.team2Id! })).toBe("disputed");

    const rows = await db.notificationDelivery.findMany({ where: { event: { eventType: "TOURNAMENT_TEAM_NOTIFY" } }, select: { recipientKey: true, targetSlot: true, event: { select: { payload: true } } } });
    const kinds = rows.map(row => [row.recipientKey, (row.event.payload as { kind: string }).kind]).sort();
    expect(kinds).toEqual([[`user:${ids.org}`, "dispute"], [`user:${ids.a1}`, "launched"], [`user:${ids.b1}`, "launched"], [`user:${ids.b1}`, "report_pending"]].sort());

    expect(await tt.resolveMatchByReferee(ids.a1, ids.community, { matchId: match.id, winnerTeamId: match.team1Id! })).toBe("forbidden");
    expect(await tt.resolveMatchByReferee(ids.org, ids.community, { matchId: match.id, winnerTeamId: "inconnue" })).toBe("invalid_winner");
    expect(await tt.resolveMatchByReferee(ids.org, ids.community, { matchId: match.id, winnerTeamId: match.team2Id! })).toBe("resolved");
    expect(await db.tournament.findUniqueOrThrow({ where: { id: ids.tournament } })).toMatchObject({ status: "DONE", championTeamId: match.team2Id });
    expect(await tt.resolveMatchByReferee(ids.org, ids.community, { matchId: match.id, winnerTeamId: match.team2Id! })).toBe("already_decided");
  });

  it("un ADMIN de la communauté peut trancher", async () => {
    await create(2);
    await enter("A", "a1");
    await enter("B", "b1");
    const match = await finalMatch();
    await db.membership.update({ where: { communityId_userId: { communityId: ids.community, userId: ids.outsider } }, data: { role: "ADMIN" } });
    expect(await tt.resolveMatchByReferee(ids.outsider, ids.community, { matchId: match.id, winnerTeamId: match.team1Id! })).toBe("resolved");
  });

  it("compatible TOURNAMENT_SCORES_ENABLED : scores concordants enregistrés, incohérents refusés", async () => {
    vi.stubEnv("TOURNAMENT_SCORES_ENABLED", "true");
    await create(2);
    await enter("A", "a1");
    await enter("B", "b1");
    const match = await finalMatch();
    const winner = match.team1Id!;
    expect(await tt.submitMatchReport(ids.a1, ids.community, { matchId: match.id, winnerTeamId: winner, score1: "13", score2: "7" })).toBe("waiting");
    // Gagnant concordant mais scores incohérents avec le gagnant : désaccord, rien n'est enregistré.
    expect(await tt.submitMatchReport(ids.b1, ids.community, { matchId: match.id, winnerTeamId: winner, score1: "13", score2: "9" })).toBe("disputed");
    expect((await db.tournamentMatch.findUniqueOrThrow({ where: { id: match.id } })).completedAt).toBeNull();
    expect(await tt.resolveMatchByReferee(ids.org, ids.community, { matchId: match.id, winnerTeamId: winner, score1: 2, score2: 5 })).toBe("inconsistent");
    expect(await tt.resolveMatchByReferee(ids.org, ids.community, { matchId: match.id, winnerTeamId: winner, score1: 13, score2: 9 })).toBe("resolved");
    expect(await db.tournamentMatch.findUniqueOrThrow({ where: { id: match.id } })).toMatchObject({ score1: 13, score2: 9 });
  });

  it("scores concordants des deux capitaines : match validé avec les scores", async () => {
    vi.stubEnv("TOURNAMENT_SCORES_ENABLED", "true");
    await create(2);
    await enter("A", "a1");
    await enter("B", "b1");
    const match = await finalMatch();
    await tt.submitMatchReport(ids.a1, ids.community, { matchId: match.id, winnerTeamId: match.team2Id!, score1: "3", score2: "13" });
    expect(await tt.submitMatchReport(ids.b1, ids.community, { matchId: match.id, winnerTeamId: match.team2Id!, score1: "3", score2: "13" })).toBe("confirmed");
    expect(await db.tournamentMatch.findUniqueOrThrow({ where: { id: match.id } })).toMatchObject({ score1: 3, score2: 13, winnerTeamId: match.team2Id });
  });

  it("5 équipes max (bracket de 8) : byes résolus, 3 équipes lancées par l'organisateur", async () => {
    await create(5);
    for (const [letter, captain] of [["A", "a1"], ["B", "b1"], ["C", "c1"]]) expect(await enter(letter, captain)).toBe("registered");
    expect(await tt.launchTeamTournament(ids.a1, ids.community, ids.tournament)).toBe("forbidden");
    expect(await tt.launchTeamTournament(ids.org, ids.community, ids.tournament)).toBe("launched");
    expect(await tt.launchTeamTournament(ids.org, ids.community, ids.tournament)).toBe("closed");
    const matches = await db.tournamentMatch.findMany({ where: { tournamentId: ids.tournament }, orderBy: [{ round: "asc" }, { position: "asc" }] });
    expect(matches).toHaveLength(7);
    // 3 équipes sur un bracket de 8 : 3 byes répartis en tour 1 (même algorithme que les tournois existants).
    expect(matches.filter(match => match.round === 1 && match.completedAt).length).toBe(3);
  });

  it("moins de 2 équipes : pas de lancement", async () => {
    await create(4);
    await enter("A", "a1");
    expect(await tt.launchTeamTournament(ids.org, ids.community, ids.tournament)).toBe("too_few");
    expect((await db.tournament.findUniqueOrThrow({ where: { id: ids.tournament } })).status).toBe("REGISTRATION");
  });

  it("places protégées contre la concurrence : jamais plus d'équipes que le maximum", async () => {
    await create(2);
    const results = await Promise.all([enter("A", "a1"), enter("B", "b1"), enter("C", "c1"), enter("D", "d1")]);
    expect(await db.tournamentTeamEntry.count({ where: { tournamentId: ids.tournament, status: "REGISTERED" } })).toBe(2);
    expect(results.filter(result => result === "registered" || result === "launched").length).toBe(2);
    expect(await db.tournamentTeam.count({ where: { tournamentId: ids.tournament } })).toBeLessThanOrEqual(2);
  });

  it("tournoi privé : sur invitation, invisible des étrangers, MP au capitaine invité seulement", async () => {
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_TOKEN", "faux-jeton");
    await create(4, { isPrivate: true });
    expect(await enter("A", "a1")).toBe("not_invited");
    expect(await tt.inviteTeamToTournament(ids.a1, ids.community, { tournamentId: ids.tournament, teamId: ids.teamA })).toBe("forbidden");
    expect(await tt.inviteTeamToTournament(ids.org, ids.community, { tournamentId: ids.tournament, teamId: ids.teamA })).toBe("invited");
    expect(await tt.inviteTeamToTournament(ids.org, ids.community, { tournamentId: ids.tournament, teamId: ids.teamA })).toBe("already");
    const rows = await db.notificationDelivery.findMany({ where: { event: { eventType: "TOURNAMENT_TEAM_NOTIFY" } }, select: { recipientKey: true } });
    expect(rows).toEqual([{ recipientKey: `user:${ids.a1}` }]);

    expect(await read.getTeamTournamentView(ids.a2, ids.community, ids.tournament)).not.toBeNull();
    expect(await read.getTeamTournamentView(ids.org, ids.community, ids.tournament)).not.toBeNull();
    expect(await read.getTeamTournamentView(ids.b1, ids.community, ids.tournament)).toBeNull();
    expect((await read.listTeamTournaments(ids.b1, ids.community)).length).toBe(0);
    expect((await read.listTeamTournaments(ids.a1, ids.community)).length).toBe(1);
    expect(await enter("A", "a1")).toBe("registered");
    expect(await enter("B", "b1")).toBe("not_invited");
    expect(await tt.leaveTeamTournament(ids.a1, ids.community, { tournamentId: ids.tournament, teamId: ids.teamA })).toBe("withdrawn");
    const { privateTeamTournamentWhere, publicTeamTournamentWhere } = await import("./tournament-team-guards");
    expect(await db.tournament.count({ where: privateTeamTournamentWhere(ids.b1) })).toBe(0);
    expect(await db.tournament.count({ where: privateTeamTournamentWhere(ids.org) })).toBe(1);
    expect(await db.tournament.count({ where: publicTeamTournamentWhere() })).toBe(0);
  });

  it("verrouillage à l'échéance : refus après la date, lancement par le cron, relance unique 12 h", async () => {
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_TOKEN", "faux-jeton");
    const closes = new Date(Date.now() + H);
    await create(4, { registrationClosesAt: closes });
    expect(await enter("A", "a1")).toBe("registered");
    expect(await enter("B", "b1")).toBe("registered");
    expect(await tt.enterTeamInTournament(ids.c1, ids.community, { tournamentId: ids.tournament, teamId: ids.teamC }, new Date(closes.getTime() + 1))).toBe("locked");

    expect(await tt.runTeamTournamentMaintenance(new Date(closes.getTime() - 1))).toMatchObject({ locked: 0 });
    expect(await tt.runTeamTournamentMaintenance(new Date(closes.getTime() + 1))).toMatchObject({ locked: 1 });
    expect((await db.tournament.findUniqueOrThrow({ where: { id: ids.tournament } })).status).toBe("IN_PROGRESS");

    const match = (await db.tournamentMatch.findMany({ where: { tournamentId: ids.tournament }, orderBy: { round: "asc" } })).find(candidate => candidate.team1Id && candidate.team2Id && !candidate.completedAt)!;
    await tt.submitMatchReport(ids.a1, ids.community, { matchId: match.id, winnerTeamId: match.team1Id! });
    const start = (await db.tournamentMatchReport.findFirstOrThrow({ where: { matchId: match.id } })).createdAt.getTime();
    expect(await tt.runTeamTournamentMaintenance(new Date(start + 11 * H))).toMatchObject({ reminded: 0 });
    expect(await tt.runTeamTournamentMaintenance(new Date(start + 13 * H))).toMatchObject({ reminded: 1 });
    expect(await tt.runTeamTournamentMaintenance(new Date(start + 30 * H))).toMatchObject({ reminded: 0 });
    const reminders = await db.notificationDelivery.findMany({ where: { event: { eventType: "TOURNAMENT_TEAM_NOTIFY", occurrence: { startsWith: "reminder:" } } }, select: { recipientKey: true } });
    expect(reminders).toEqual([{ recipientKey: `user:${ids.b1}` }]);
  });

  it("les tournois d'équipes sont redirigés hors des chemins individuels (garde)", async () => {
    await create(2);
    const { isRegisteredTeamTournament } = await import("./tournament-team-guards");
    expect(await isRegisteredTeamTournament(ids.tournament)).toBe(true);
    vi.stubEnv("TOURNAMENT_TEAMS_ENABLED", "false");
    expect(await isRegisteredTeamTournament(ids.tournament)).toBe(false);
  });
});
