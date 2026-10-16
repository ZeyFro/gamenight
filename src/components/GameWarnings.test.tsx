// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ update: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/jeux/warning-actions", () => ({ updateGameWarnings: mocks.update }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import { GameWarnings } from "./GameWarnings";
import { GameWarningsForm } from "./GameWarningsForm";
beforeEach(() => { vi.clearAllMocks(); mocks.update.mockResolvedValue({ ok: true }); });
afterEach(cleanup);
describe("avertissements affichés et modifiables", () => {
  it("distingue inconnu, présence et absence déclarée, et échappe les langues", () => {
    const { rerender } = render(<GameWarnings game={{}} />);
    expect(screen.getAllByText("Non renseigné")).toHaveLength(2);
    expect(screen.queryByText("Absence déclarée")).toBeNull();
    rerender(<GameWarnings game={{ jumpscares: true, motionSickness: false, textLanguages: "<script>test</script>", warningsUpdatedAt: "2026-10-15T12:00:00Z" }} />);
    expect(screen.getByText("Présence signalée")).toBeTruthy(); expect(screen.getByText("Absence déclarée")).toBeTruthy();
    expect(screen.getByText("<script>test</script>")).toBeTruthy(); expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText(/15\/10\/2026/)).toBeTruthy();
  });
  it("envoie les valeurs préremplies puis permet d'effacer et actualise après succès", async () => {
    render(<GameWarningsForm game={{ id: "g", jumpscares: true, motionSickness: false, textLanguages: "français" }} />);
    fireEvent.click(screen.getByText("Renseigner les avertissements et langues"));
    expect((screen.getByLabelText("Jumpscares") as HTMLSelectElement).value).toBe("present");
    fireEvent.change(screen.getByLabelText("Jumpscares"), { target: { value: "unknown" } });
    fireEvent.change(screen.getByLabelText("Langues des textes"), { target: { value: "" } });
    fireEvent.submit(screen.getByRole("button", { name: "Enregistrer les avertissements" }).closest("form")!);
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    const submitted = mocks.update.mock.calls[0][0] as FormData;
    expect(Object.fromEntries(submitted)).toEqual({ gameId: "g", jumpscares: "unknown", motionSickness: "absent", textLanguages: "", audioLanguages: "" });
    expect(screen.getByRole("status").textContent).toContain("enregistrées");
  });
  it("affiche l'échec serveur et la panne réseau sans annoncer de réussite", async () => {
    render(<GameWarningsForm game={{ id: "g" }} />); fireEvent.click(screen.getByText("Renseigner les avertissements et langues"));
    const form = screen.getByRole("button", { name: "Enregistrer les avertissements" }).closest("form")!;
    mocks.update.mockResolvedValue({ ok: false, error: "access" }); fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("encore posséder"));
    mocks.update.mockRejectedValue(Error("network")); fireEvent.submit(form);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Enregistrement impossible")); expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
