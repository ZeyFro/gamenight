// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteTournamentDialog } from "./DeleteTournamentDialog";

// Pas de `globals: true` dans vitest.config.mts (délibéré, voir son
// commentaire) — `cleanup()` de Testing Library ne se déclenche donc
// jamais tout seul entre deux tests : sans cet appel explicite, le
// dialogue Radix resté "open" d'un test laisse le body en
// `pointer-events: none` (scroll-lock) pour le test suivant.
afterEach(cleanup);

const { deleteTournamentActionMock } = vi.hoisted(() => ({
  deleteTournamentActionMock: vi.fn(),
}));

vi.mock("@/app/tournois/actions", () => ({
  deleteTournamentAction: deleteTournamentActionMock,
}));

/**
 * Bug remonté en test réel — après suppression d'un tournoi, aucune
 * redirection ne se produisait et la page devenait incohérente (F5
 * nécessaire). La cause démontrée était une course CÔTÉ CLIENT : sans
 * protection contre le double clic, un second appel de
 * `deleteTournamentAction` (déclenché pendant que le premier était
 * encore en vol) trouvait le tournoi déjà supprimé et se terminait SANS
 * `redirect()` — deux résolutions concurrentes d'une même transition
 * React laissant le client incohérent.
 *
 * Les tests unitaires de `actions.cancel-delete.test.ts` (l'action
 * serveur redirige bien pour un succès) et d'intégration
 * (`tournament-announce.integration.test.ts`, la course
 * base/Discord) prouvent chacun UNE moitié du problème, mais AUCUN des
 * deux ne vérifie le comportement RÉEL du composant client face à un
 * clic — c'est spécifiquement ce que ce fichier couvre, avec un DOM réel
 * (jsdom + Testing Library, premier composant testé ainsi dans ce
 * dépôt — voir vitest.config.mts) plutôt qu'un mock de haut niveau.
 *
 * Limite assumée : `redirect()` (App Router) est une primitive
 * SERVEUR + navigateur — son interception réelle (digest
 * `NEXT_REDIRECT` traduit en navigation AVANT même d'atteindre le
 * rendu React côté client) n'existe pas dans ce DOM simulé. Ce fichier
 * prouve donc le MÉCANISME CONCRET qui a corrigé le bug (un clic ne
 * peut plus jamais en déclencher un second), pas le rendu final de la
 * page `/tournois` — cette dernière étape reste hors de portée dans cet
 * environnement (pas d'app Next.js réelle authentifiée, voir docs/archive/README_IMPLEMENTATION_HISTORY_2026-10.md).
 */
describe("DeleteTournamentDialog — protection contre le double clic (bug remonté en test réel : page bloquée après suppression)", () => {
  beforeEach(() => {
    deleteTournamentActionMock.mockReset();
  });

  async function openDialogAndGetConfirmButton() {
    const user = userEvent.setup();
    render(<DeleteTournamentDialog tournamentId="tournoi-1" />);
    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    const confirmButton = await screen.findByRole("button", { name: "Oui, supprimer" });
    return { user, confirmButton };
  }

  it("un clic unique sur 'Oui, supprimer' appelle l'action UNE SEULE FOIS, et désactive immédiatement le bouton — un second clic pendant l'appel reste physiquement sans effet", async () => {
    let resolveAction!: (value: { error: string | null }) => void;
    deleteTournamentActionMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        })
    );

    const { user, confirmButton } = await openDialogAndGetConfirmButton();

    // Premier clic — déclenche l'action et doit désactiver le bouton
    // AVANT que l'action ne se termine (elle reste volontairement en
    // vol ici, via la promesse non résolue).
    await user.click(confirmButton);
    await waitFor(() => {
      const pendingButton = screen.getByRole("button", { name: /Suppression…/ }) as HTMLButtonElement;
      expect(pendingButton.disabled).toBe(true);
    });

    // Second clic pendant que le premier appel est TOUJOURS en vol —
    // exactement le scénario qui causait la course (deux appels
    // concurrents de deleteTournamentAction). Le bouton étant désactivé,
    // Testing Library ne déclenche même pas l'événement.
    await user.click(screen.getByRole("button", { name: /Suppression…/ }));

    expect(deleteTournamentActionMock).toHaveBeenCalledTimes(1);

    resolveAction({ error: null });
  });

  it("une erreur RÉELLE renvoyée par l'action (tournoi déjà lancé entre-temps, etc.) s'affiche — jamais silencieuse, et le bouton redevient cliquable ensuite (jamais bloqué pour toujours)", async () => {
    deleteTournamentActionMock.mockResolvedValue({
      error: "Ce tournoi a déjà démarré (ou a été supprimé) entre l'ouverture de cette fenêtre et ta confirmation — impossible de le supprimer maintenant.",
    });

    const { user, confirmButton } = await openDialogAndGetConfirmButton();
    await user.click(confirmButton);

    await screen.findByText(/Ce tournoi a déjà démarré/);
    expect(deleteTournamentActionMock).toHaveBeenCalledTimes(1);

    const buttonAfterFailure = (await screen.findByRole("button", {
      name: "Oui, supprimer",
    })) as HTMLButtonElement;
    expect(buttonAfterFailure.disabled).toBe(false);
  });
});
