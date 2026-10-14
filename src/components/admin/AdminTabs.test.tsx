// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AdminTabs, ADMIN_TAB_KEYS } from "./AdminTabs";

afterEach(cleanup);

describe("AdminTabs — Communautés", () => {
  it("reconnaît la clé de route et affiche le lien quand le flag est activé", () => {
    expect(ADMIN_TAB_KEYS).toContain("communautes");

    render(<AdminTabs active="communautes" showCommunities />);

    expect(screen.getByRole("link", { name: "Communautés" }).getAttribute("href"))
      .toBe("/admin?tab=communautes");
  });

  it("masque le lien quand le flag est désactivé", () => {
    render(<AdminTabs active="messages" showCommunities={false} />);

    expect(screen.queryByRole("link", { name: "Communautés" })).toBeNull();
  });
});

describe("AdminTabs — Joueurs", () => {
  it("affiche l'onglet « Joueurs » sans dépendre d'un drapeau, sans retirer les autres onglets", () => {
    expect(ADMIN_TAB_KEYS).toContain("joueurs");

    render(<AdminTabs active="joueurs" />);

    expect(screen.getByRole("link", { name: "Joueurs" }).getAttribute("href")).toBe("/admin?tab=joueurs");
    for (const label of ["Messages Discord", "Récompenses", "Badges", "Jeux-stats", "Réglages", "Confidentialité", "Nettoyage"]) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }
  });
});
