// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.mock("@/app/tournois/prediction-actions", () => ({ submitTournamentPredictionAction: vi.fn() }));
import { TournamentPredictions } from "./TournamentPredictions";
afterEach(cleanup);
const alice = { id: "alice", discordName: "Alice" };
const bob = { id: "bob", discordName: "Bob" };
const tournament = { id: "t1", status: "REGISTRATION" as const, championId: null, participants: [{ user: alice }, { user: bob }], matches: [{ id: "m1", round: 1, position: 0, player1Id: "alice", player2Id: "bob", player1: alice, player2: bob, winnerId: null, completedAt: null }] };

it("propose le champion avec un champ étiqueté avant lancement", () => {
  render(<TournamentPredictions tournament={tournament} predictions={[]} />);
  expect(screen.getByLabelText("Champion du tournoi")).toBeTruthy();
  expect(screen.queryByLabelText("Round 1, match 1")).toBeNull();
});
it("ne propose que les matchs ouverts une fois le tournoi lancé", () => {
  render(<TournamentPredictions tournament={{ ...tournament, status: "IN_PROGRESS" }} predictions={[]} />);
  expect(screen.queryByLabelText("Champion du tournoi")).toBeNull();
  expect(screen.getByLabelText("Round 1, match 1")).toBeTruthy();
});
it("affiche le résultat et empêche toute modification d'un choix existant", () => {
  render(<TournamentPredictions tournament={{ ...tournament, status: "DONE", championId: "bob" }} predictions={[{ target: "champion", predictedUserId: "bob" }]} />);
  expect(screen.getByText(/Champion du tournoi : Bob — réussi/)).toBeTruthy();
  expect(screen.queryByRole("combobox")).toBeNull();
});

it("affiche les points fictifs cumulés et le point gagné par cible correcte", () => {
  const completed = {
    ...tournament,
    status: "DONE" as const,
    championId: "bob",
    matches: [{ ...tournament.matches[0], winnerId: "alice", completedAt: new Date() }],
  };
  render(<TournamentPredictions tournament={completed} predictions={[
    { target: "champion", predictedUserId: "bob" },
    { target: "m1", predictedUserId: "alice" },
    { target: "missing", predictedUserId: "alice" },
  ]} />);
  expect(screen.getByText(/Score fictif :\s*2 points/)).toBeTruthy();
  expect(screen.getByText(/Champion du tournoi : Bob — réussi ✓ \(\+1 point\)/)).toBeTruthy();
  expect(screen.getByText(/Round 1, match 1 : Alice — réussi ✓ \(\+1 point\)/)).toBeTruthy();
});

it("n'accorde pas de point aux pronostics en attente ou annulés", () => {
  const { rerender } = render(<TournamentPredictions tournament={{ ...tournament, status: "IN_PROGRESS" }} predictions={[
    { target: "champion", predictedUserId: "bob" },
  ]} />);
  expect(screen.getByText(/Score fictif :\s*0 point/)).toBeTruthy();
  expect(screen.getByText(/Champion du tournoi : Bob — en attente/)).toBeTruthy();

  rerender(<TournamentPredictions tournament={{ ...tournament, status: "CANCELLED" }} predictions={[
    { target: "champion", predictedUserId: "bob" },
  ]} />);
  expect(screen.getByText(/Score fictif :\s*0 point/)).toBeTruthy();
  expect(screen.getByText(/Champion du tournoi : Bob — annulé/)).toBeTruthy();
});

it("affiche zéro point pour un pronostic incorrect résolu", () => {
  render(<TournamentPredictions tournament={{ ...tournament, status: "DONE", championId: "bob" }} predictions={[
    { target: "champion", predictedUserId: "alice" },
  ]} />);
  expect(screen.getByText(/Score fictif :\s*0 point/)).toBeTruthy();
  expect(screen.getByText(/Champion du tournoi : Alice — manqué \(0 point\)/)).toBeTruthy();
});
