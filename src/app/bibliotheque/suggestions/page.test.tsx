// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ current: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.current }));
vi.mock("@/lib/game-suggestions", () => ({ loadGameSuggestions: mocks.load }));
vi.mock("@/components/LibraryTabs", () => ({ LibraryTabs: () => null }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
import Page from "./page";
const base = { members: [{ id: "self", discordName: "Moi" }, { id: "friend", discordName: "Ami" }], suggestions: [], unknownMetadataCount: 0, totalSuggestions: 0, error: null };
beforeEach(() => { vi.clearAllMocks(); mocks.current.mockResolvedValue({ id: "self" }); mocks.load.mockResolvedValue(base); });
afterEach(cleanup);
describe("suggestions de jeux : parcours serveur et formulaire GET", () => {
  it("exige la connexion avant de rechercher", async () => {
    mocks.current.mockResolvedValue(null);
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT:/"); expect(mocks.load).not.toHaveBeenCalled();
  });
  it("préserve la sélection répétée d'un lien, sans y ajouter implicitement le visiteur", async () => {
    render(await Page({ searchParams: Promise.resolve({ participants: ["friend"] }) }));
    expect(mocks.load).toHaveBeenCalledWith("self", ["friend"]);
    const form = screen.getByRole("button", { name: "Chercher des jeux" }).closest("form")!;
    expect(new FormData(form).getAll("participants")).toEqual(["friend"]); expect(form.method).toBe("get");
    expect((screen.getByRole("checkbox", { name: "Moi" }) as HTMLInputElement).checked).toBe(false);
  });
  it("une sélection explicitement vide reste vide, et l'entrée initiale coche le visiteur", async () => {
    await Page({ searchParams: Promise.resolve({ selection: "1" }) }); expect(mocks.load).toHaveBeenLastCalledWith("self", []);
    await Page({ searchParams: Promise.resolve({}) }); expect(mocks.load).toHaveBeenLastCalledWith("self", ["self"]);
  });
  it("explique un roster invalide et les fiches insuffisantes, sans révéler les refus des personnes", async () => {
    mocks.load.mockResolvedValue({ ...base, error: "participants_changed", unknownMetadataCount: 1 });
    render(await Page({ searchParams: Promise.resolve({ participants: ["private-user"] }) }));
    expect(screen.getByRole("alert").textContent).toContain("personne devenue inaccessible");
    expect(screen.getByRole("status").textContent).toContain("pas assez de données");
    expect(document.body.textContent).not.toContain("private-user");
  });
  it("affiche le jeu suggéré, le score agrégé et la capacité inconnue", async () => {
    mocks.load.mockResolvedValue({ ...base, suggestions: [{ id: "game", name: "Jeu conseillé", preferredByCount: 1, capacityKnown: false }], totalSuggestions: 1 });
    render(await Page({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("link", { name: "Jeu conseillé" }).getAttribute("href")).toBe("/jeux/game");
    expect(screen.getByText(/préférences de 1 participant/)).toBeTruthy(); expect(screen.getByText(/Capacité en joueurs à vérifier/)).toBeTruthy();
  });
});
