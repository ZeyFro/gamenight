// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { MessageTemplateForm } from "./MessageTemplateForm";
import { MAX_MESSAGE_TEXT_LENGTH } from "@/lib/message-templates";

afterEach(cleanup);

const footer = <button type="submit">Enregistrer</button>;
const renderForm = (initialText: string) =>
  render(<MessageTemplateForm action={vi.fn()} idPrefix="t" initialText={initialText} initialCategories={["SESSION_CREATED"]} footer={footer} />);
const save = () => screen.getByRole("button", { name: "Enregistrer" });
// Le bouton est désactivé via `<fieldset disabled>` : seule la pseudo-classe :disabled le reflète.
const isBlocked = () => save().matches(":disabled");

/** Limite de longueur appliquée à l'ÉCRITURE : un ancien modèle trop long s'ouvre sans être tronqué. */
describe("MessageTemplateForm — longueur maximale", () => {
  it("texte à la limite : aucun message, enregistrement possible", () => {
    renderForm("a".repeat(MAX_MESSAGE_TEXT_LENGTH));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(isBlocked()).toBe(false);
  });

  it("ancien modèle au-dessus de la limite : s'ouvre intact, message explicite, enregistrement bloqué", () => {
    const legacy = "a".repeat(MAX_MESSAGE_TEXT_LENGTH + 40);
    renderForm(legacy);
    expect(screen.getByRole("textbox")).toHaveProperty("value", legacy);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(`${legacy.length} caractères`);
    expect(alert.textContent).toContain("avant cette limite");
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
});
