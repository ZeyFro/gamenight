// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/bibliotheque" }));

import { BottomNav } from "./BottomNav";
import { NAV_LINKS } from "./nav-links";

afterEach(cleanup);

describe("barre de navigation mobile", () => {
  it("donne un retour à l'accueil en première position", () => {
    render(<BottomNav />);
    const nav = screen.getByRole("navigation", { name: "Navigation principale" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(NAV_LINKS.map(({ href }) => href));
    expect(links[0].getAttribute("href")).toBe("/");
    expect(links[0].textContent).toContain("Accueil");
    expect(links).toHaveLength(6);
  });

  it("signale la page courante par aria-current et un repère visible, jamais par la couleur seule", () => {
    render(<BottomNav />);
    const nav = screen.getByRole("navigation", { name: "Navigation principale" });
    const active = within(nav).getByRole("link", { name: "Jeux, Bibliothèque" });
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(active.querySelector('[class*="bg-accent"]')).not.toBeNull();
    for (const link of within(nav).getAllByRole("link")) {
      if (link === active) continue;
      expect(link.getAttribute("aria-current")).toBeNull();
      expect(link.querySelector('[class*="bg-accent"]')).toBeNull();
    }
  });

  it("garde le libellé complet dans le nom accessible du lien abrégé", () => {
    render(<BottomNav />);
    const nav = screen.getByRole("navigation", { name: "Navigation principale" });
    const library = within(nav).getByRole("link", { name: "Jeux, Bibliothèque" });
    expect(library.textContent).toContain("Jeux");
    expect(library.textContent).toContain("Bibliothèque");
  });
});
