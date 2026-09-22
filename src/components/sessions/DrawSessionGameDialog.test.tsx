// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { drawSessionGameActionMock } = vi.hoisted(() => ({
  drawSessionGameActionMock: vi.fn(),
}));

vi.mock("@/app/sessions/actions/draw", () => ({
  drawSessionGameAction: drawSessionGameActionMock,
}));

// `next/navigation`'s `useRouter` — appelé par le composant (`router.refresh()`
// après un tirage réussi), absent en dehors d'un vrai routeur Next.
const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefresh }) }));

import { DrawSessionGameDialog } from "./DrawSessionGameDialog";

afterEach(cleanup);

/**
 * V2 — remplace le lien "🎰 Roulette" cassé. Ces tests vérifient le
 * comportement DOM RÉEL (jsdom + Testing Library, même infrastructure que
 * DeleteTournamentDialog.test.tsx, #105) — la logique métier (éligibilité,
 * tirage, concurrence) est couverte séparément contre une vraie base
 * Postgres (session-announce.integration.test.ts).
 */
describe("DrawSessionGameDialog", () => {
  beforeEach(() => {
    drawSessionGameActionMock.mockReset();
    routerRefresh.mockReset();
  });

  const baseProps = {
    sessionId: "session-1",
    sessionDateLabel: "samedi 1 octobre 2026 à 20:00",
    groupLabel: "Toi + Alice, Bob",
    soundEnabled: false,
  };

  it("aucun jeu éligible : message explicatif, AUCUN bouton de confirmation — jamais de mutation possible depuis cet état", async () => {
    const user = userEvent.setup();
    render(<DrawSessionGameDialog {...baseProps} candidates={[]} />);

    await user.click(screen.getByRole("button", { name: "🎲 Tirer un jeu au sort" }));

    expect(await screen.findByText(/Aucun jeu proposé n'est actuellement jouable/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Lancer le tirage/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Valider/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Retour aux propositions" })).toBeTruthy();
    expect(drawSessionGameActionMock).not.toHaveBeenCalled();
  });

  it("plusieurs jeux éligibles : l'aperçu affiche la roue avec les noms COMPLETS de chaque candidat (légende #105), avant toute confirmation", async () => {
    const user = userEvent.setup();
    render(
      <DrawSessionGameDialog
        {...baseProps}
        candidates={[
          { id: "g1", name: "Catan", coverUrl: null },
          { id: "g2", name: "Among Us", coverUrl: null },
          { id: "g3", name: "Codenames", coverUrl: null },
        ]}
      />
    );
    await user.click(screen.getByRole("button", { name: "🎲 Tirer un jeu au sort" }));

    // Le nom complet de chaque candidat apparaît au moins deux fois (le
    // libellé SUR la roue, tronqué possible, ET la légende en texte
    // intégral, #105) — `getAllByText` plutôt que `findByText` (qui
    // échoue sur plusieurs correspondances).
    await waitFor(() => expect(screen.getAllByText("Catan").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Among Us").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Codenames").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Lancer le tirage" })).toBeTruthy();
    expect(drawSessionGameActionMock).not.toHaveBeenCalled(); // aperçu seul, aucune mutation
  });

  it("un clic unique sur la confirmation appelle l'action UNE SEULE FOIS et désactive immédiatement le bouton — un second clic pendant l'appel reste sans effet", async () => {
    let resolveAction!: (value: unknown) => void;
    drawSessionGameActionMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        })
    );

    const user = userEvent.setup();
    render(
      <DrawSessionGameDialog
        {...baseProps}
        candidates={[{ id: "g1", name: "Catan", coverUrl: null }]}
      />
    );
    await user.click(screen.getByRole("button", { name: "🎲 Tirer un jeu au sort" }));

    const confirmButton = await screen.findByRole("button", { name: "Valider Catan" });
    await user.click(confirmButton);

    await waitFor(() => {
      const pendingButton = screen.getByRole("button", { name: /Tirage…/ }) as HTMLButtonElement;
      expect(pendingButton.disabled).toBe(true);
    });

    // Second clic pendant que l'appel est TOUJOURS en vol — le bouton
    // étant désactivé, aucun second appel ne doit se produire.
    await user.click(screen.getByRole("button", { name: /Tirage…/ }));
    expect(drawSessionGameActionMock).toHaveBeenCalledTimes(1);

    resolveAction({ status: "no_eligible_game" });
  });

  it("résultat à un seul candidat : révèle directement le jeu retenu, SANS animation de roue (jamais un hasard trompeur pour un résultat jamais incertain)", async () => {
    drawSessionGameActionMock.mockResolvedValue({
      status: "drawn",
      winnerGameId: "g1",
      winnerGameName: "Catan",
      winnerGameCoverUrl: null,
      candidates: [{ id: "g1", name: "Catan", coverUrl: null }],
    });

    const user = userEvent.setup();
    render(
      <DrawSessionGameDialog
        {...baseProps}
        candidates={[{ id: "g1", name: "Catan", coverUrl: null }]}
      />
    );
    await user.click(screen.getByRole("button", { name: "🎲 Tirer un jeu au sort" }));
    await user.click(await screen.findByRole("button", { name: "Valider Catan" }));

    // Résultat lisible en TEXTE, jamais seulement via la couleur/l'animation.
    expect(await screen.findByText("🎉 Vote clos — soirée validée !")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Voir la soirée" })).toBeTruthy();
    // Aucun message "La roue tourne…" — le résultat était déjà certain.
    expect(screen.queryByText("La roue tourne…")).toBeNull();
  });

  it("soirée déjà décidée entre-temps (course perdue) : message honnête, jamais une erreur générique ni un résultat inventé", async () => {
    drawSessionGameActionMock.mockResolvedValue({ status: "already_decided" });

    const user = userEvent.setup();
    render(
      <DrawSessionGameDialog
        {...baseProps}
        candidates={[{ id: "g1", name: "Catan", coverUrl: null }]}
      />
    );
    await user.click(screen.getByRole("button", { name: "🎲 Tirer un jeu au sort" }));
    await user.click(await screen.findByRole("button", { name: "Valider Catan" }));

    expect(await screen.findByText(/déjà été décidée/)).toBeTruthy();
    const viewButton = screen.getByRole("button", { name: "Voir l'état actuel" });
    await user.click(viewButton);
    expect(routerRefresh).toHaveBeenCalledTimes(1);
  });
});
