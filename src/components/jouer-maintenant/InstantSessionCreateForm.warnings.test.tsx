// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
vi.mock("@/components/CreationForm", () => ({ CreationForm: ({ children }: { children: ReactNode }) => <form>{children}</form> }));
vi.mock("@/components/tournois/TournamentGameField", () => ({ TournamentGameField: ({ onSelectedChange }: { onSelectedChange: (value: { id: string; name: string }) => void }) => <>
  <button type="button" onClick={() => onSelectedChange({ id: "local", name: "Local" })}>Choisir local</button>
  <button type="button" onClick={() => onSelectedChange({ id: "new", name: "Nouveau" })}>Choisir nouveau</button>
</> }));
vi.mock("@/components/NotifyRecipientsField", () => ({ NotifyRecipientsField: () => null }));
vi.mock("@/app/jouer-maintenant/actions", () => ({ createInstantSessionAction: vi.fn() }));
import { InstantSessionCreateForm } from "./InstantSessionCreateForm";
afterEach(cleanup);
it("montre les avertissements du jeu choisi avant Démarrer et efface ceux du jeu précédent", () => {
  render(<InstantSessionCreateForm potes={[]} localGames={[{ id: "local", name: "Local", igdbId: null, jumpscares: true, motionSickness: false, textLanguages: "français" }]} />);
  expect((screen.getByRole("button", { name: "Démarrer 🎮" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Choisir local" }));
  const warnings = screen.getByRole("region", { name: "Avertissements et langues" });
  expect(within(warnings).getByText("Présence signalée")).toBeTruthy(); expect(within(warnings).getByText("français")).toBeTruthy();
  expect(warnings.compareDocumentPosition(screen.getByRole("button", { name: "Démarrer 🎮" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Choisir nouveau" }));
  expect(within(warnings).queryByText("Présence signalée")).toBeNull(); expect(within(warnings).getAllByText("Non renseigné")).toHaveLength(2);
});
