import { afterEach, describe, expect, it, vi } from "vitest";
import { isTournamentPredictionsEnabled, predictionWinner, canPredictTournamentTarget, tournamentPredictionPoints } from "./tournament-prediction-rules";

afterEach(() => vi.unstubAllEnvs());
describe("pronostics de tournoi", () => {
  it("reste désactivé sauf true explicite", () => {
    vi.stubEnv("TOURNAMENT_PREDICTIONS_ENABLED", "false");
    expect(isTournamentPredictionsEnabled()).toBe(false);
    vi.stubEnv("TOURNAMENT_PREDICTIONS_ENABLED", "true");
    expect(isTournamentPredictionsEnabled()).toBe(true);
  });
  it("ferme le champion au lancement et valide le participant", () => {
    expect(canPredictTournamentTarget("REGISTRATION", ["a", "b"], "a", null)).toBe(true);
    expect(canPredictTournamentTarget("IN_PROGRESS", ["a", "b"], "a", null)).toBe(false);
    expect(canPredictTournamentTarget("REGISTRATION", ["a"], "étranger", null)).toBe(false);
  });
  it("exige deux joueurs connus, un tournoi actif et un match non terminé", () => {
    const match = { player1Id: "a", player2Id: "b", winnerId: null, completedAt: null };
    expect(canPredictTournamentTarget("IN_PROGRESS", [], "b", match)).toBe(true);
    expect(canPredictTournamentTarget("IN_PROGRESS", [], "c", match)).toBe(false);
    expect(canPredictTournamentTarget("IN_PROGRESS", [], "a", { ...match, player2Id: null })).toBe(false);
    expect(canPredictTournamentTarget("IN_PROGRESS", [], "a", { ...match, winnerId: "a" })).toBe(false);
    expect(canPredictTournamentTarget("IN_PROGRESS", [], "a", { ...match, completedAt: new Date() })).toBe(false);
    expect(canPredictTournamentTarget("CANCELLED", [], "a", match)).toBe(false);
  });
  it("ne présente aucun gagnant avant résolution ou après annulation", () => {
    expect(predictionWinner("DONE", "a", null)).toBe("a");
    expect(predictionWinner("IN_PROGRESS", null, "b")).toBe("b");
    expect(predictionWinner("CANCELLED", "a", "b")).toBe(null);
    expect(predictionWinner("REGISTRATION", "a", null)).toBe(null);
  });
  it("attribue un point fictif uniquement au pronostic correct résolu", () => {
    expect(tournamentPredictionPoints("alice", "alice")).toBe(1);
    expect(tournamentPredictionPoints("alice", "bob")).toBe(0);
    expect(tournamentPredictionPoints(null, "alice")).toBe(0);
  });
});
