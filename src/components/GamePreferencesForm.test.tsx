// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
vi.mock("@/app/profil/game-preference-actions", () => ({ updateGamePreferencesAction: vi.fn(), setGameRefusalAction: vi.fn() }));
import { GamePreferencesForm } from "./GamePreferencesForm";
import { RefuseGameForm } from "./RefuseGameForm";
afterEach(cleanup);
describe("préférences et refus : formulaire réel", () => {
  it("préremplit les choix et permet de retirer un refus sans envoyer l'identité du membre", () => {
    render(<GamePreferencesForm user={{ preferredGameCategories: ["COOP"], refusedGameCategories: ["HORROR"] }} games={[]} refusals={[{ gameId: "game", game: { name: "Ancien jeu" } }]} />);
    const preferred = within(screen.getByRole("group", { name: "Ce que je préfère" })).getByLabelText("Coopération") as HTMLInputElement;
    expect(preferred.checked).toBe(true);
    expect((within(screen.getByRole("group", { name: "Ce que je refuse" })).getByLabelText("Horreur") as HTMLInputElement).checked).toBe(true);
    const form = screen.getByRole("button", { name: "Retirer le refus de Ancien jeu" }).closest("form")!;
    expect([...new FormData(form)]).toEqual([["gameId", "game"], ["mode", "remove"]]);
    fireEvent.click(preferred);
    const prefs = new FormData(screen.getByRole("button", { name: "Enregistrer mes préférences" }).closest("form")!);
    expect(prefs.getAll("preferredGameCategories")).toEqual([]); expect(prefs.getAll("refusedGameCategories")).toEqual(["HORROR"]);
  });
  it("cherche le jeu, envoie son id et efface une sélection périmée après changement de recherche", () => {
    render(<RefuseGameForm games={[{ id: "one", name: "Alpha" }, { id: "two", name: "Beta" }]} />);
    const submit = screen.getByRole("button", { name: "Refuser ce jeu" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Jeu à refuser"), { target: { value: "two" } });
    expect(submit.disabled).toBe(false);
    expect(new FormData(submit.closest("form")!).get("gameId")).toBe("two");
    fireEvent.change(screen.getByLabelText("Chercher dans les jeux du serveur"), { target: { value: "Alpha" } });
    expect(submit.disabled).toBe(true); expect(screen.queryByRole("option", { name: "Beta" })).toBeNull();
    expect(new FormData(submit.closest("form")!).get("gameId")).toBe("");
  });
});
