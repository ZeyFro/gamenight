import { describe, expect, it } from "vitest";
import {
  ARBITRATION_DELAY_MS, ARBITRATION_FALLBACK_MS, arbitrationOpen, arbitrationOpensAt, roundRobinComplete, roundRobinSchedule, roundRobinStandings, usesRoundRobin,
} from "./tournament-round-robin";

const TEAMS = ["A", "B", "C", "D", "E"];

describe("poule unique à 5 équipes (décision du 26/11)", () => {
  it("seul un effectif de 5 équipes passe en poule ; les autres gardent l'arbre", () => {
    expect([2, 3, 4, 5, 6, 7, 8].filter(usesRoundRobin)).toEqual([5]);
  });

  it("5 journées de 2 matchs, 10 rencontres, chaque paire une seule fois", () => {
    const days = roundRobinSchedule(TEAMS);
    expect(days).toHaveLength(5);
    expect(days.every((day) => day.matches.length === 2)).toBe(true);
    const pairs = days.flatMap((day) => day.matches.map(([a, b]) => [a, b].sort().join("-")));
    expect(pairs).toHaveLength(10);
    expect(new Set(pairs).size).toBe(10);
  });

  it("nombre impair : chaque équipe est au repos exactement une journée et ne joue jamais deux fois le même jour", () => {
    const days = roundRobinSchedule(TEAMS);
    expect(days.map((day) => day.resting).sort()).toEqual(TEAMS);
    for (const day of days) {
      const playing = day.matches.flat();
      expect(new Set(playing).size).toBe(4);
      expect(playing).not.toContain(day.resting);
    }
    for (const team of TEAMS) expect(days.flatMap((day) => day.matches.flat()).filter((t) => t === team)).toHaveLength(4);
  });

  it("nombre pair : aucune équipe au repos", () => {
    const days = roundRobinSchedule(["A", "B", "C", "D"]);
    expect(days).toHaveLength(3);
    expect(days.every((day) => day.resting === null && day.matches.length === 2)).toBe(true);
  });
});

const teams = TEAMS.map((id, index) => ({ id, name: `Équipe ${id}`, position: index + 1 }));
const match = (team1Id: string, team2Id: string, winnerTeamId: string | null, score1: number | null = null, score2: number | null = null) =>
  ({ team1Id, team2Id, winnerTeamId, score1, score2 });

describe("classement de la poule", () => {
  it("trie par victoires et ignore les matchs non tranchés", () => {
    const rows = roundRobinStandings(teams, [match("A", "B", "A"), match("A", "C", "A"), match("B", "C", "B"), match("D", "E", null)]);
    expect(rows.map((row) => row.teamId)).toEqual(["A", "B", "C", "D", "E"]);
    expect(rows[0]).toMatchObject({ rank: 1, played: 2, wins: 2, losses: 0 });
    expect(rows.find((row) => row.teamId === "D")).toMatchObject({ played: 0, wins: 0 });
  });

  it("deux équipes à égalité : la confrontation directe départage, même contre le tirage", () => {
    const rows = roundRobinStandings(teams, [match("A", "C", "A"), match("B", "D", "B"), match("A", "B", "B"), match("A", "E", "A"), match("B", "C", "C")]);
    // A et B : 2 victoires chacune ; B a battu A.
    expect(rows.slice(0, 2).map((row) => row.teamId)).toEqual(["B", "A"]);
  });

  it("trois équipes à égalité : différence de score, puis ordre du tirage", () => {
    const cycle = [match("A", "B", "A", 3, 1), match("B", "C", "B", 5, 0), match("C", "A", "C", 2, 1)];
    expect(roundRobinStandings(teams, cycle).slice(0, 3).map((row) => row.teamId)).toEqual(["B", "A", "C"]);
    const noScores = [match("A", "B", "A"), match("B", "C", "B"), match("C", "A", "C")];
    expect(roundRobinStandings(teams, noScores).slice(0, 3).map((row) => row.teamId)).toEqual(["A", "B", "C"]);
  });

  it("les rangs sont tous distincts", () => {
    const rows = roundRobinStandings(teams, []);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("la poule est complète seulement quand les 10 matchs sont tranchés", () => {
    const done = Array.from({ length: 10 }, () => ({ completedAt: new Date() }));
    expect(roundRobinComplete(done)).toBe(true);
    expect(roundRobinComplete([...done.slice(1), { completedAt: null }])).toBe(false);
    expect(roundRobinComplete([])).toBe(false);
  });
});

describe("arbitrage après 24 h", () => {
  const t0 = new Date("2026-11-26T20:00:00Z");
  it("s'ouvre 24 h après la dernière déclaration", () => {
    const later = new Date(t0.getTime() + 60_000);
    expect(arbitrationOpensAt([t0, later])?.getTime()).toBe(later.getTime() + ARBITRATION_DELAY_MS);
    expect(arbitrationOpen([t0, later], new Date(later.getTime() + ARBITRATION_DELAY_MS - 1))).toBe(false);
    expect(arbitrationOpen([t0, later], new Date(later.getTime() + ARBITRATION_DELAY_MS))).toBe(true);
  });
  it("sans déclaration ni date d'ouverture, rien à arbitrer", () => {
    expect(arbitrationOpensAt([])).toBeNull();
    expect(arbitrationOpen([], new Date("2030-01-01"))).toBe(false);
  });
  it("repli (décision du 26/11) : sans déclaration, 48 h après l'ouverture du match", () => {
    expect(arbitrationOpensAt([], t0)?.getTime()).toBe(t0.getTime() + ARBITRATION_FALLBACK_MS);
    expect(ARBITRATION_FALLBACK_MS).toBe(48 * 3_600_000);
    expect(arbitrationOpen([], new Date(t0.getTime() + ARBITRATION_FALLBACK_MS - 1), t0)).toBe(false);
    expect(arbitrationOpen([], new Date(t0.getTime() + ARBITRATION_FALLBACK_MS), t0)).toBe(true);
  });
  it("dès qu'une déclaration existe, c'est le délai de 24 h qui compte, pas l'ouverture", () => {
    const reported = new Date(t0.getTime() + 47 * 3_600_000);
    expect(arbitrationOpensAt([reported], t0)?.getTime()).toBe(reported.getTime() + ARBITRATION_DELAY_MS);
    expect(arbitrationOpen([reported], new Date(t0.getTime() + 49 * 3_600_000), t0)).toBe(false);
  });
});
