// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MessageTemplateForm } from "./MessageTemplateForm";
import { MAX_MESSAGE_TEXT_LENGTH } from "@/lib/message-templates";

afterEach(cleanup);

const footer = <button type="submit">Enregistrer</button>;
const renderForm = (initialText: string, action = vi.fn()) =>
  render(<MessageTemplateForm action={action} idPrefix="t" initialText={initialText} initialCategories={["SESSION_CREATED"]} footer={footer} />);
const save = () => screen.getByRole("button", { name: "Enregistrer" });
// Le bouton est désactivé via `<fieldset disabled>` : seule la pseudo-classe :disabled le reflète.
const isBlocked = () => save().matches(":disabled");

/** Limite de longueur appliquée à l'ÉCRITURE : un ancien modèle trop long s'ouvre sans être tronqué. */
describe("MessageTemplateForm — longueur maximale", () => {
  it("texte à la limite : aucun message, enregistrement possible", () => {
    renderForm("a".repeat(MAX_MESSAGE_TEXT_LENGTH));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBeNull();
    expect(isBlocked()).toBe(false);
  });

  it("ancien modèle au-dessus de la limite : s'ouvre intact, message explicite, enregistrement bloqué", () => {
    const legacy = "a".repeat(MAX_MESSAGE_TEXT_LENGTH + 40);
    renderForm(legacy);
    const box = screen.getByRole("textbox");
    expect(box).toHaveProperty("value", legacy);
    expect(screen.getByRole("alert").textContent).toContain("avant cette limite");
    // Le compteur est hors de l'alerte (sinon ré-annoncé à chaque frappe) et relié au champ.
    expect(screen.getByRole("alert").textContent).not.toContain(String(legacy.length));
    expect(screen.getByTestId("message-length").textContent).toContain(`${legacy.length} / ${MAX_MESSAGE_TEXT_LENGTH}`);
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(box.getAttribute("aria-describedby")).toBe("t-too-long");
    expect(isBlocked()).toBe(true);
  });

  it("saisie qui dépasse la limite : message explicite, puis déblocage une fois raccourci", async () => {
    renderForm("a".repeat(MAX_MESSAGE_TEXT_LENGTH));
    const box = screen.getByRole("textbox");
    await userEvent.type(box, "b");
    expect(screen.getByRole("alert").textContent).toContain("Raccourcis-le");
    expect(isBlocked()).toBe(true);

    await userEvent.type(box, "{backspace}");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(isBlocked()).toBe(false);
  });

  it("un envoi forcé d'un texte trop long n'appelle pas l'action serveur (preventDefault)", async () => {
    const action = vi.fn();
    const { container } = renderForm("a".repeat(MAX_MESSAGE_TEXT_LENGTH + 1), action);
    fireEvent.submit(container.querySelector("form")!);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(action).not.toHaveBeenCalled();
  });

  it("un envoi d'un texte à la limite appelle l'action serveur", async () => {
    const action = vi.fn();
    const { container } = renderForm("a".repeat(MAX_MESSAGE_TEXT_LENGTH), action);
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });
});
