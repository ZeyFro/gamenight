import { describe, expect, it } from "vitest";
import {
  agreedScores, compareReports, createTeamTournamentSchema, isTournamentTeamsEnabled, matchReportSchema, maxPlayersForTeams, registrationDeadlinePassed,
  reportBlock, teamEntryBlock,
} from "./tournament-teams-rules";
import { bracketSizeFor, tournamentBracketSize } from "./tournaments";

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

describe("drapeau TOURNAMENT_TEAMS_ENABLED", () => {
  it.each([[undefined, false], ["", false], ["false", false], ["TRUE", false], ["1", false], ["true", true]])("valeur %s : %s", (value, expected) => {
    expect(isTournamentTeamsEnabled(env(value === undefined ? {} : { TOURNAMENT_TEAMS_ENABLED: value }))).toBe(expected);
  });
});

describe("taille du bracket", () => {
  it("maxPlayers = 2 par équipe et le bracket existant suit le nombre d'équipes", () => {
    expect([2, 3, 4, 5, 8].map(teams => tournamentBracketSize(maxPlayersForTeams(teams), "TEAMS"))).toEqual([2, 4, 4, 8, 8]);
    expect(bracketSizeFor(5)).toBe(8);
  });
});

describe("création", () => {
  const base = { name: "Coupe Deadlock", gameId: "g1", maxTeams: "5" };
  it("accepte 2 à 8 équipes, public par défaut", () => {
    expect(createTeamTournamentSchema.parse(base)).toMatchObject({ maxTeams: 5, isPrivate: false, registrationClosesAt: null });
    expect(createTeamTournamentSchema.safeParse({ ...base, maxTeams: "1" }).success).toBe(false);
    expect(createTeamTournamentSchema.safeParse({ ...base, maxTeams: "9" }).success).toBe(false);
    expect(createTeamTournamentSchema.safeParse({ ...base, name: "ab" }).success).toBe(false);
  });
});

describe("comparaison des déclarations", () => {
  const a = { winnerTeamId: "t1", score1: 13, score2: 7 };
  it("concordent sur le même gagnant et les mêmes scores", () => {
    expect(compareReports(a, { ...a })).toBe("agree");
    expect(agreedScores(a, { ...a })).toEqual({ score1: 13, score2: 7 });
  });
  it("discordent sur le gagnant", () => {
    expect(compareReports(a, { ...a, winnerTeamId: "t2" })).toBe("disagree");
  });
  it("discordent sur des scores différents, pas sur un score absent d'un côté", () => {
    expect(compareReports(a, { ...a, score1: 12 })).toBe("disagree");
    const bare = { winnerTeamId: "t1", score1: null, score2: null };
    expect(compareReports(a, bare)).toBe("agree");
    expect(agreedScores(a, bare)).toEqual({ score1: 13, score2: 7 });
    expect(agreedScores(bare, bare)).toBeUndefined();
  });
  it("exige les deux scores ou aucun", () => {
    expect(matchReportSchema.safeParse({ matchId: "m", winnerTeamId: "t", score1: "3", score2: "" }).success).toBe(false);
    expect(matchReportSchema.safeParse({ matchId: "m", winnerTeamId: "t", score1: "", score2: "" }).success).toBe(true);
    expect(matchReportSchema.parse({ matchId: "m", winnerTeamId: "t", score1: "3", score2: "1" })).toMatchObject({ score1: 3, score2: 1 });
    expect(matchReportSchema.safeParse({ matchId: "m", winnerTeamId: "t", score1: "-1", score2: "1" }).success).toBe(false);
  });
});

describe("inscription d'une équipe", () => {
  const ok = { registrationOpen: true, deadlinePassed: false, isPrivate: false, existingStatus: null, registeredCount: 2, maxTeams: 4, actorIsCaptain: true, activeMembers: 3 } as const;
  it("autorise le capitaine d'un tournoi public avec une place", () => {
    expect(teamEntryBlock(ok)).toBeNull();
    expect(teamEntryBlock({ ...ok, existingStatus: "DECLINED" })).toBeNull();
  });
  it.each([
    [{ actorIsCaptain: false }, "forbidden"], [{ registrationOpen: false }, "closed"], [{ deadlinePassed: true }, "locked"],
    [{ existingStatus: "REGISTERED" }, "already"], [{ registeredCount: 4 }, "full"], [{ activeMembers: 0 }, "too_small"],
    [{ isPrivate: true }, "not_invited"], [{ isPrivate: true, existingStatus: "WITHDRAWN" }, "not_invited"],
  ] as const)("refuse %j : %s", (patch, expected) => {
    expect(teamEntryBlock({ ...ok, ...patch })).toBe(expected);
  });
  it("tournoi privé : l'invitation suffit", () => {
    expect(teamEntryBlock({ ...ok, isPrivate: true, existingStatus: "INVITED" })).toBeNull();
  });
  it("l'échéance verrouille à l'instant exact", () => {
    const closes = new Date("2026-12-05T18:00:00Z");
    expect(registrationDeadlinePassed(closes, new Date(closes.getTime() - 1))).toBe(false);
    expect(registrationDeadlinePassed(closes, closes)).toBe(true);
    expect(registrationDeadlinePassed(null, closes)).toBe(false);
  });
});

describe("déclaration d'un capitaine", () => {
  const ok = { tournamentInProgress: true, matchDecided: false, bothTeamsKnown: true, actorTeamSlot: 1, alreadyReported: false, winnerInMatch: true } as const;
  it("autorise un des deux capitaines une seule fois", () => {
    expect(reportBlock(ok)).toBeNull();
    expect(reportBlock({ ...ok, actorTeamSlot: 2 })).toBeNull();
  });
  it.each([
    [{ tournamentInProgress: false }, "closed"], [{ matchDecided: true }, "already_decided"], [{ bothTeamsKnown: false }, "not_ready"],
    [{ actorTeamSlot: null }, "forbidden"], [{ alreadyReported: true }, "already_reported"], [{ winnerInMatch: false }, "invalid_winner"],
  ] as const)("refuse %j : %s", (patch, expected) => {
    expect(reportBlock({ ...ok, ...patch })).toBe(expected);
  });
});
