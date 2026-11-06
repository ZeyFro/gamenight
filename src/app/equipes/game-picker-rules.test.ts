import { describe, expect, it } from "vitest";
import { filterTeamGameOptions, uniqueTeamGameOptions } from "./game-picker-rules";

const games = [
  { id: "1", name: "Valheim" },
  { id: "2", name: " valheim " },
  { id: "3", name: "Pokémon" },
  { id: "4", name: "Minecraft" },
];

describe("GamePicker", () => {
  it("hides duplicate labels and preserves the original list", () => {
    expect(uniqueTeamGameOptions(games)).toEqual([games[0], games[2], games[3]]);
    expect(games).toHaveLength(4);
  });
  it("searches ignoring accents and case", () => {
    expect(filterTeamGameOptions(uniqueTeamGameOptions(games), "POKEMON")).toEqual([games[2]]);
    expect(filterTeamGameOptions(uniqueTeamGameOptions(games), "mine")).toEqual([games[3]]);
  });
  it("shows all unique names when search is empty", () => {
    expect(filterTeamGameOptions(uniqueTeamGameOptions(games), " ")).toHaveLength(3);
  });
});
