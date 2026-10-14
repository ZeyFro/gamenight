// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
vi.mock("next/navigation", () => ({ usePathname: () => "/bibliotheque/groupe" }));
vi.mock("./MotionBackground", () => ({ MotionToggle: () => <button>Animations</button> }));
import { Sidebar, activeSidebarHref } from "./Sidebar";
afterEach(cleanup);

describe("navigation complète desktop/mobile", () => {
  it("un seul lien actif, le plus précis, avec les cinq entrées bibliothèque", () => {
    render(<Sidebar user={{ name: "Joueur", avatar: null, level: 4, xp: 650 }} />);
    const nav = within(screen.getByRole("navigation", { name: "Navigation principale" }));
    expect(nav.getByRole("link", { name: "Bibliothèque du groupe" }).getAttribute("aria-current")).toBe("page");
    expect(nav.getByRole("link", { name: "Ma bibliothèque" }).getAttribute("aria-current")).toBeNull();
    for (const name of ["Tierlist", "À acheter", "À vérifier", "Tournois", "Roulette", "Calendrier"]) expect(nav.getByRole("link", { name })).toBeTruthy();
    expect(activeSidebarHref("/profil/badges")).toBe("/profil");
  });
  it("le menu mobile contient les autres parcours et se ferme au choix d'une page", async () => {
    render(<Sidebar user={{ name: "Joueur", avatar: null, level: 4, xp: 650 }} />);
    await userEvent.click(screen.getByRole("button", { name: "Ouvrir le menu" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("link", { name: "Tournois" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
