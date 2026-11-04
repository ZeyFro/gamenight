import { describe, expect, it } from "vitest";
import { parsePlayerClassifiedFilters, playerClassifiedFilterWhere } from "./player-classified-filters";

describe("filtres des annonces", () => {
  it("accepte une lecture historique sans filtre", () => {
    expect(parsePlayerClassifiedFilters({}).success).toBe(true);
    expect(playerClassifiedFilterWhere({})).toEqual({ createdBy: {} });
  });
  it.each(["yes", "no", "unknown"] as const)("distingue le micro %s", microphone => {
    const expected = microphone === "unknown" ? null : microphone === "yes";
    expect(playerClassifiedFilterWhere({ microphone })).toEqual({ createdBy: { microphoneAvailable: expected } });
  });
  it("combine ID de jeu et matériel sans rechercher par nom", () => {
    expect(playerClassifiedFilterWhere({ gameId: "game-2", platform: "WINDOWS", microphone: "no" })).toEqual({
      gameId: "game-2", createdBy: { availablePlatforms: { has: "WINDOWS" }, microphoneAvailable: false },
    });
  });
  it.each([{ gameId: ["a", "b"] }, { platform: "invented" }, { microphone: "false" }, { gameId: "x".repeat(192) }])("refuse les paramètres invalides %j", params => {
    expect(parsePlayerClassifiedFilters(params).success).toBe(false);
  });
});
