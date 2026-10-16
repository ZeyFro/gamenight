// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CommunityGameQuiz } from "./CommunityGameQuiz";

afterEach(cleanup);

const round = { answer: "Le Café 2", coverUrl: null, clues: ["Genre : Puzzle", "Thème : Mystère", "Studio : Équipe" ] };

describe("CommunityGameQuiz", () => {
  it("reveals clues progressively and accepts accent-insensitive guesses", () => {
    render(<CommunityGameQuiz round={round} />);
    expect(screen.getByText("Genre : Puzzle")).toBeTruthy();
    expect(screen.queryByText("Thème : Mystère")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Révéler un autre indice" }));
    expect(screen.getByText("Thème : Mystère")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Nom du jeu" }), { target: { value: "le cafe-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));
    expect(screen.getByRole("status").textContent).toContain("Bien joué !");
  });

  it("uses one guess, then reveals the answer after an incorrect attempt", () => {
    render(<CommunityGameQuiz round={round} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Nom du jeu" }), { target: { value: "Autre jeu" } });
    fireEvent.click(screen.getByRole("button", { name: "Valider" }));
    expect(screen.getByRole("status").textContent).toContain("La réponse était Le Café 2.");
    expect(screen.getByRole("textbox", { name: "Nom du jeu" }).hasAttribute("disabled")).toBe(true);
  });
});
