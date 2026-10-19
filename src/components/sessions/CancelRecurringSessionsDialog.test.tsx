// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ cancel: vi.fn() }));
vi.mock("@/app/sessions/actions/session-lifecycle", () => ({ cancelRecurringSessionsAction: mocks.cancel }));
import { CancelRecurringSessionsDialog } from "./CancelRecurringSessionsDialog";

afterEach(cleanup);
beforeEach(() => { mocks.cancel.mockReset(); });

describe("confirmation d’annulation des occurrences futures", () => {
  it("n’annule rien en ouvrant puis fermant le dialogue", async () => {
    const user = userEvent.setup(); render(<CancelRecurringSessionsDialog sessionId="source" />);
    await user.click(screen.getByRole("button", { name: "Annuler la suite de la série" }));
    expect(screen.getByRole("dialog").textContent).toContain("passées ou terminées restent conservées");
    await user.click(screen.getByRole("button", { name: "Revenir" }));
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
  it("envoie uniquement la soirée source après confirmation et bloque le double clic", async () => {
    let finish!: (state: { error: string | null }) => void;
    mocks.cancel.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup(); render(<CancelRecurringSessionsDialog sessionId="source" />);
    await user.click(screen.getByRole("button", { name: "Annuler la suite de la série" }));
    await user.click(screen.getByRole("button", { name: "Oui, annuler les occurrences à venir" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Annulation…" }) as HTMLButtonElement).disabled).toBe(true));
    await user.click(screen.getByRole("button", { name: "Annulation…" }));
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    const submitted = mocks.cancel.mock.calls[0][1] as FormData;
    expect([...submitted.entries()]).toEqual([["sessionId", "source"]]);
    await act(async () => { finish({ error: null }); });
  });
  it("affiche un refus serveur dans le dialogue", async () => {
    mocks.cancel.mockResolvedValue({ error: "Cette série n’est plus accessible." });
    const user = userEvent.setup(); render(<CancelRecurringSessionsDialog sessionId="source" />);
    await user.click(screen.getByRole("button", { name: "Annuler la suite de la série" }));
    await user.click(screen.getByRole("button", { name: "Oui, annuler les occurrences à venir" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Cette série n’est plus accessible.");
  });
});
