// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DesignPreviewHome } from "./DesignPreviewHome";
import { FRIENDS, LEADERBOARD, SHEET_OPTIONS } from "./fake-data";

afterEach(cleanup);

describe("DesignPreviewHome (accueil factice)", () => {
  it("affiche toutes les sections de l'accueil, signalées comme fictives", () => {
    render(<DesignPreviewHome />);
    expect(screen.getByRole("heading", { level: 1, name: /Salut/ })).toBeTruthy();
    expect(screen.getByText(/données fictives/)).toBeTruthy();
    for (const name of ["Prochaine soirée", "XP et rang", "Classement", "Potes en ligne", "Défi de la semaine"]) {
      expect(screen.getByLabelText(name)).toBeTruthy();
    }
  });

  it("liste le classement et les potes à partir des données factices", () => {
    render(<DesignPreviewHome />);
    const board = screen.getByLabelText("Classement");
    expect(board.querySelectorAll("li")).toHaveLength(LEADERBOARD.length);
    expect(screen.getByLabelText("Potes en ligne").querySelectorAll("li")).toHaveLength(FRIENDS.length);
    expect(board.textContent).toContain("toi");
  });

  it("expose deux barres de progression avec leurs valeurs", () => {
    render(<DesignPreviewHome />);
    const bars = screen.getAllByRole("progressbar");
    expect(bars).toHaveLength(2);
    expect(bars[0].getAttribute("aria-valuenow")).toBe("2450");
    expect(bars[0].getAttribute("aria-valuemax")).toBe("3000");
  });

  it("bascule « Je viens » localement (aria-pressed)", async () => {
    render(<DesignPreviewHome />);
    const yes = screen.getByRole("button", { name: "Je viens" });
    expect(yes.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(yes);
    expect(screen.getByRole("button", { name: /Tu viens/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("change d'onglet dans la barre et prévient que seul l'accueil est dessiné", async () => {
    render(<DesignPreviewHome />);
    await userEvent.click(screen.getByRole("button", { name: /Profil/ }));
    const current = screen.getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "page");
    expect(current[0].textContent).toContain("Profil");
    expect(screen.getByRole("status").textContent).toContain("seul l'accueil");
  });

  it("le bouton central ouvre le panneau, Échap le ferme", async () => {
    render(<DesignPreviewHome />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Jouer maintenant" }));
    const dialog = await screen.findByRole("dialog", { name: "Jouer maintenant" });
    expect(dialog.querySelectorAll("li")).toHaveLength(SHEET_OPTIONS.length);
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("choisir une option du panneau le ferme et annonce que c'est une démo", async () => {
    render(<DesignPreviewHome />);
    await userEvent.click(screen.getByRole("button", { name: "Jouer maintenant" }));
    await userEvent.click(await screen.findByRole("button", { name: /Tirer un jeu au sort/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("status").textContent).toContain("Démo");
  });
});
