// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/app/tournois/actions", () => ({ declareWinnerAction: vi.fn() }));

import { TournamentBracket, type BracketMatch } from "./TournamentBracket";

afterEach(cleanup);

const p1 = { id: "u1", discordName: "Alice", discordAvatar: null };
const p2 = { id: "u2", discordName: "Bob", discordAvatar: null };
const playable: BracketMatch = { id: "m1", round: 1, position: 0, player1: p1, player2: p2, winnerId: null };
const done: BracketMatch = { ...playable, winnerId: "u1", score1: 5, score2: 2 };

const renderBracket = (m: BracketMatch, showScores: boolean) =>
  render(<TournamentBracket matches={[m]} totalRounds={1} currentUserId="u1" isCreator={false} showScores={showScores} />);

describe("TournamentBracket (scores)", () => {
  it("drapeau éteint : aucun champ de saisie, boutons gagnant inchangés", () => {
    const { container } = renderBracket(playable, false);
    expect(container.querySelector('input[type="number"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Alice gagne" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bob gagne" })).toBeTruthy();
  });

  it("permet à un membre d'une équipe de déclarer le résultat", () => {
    const match: BracketMatch = {
      ...playable,
      player1: { id: "team-1", discordName: "Équipe 1 · Alice + Alex", discordAvatar: null, memberIds: ["u3", "u4"] },
      player2: { id: "team-2", discordName: "Équipe 2 · Bob + Bea", discordAvatar: null, memberIds: ["u5", "u6"] },
    };
    render(<TournamentBracket matches={[match]} totalRounds={1} currentUserId="u3" isCreator={false} />);
    expect(screen.getByRole("button", { name: "Équipe 1 · Alice + Alex gagne" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Équipe 2 · Bob + Bea gagne" })).toBeTruthy();
  });

  it("drapeau éteint : un score existant n'est pas affiché", () => {
    renderBracket(done, false);
    expect(screen.queryByLabelText("Score : 5")).toBeNull();
  });

  it("drapeau allumé : deux champs étiquetés, facultatifs, et les deux boutons gagnant", () => {
    renderBracket(playable, true);
    const a = screen.getByLabelText(/Score de Alice/) as HTMLInputElement;
    const b = screen.getByLabelText(/Score de Bob/) as HTMLInputElement;
    expect([a.name, b.name]).toEqual(["score1", "score2"]);
    expect(a.required).toBe(false);
    expect(screen.getByRole("button", { name: "Alice gagne" })).toBeTruthy();
  });

  it("drapeau allumé : affiche les scores d'un match terminé", () => {
    renderBracket(done, true);
    expect(screen.getByLabelText("Score : 5")).toBeTruthy();
    expect(screen.getByLabelText("Score : 2")).toBeTruthy();
  });

  it("drapeau allumé, match terminé sans score : rien d'affiché", () => {
    renderBracket({ ...done, score1: null, score2: null }, true);
    expect(screen.queryByLabelText(/^Score : /)).toBeNull();
  });
});
