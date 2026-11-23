import { describe, expect, it } from "vitest";
import { rankTowerTeams } from "./tower-team-standings-rules";

const at = (iso: string) => new Date(iso);
const team = (teamId: string, floors: number, wins: number, reachedAt: string) => ({ teamId, name: teamId, color: null, emblem: null, floors, wins, reachedAt: at(reachedAt) });

describe("rankTowerTeams", () => {
  it("ordonne par étages, puis défis validés, puis première arrivée", () => {
    const ranked = rankTowerTeams([
      team("c", 6, 2, "2026-12-03T00:00:00Z"),
      team("a", 9, 3, "2026-12-05T00:00:00Z"),
      team("b", 6, 3, "2026-12-04T00:00:00Z"),
      team("d", 6, 2, "2026-12-01T00:00:00Z"),
    ]);
    expect(ranked.map(row => [row.teamId, row.rank])).toEqual([["a", 1], ["b", 2], ["d", 3], ["c", 4]]);
    expect(ranked.every(row => !row.exAequo)).toBe(true);
  });

  it("des équipes strictement égales partagent la place ; la suivante saute les places", () => {
    const ranked = rankTowerTeams([
      team("b", 6, 2, "2026-12-01T00:00:00Z"),
      team("a", 6, 2, "2026-12-01T00:00:00Z"),
      team("c", 3, 1, "2026-12-02T00:00:00Z"),
    ]);
    expect(ranked.map(row => [row.teamId, row.rank, row.exAequo])).toEqual([["a", 1, true], ["b", 1, true], ["c", 3, false]]);
  });

  it("une équipe sans étage n'est pas classée", () => {
    expect(rankTowerTeams([team("a", 0, 0, "2026-12-01T00:00:00Z")])).toEqual([]);
  });
});
