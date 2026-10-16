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

  it("répartit les profils déclarés sur les équipes", () => {
    const players = [
      { id: "A", styleProfile: [5, 0, 0, 0] }, { id: "B", styleProfile: [5, 0, 0, 0] },
      { id: "C", styleProfile: [0, 5, 0, 0] }, { id: "D", styleProfile: [0, 5, 0, 0] },
    ];
    const teams = splitIntoTeams(players, 2);
    expect(teams.map((team) => team.reduce((sum, player) => sum + player.styleProfile[0], 0)).sort()).toEqual([5, 5]);
    expect(teams.map((team) => team.reduce((sum, player) => sum + player.styleProfile[1], 0)).sort()).toEqual([5, 5]);
    expect(teams.flat().map((player) => player.id).sort()).toEqual(["A", "B", "C", "D"]);
  });
});
