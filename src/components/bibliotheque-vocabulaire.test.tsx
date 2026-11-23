// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const removeUserGame = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/app/actions", () => ({ removeUserGame, toggleGameCoop: vi.fn(), updateGame: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/bibliotheque" }));
vi.mock("@/components/ui/TabLink", () => ({
  TabLink: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import { LibraryTabs, TO_VERIFY_HELP } from "./LibraryTabs";
import { RemoveGameConfirmDialog } from "./RemoveGameConfirmDialog";

afterEach(cleanup);

/** Bug 9 de l'audit du 23/11/2026 : vocabulaire anglais, badge « À vérifier 108 » et poubelle sans confirmation. */
describe("(c) anglicismes visibles remplacés par du français", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  it("les onglets et la barre latérale ne disent plus « Tierlist » ni « Wishlist »", () => {
    for (const path of ["src/components/LibraryTabs.tsx", "src/components/app/Sidebar.tsx", "src/components/PoteTabs.tsx", "src/components/ProfilTabs.tsx"]) {
      expect(read(path), path).not.toMatch(/label: "(Tierlist|Wishlist)"/);
    }
    expect(read("src/components/LibraryTabs.tsx")).toContain('label: "Classement des jeux"');
  });
  it("« streak » devient « série » dans le profil, Potes, le récap et le guide", () => {
    expect(read("src/app/profil/page.tsx")).toContain("Meilleure série");
    expect(read("src/app/profil/layout.tsx")).toContain(">Série<");
    expect(read("src/app/potes/page.tsx")).toContain('label="série"');
    expect(read("src/components/RecapWrapped.tsx")).toContain("Meilleure série");
    expect(read("src/app/guide/page.tsx")).not.toMatch(/\(streak,/);
  });
  it("titres d'onglet et textes : « À acheter » à la place de « Wishlist », base de jeux à la place d'IGDB dans les formulaires", () => {
    expect(read("src/app/wishlist/page.tsx")).toContain('pageMetadata("À acheter")');
    expect(read("src/components/wishlist/WishlistProposeForm.tsx")).toContain("dans la base de jeux");
    expect(read("src/components/AjouterJeuForm.tsx")).not.toMatch(/Résultats IGDB|Correspondance IGDB/);
  });
});

describe("(d) badge « À vérifier » expliqué", () => {
  it("108 jeux : le badge garde son chiffre et porte une infobulle et un texte pour lecteur d'écran qui disent quoi faire", () => {
    const { container } = render(<LibraryTabs active="perso" toVerifyCount={108} />);
    const badge = container.querySelector(`[title="${TO_VERIFY_HELP.replace(/"/g, '\\"')}"]`);
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("108");
    expect(screen.getByText(/108 jeux à vérifier\./)).toBeTruthy();
    expect(TO_VERIFY_HELP).toMatch(/mode de jeu.*pas encore confirmé.*ouvre l'onglet/);
  });
  it("sans jeu à vérifier : aucun badge", () => {
    const { container } = render(<LibraryTabs active="perso" toVerifyCount={0} />);
    expect(container.querySelector("[title]")).toBeNull();
  });
  it("la page « À vérifier » explique le terme", () => {
    const page = readFileSync("src/app/bibliotheque/a-verifier/page.tsx", "utf8");
    expect(page).toContain("« À vérifier » = des jeux dont on ne sait pas encore");
  });
});

describe("(e) la poubelle demande confirmation avant de retirer le jeu", () => {
  it("un clic sur la poubelle ouvre une confirmation et ne retire rien", () => {
    removeUserGame.mockClear();
    render(<RemoveGameConfirmDialog gameId="g1" gameName="Valheim" />);
    fireEvent.click(screen.getByRole("button", { name: "Retirer Valheim de ma bibliothèque" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("Retirer Valheim ?")).toBeTruthy();
    expect(removeUserGame).not.toHaveBeenCalled();
  });
  it("« Annuler » ferme sans retirer", async () => {
    removeUserGame.mockClear();
    render(<RemoveGameConfirmDialog gameId="g1" gameName="Valheim" />);
    fireEvent.click(screen.getByRole("button", { name: "Retirer Valheim de ma bibliothèque" }));
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(removeUserGame).not.toHaveBeenCalled();
  });
  it("« Retirer » dans la confirmation appelle l'action avec l'identifiant du jeu", async () => {
    removeUserGame.mockClear();
    render(<RemoveGameConfirmDialog gameId="g1" gameName="Valheim" />);
    fireEvent.click(screen.getByRole("button", { name: "Retirer Valheim de ma bibliothèque" }));
    fireEvent.click(screen.getByRole("button", { name: "Retirer" }));
    await waitFor(() => expect(removeUserGame).toHaveBeenCalledTimes(1));
    const data = (removeUserGame.mock.calls[0] as unknown as [FormData])[0];
    expect(data.get("gameId")).toBe("g1");
  });
  it("la grille de la bibliothèque n'a plus de formulaire de retrait direct", () => {
    const grid = readFileSync("src/components/BibliothequeGrid.tsx", "utf8");
    expect(grid).toContain("<RemoveGameConfirmDialog");
    expect(grid).not.toContain("action={removeUserGame}");
  });
});
