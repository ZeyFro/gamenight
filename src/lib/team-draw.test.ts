import { describe, expect, it } from "vitest";
import { splitIntoTeams } from "./team-draw";

describe("splitIntoTeams", () => {
  it("répartit chaque joueur une fois et équilibre les équipes à un joueur près", () => {
    const players = ["A", "B", "C", "D", "E"];
    const teams = splitIntoTeams(players, 2);

    expect(teams.flat().sort()).toEqual(players);
    expect(Math.max(...teams.map((team) => team.length)) - Math.min(...teams.map((team) => team.length))).toBeLessThanOrEqual(1);
    expect(players).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("refuse les nombres d'équipes impossibles", () => {
    expect(() => splitIntoTeams(["A"], 2)).toThrow(RangeError);
    expect(() => splitIntoTeams(["A", "B"], 1)).toThrow(RangeError);
  });
});
