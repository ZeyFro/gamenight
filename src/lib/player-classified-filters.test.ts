import { describe, expect, it } from "vitest";
import { parsePlayerClassifiedFilters, playerClassifiedFilterWhere } from "./player-classified-filters";
import { parsePlayerClassifiedDateTime, playerClassifiedSchema } from "./player-classifieds-rules";

describe("filtres des annonces", () => {
  it("accepte une lecture historique sans filtre", () => {
    expect(parsePlayerClassifiedFilters({}).success).toBe(true);
    expect(playerClassifiedFilterWhere({})).toEqual({ createdBy: {} });
  });
  it.each(["yes", "no", "unknown"] as const)("distingue le micro %s", microphone => {
    const expected = microphone === "unknown" ? null : microphone === "yes";
    expect(playerClassifiedFilterWhere({ microphone })).toEqual({ createdBy: { microphoneAvailable: expected } });
  });
  it("combine le jeu et le matériel déclaré par le joueur", () => {
    expect(playerClassifiedFilterWhere({ gameId: "game-2", platform: "WINDOWS", microphone: "no" })).toEqual({
      gameId: "game-2", createdBy: { availablePlatforms: { has: "WINDOWS" }, microphoneAvailable: false },
    });
  });
  it("filtre les critères de la partie annoncée et ses heures murales", () => {
    const startsAfterDate = "2026-11-06";
    const startsAfterTime = "19:00";
    const startsBeforeDate = "2026-11-06";
    const startsBeforeTime = "21:00";
    const filters = { gameId: "game-2", partyPlatform: "PLAYSTATION", microphoneRequirement: "OPTIONAL", partyType: "COOPERATIVE", startsAfterDate, startsAfterTime, startsBeforeDate, startsBeforeTime } as const;
    expect(playerClassifiedFilterWhere(filters)).toMatchObject({
      gameId: "game-2", platform: "PLAYSTATION", microphoneRequirement: "OPTIONAL", partyType: "COOPERATIVE",
      startsAt: { gte: parsePlayerClassifiedDateTime(startsAfterDate, startsAfterTime), lte: parsePlayerClassifiedDateTime(startsBeforeDate, startsBeforeTime) },
    });
  });
  it.each([{ gameId: ["a", "b"] }, { platform: "invented" }, { microphone: "false" }, { gameId: "x".repeat(192) }])("refuse les paramètres invalides %j", params => {
    expect(parsePlayerClassifiedFilters(params).success).toBe(false);
  });
  it.each([
    { partyPlatform: "invented" },
    { microphoneRequirement: "PREFERRED" },
    { partyType: "RANKED" },
    { startsAfterDate: "2026-02-30", startsAfterTime: "20:00" },
    { startsAfterDate: "2026-11-06" },
    { startsAfterDate: "2026-11-06", startsAfterTime: "21:00", startsBeforeDate: "2026-11-06", startsBeforeTime: "20:00" },
  ])("refuse les critères de partie invalides %j", params => {
    expect(parsePlayerClassifiedFilters(params).success).toBe(false);
  });
  it("valide une annonce et exige horaire et durée ensemble", () => {
    const base = { gameId: "game-1", message: "Cherche des joueurs", platform: "WINDOWS", microphoneRequirement: "OPTIONAL", partyType: "CASUAL" };
    expect(playerClassifiedSchema.safeParse({ ...base, startsDate: "2026-11-06", startsTime: "20:00", durationMinutes: "120" })).toMatchObject({
      success: true,
      data: { platform: "WINDOWS", microphoneRequirement: "OPTIONAL", partyType: "CASUAL", startsAt: new Date("2026-11-06T20:00:00Z"), durationMinutes: 120 },
    });
    expect(playerClassifiedSchema.safeParse({ ...base, startsDate: "2026-11-06", durationMinutes: "120" }).success).toBe(false);
    expect(playerClassifiedSchema.safeParse({ ...base, startsDate: "2026-11-06", startsTime: "20:00" }).success).toBe(false);
    expect(playerClassifiedSchema.safeParse({ ...base, durationMinutes: "0" }).success).toBe(false);
  });
});
