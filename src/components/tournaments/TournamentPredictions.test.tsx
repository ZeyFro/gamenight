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
