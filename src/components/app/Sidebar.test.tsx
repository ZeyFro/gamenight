// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
vi.mock("next/navigation", () => ({ usePathname: () => "/bibliotheque/groupe" }));
vi.mock("./MotionBackground", () => ({ MotionToggle: () => <button>Animations</button> }));
import { SIDEBAR_GROUPS, Sidebar, activeSidebarHref, sidebarGroups } from "./Sidebar";
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
  // « Classement » n'est plus dans la barre basse : son accès mobile validé
  // est le tiroir, à un tap depuis le bouton de menu.
  it("garde « Classement » joignable en un tap depuis le menu mobile", async () => {
    render(<Sidebar user={{ name: "Joueur", avatar: null, level: 4, xp: 650 }} />);
    await userEvent.click(screen.getByRole("button", { name: "Ouvrir le menu" }));
    const dialog = screen.getByRole("dialog");
    const link = within(dialog).getByRole("link", { name: "Classement" });
    expect(link.getAttribute("href")).toBe("/classement");
    expect(within(dialog).getByRole("navigation", { name: "Navigation mobile" })).toBeTruthy();
  });
});

// V3-15 : « The Tower » n'entre dans la navigation que derrière NAV_TOWER_ENABLED (prop `towerLink`).
describe("lien « The Tower » (V3-15)", () => {
  const user = { name: "Joueur", avatar: null, level: 4, xp: 650 };

  it("éteint : aucun lien et les groupes sont exactement ceux d'avant", async () => {
    expect(sidebarGroups(false)).toBe(SIDEBAR_GROUPS);
    render(<Sidebar user={user} />);
    expect(within(screen.getByRole("navigation", { name: "Navigation principale" })).queryByRole("link", { name: "The Tower" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Ouvrir le menu" }));
    expect(within(screen.getByRole("dialog")).queryByRole("link", { name: "The Tower" })).toBeNull();
  });

  it("allumé : le lien est dans la barre latérale (groupe La communauté) et dans le menu mobile", async () => {
    render(<Sidebar user={user} towerLink />);
    const desktop = within(screen.getByRole("navigation", { name: "Navigation principale" }));
    expect(desktop.getByRole("link", { name: "The Tower" }).getAttribute("href")).toBe("/tower");
    const community = sidebarGroups(true).find(({ label }) => label === "La communauté");
    expect(community?.links.map(({ label }) => label)).toEqual(["Potes", "The Tower", "Classement", "Mon profil"]);
    await userEvent.click(screen.getByRole("button", { name: "Ouvrir le menu" }));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("link", { name: "The Tower" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("allumé : /tower et ses sous-pages activent le lien, sans toucher les autres groupes", () => {
    const groups = sidebarGroups(true);
    expect(activeSidebarHref("/tower", groups)).toBe("/tower");
    expect(activeSidebarHref("/tower/propositions", groups)).toBe("/tower");
    expect(activeSidebarHref("/tower", SIDEBAR_GROUPS)).toBeUndefined();
    expect(groups.filter(({ label }) => label !== "La communauté")).toEqual(SIDEBAR_GROUPS.filter(({ label }) => label !== "La communauté"));
  });

  it("la barre basse mobile reste à six onglets sans The Tower", async () => {
    const { NAV_LINKS } = await import("@/components/nav-links");
    expect(NAV_LINKS).toHaveLength(6);
    expect(NAV_LINKS.map(({ href }) => String(href))).not.toContain("/tower");
  });
});
