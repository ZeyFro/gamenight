// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ value: "/profil" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value }));
import { ProfilHero } from "./ProfilHero";

afterEach(cleanup);
const ui = () => (
  <ProfilHero compact={<p>En-tête compact</p>}>
    <p>Aperçu du profil</p>
  </ProfilHero>
);

describe("ProfilHero", () => {
  it("/profil : l'aperçu complet, pas l'en-tête compact", () => {
    pathname.value = "/profil";
    render(ui());
    expect(screen.getByText("Aperçu du profil")).toBeTruthy();
    expect(screen.queryByText("En-tête compact")).toBeNull();
  });

  it("chaque sous-page ouverte directement : en-tête compact, jamais l'aperçu", () => {
    for (const path of ["/profil/badges", "/profil/historique", "/profil/saisons", "/profil/superlatifs", "/profil/tierlist", "/profil/boutique", "/profil/lore", "/profil/parametres", "/profil/compte", "/profil/personnalisation"]) {
      pathname.value = path;
      render(ui());
      expect(screen.getByText("En-tête compact"), path).toBeTruthy();
      expect(screen.queryByText("Aperçu du profil"), path).toBeNull();
      cleanup();
    }
  });
});
