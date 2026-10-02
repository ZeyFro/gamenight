// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/app/profil/actions", () => ({
  setBannerUrlAction: vi.fn(),
  uploadBannerAction: vi.fn(),
}));

import { BannerForm } from "./BannerForm";
import { BANNER_HOST_MESSAGE, BANNER_HTTPS_MESSAGE } from "@/lib/banner-url";

afterEach(cleanup);

const saveButton = () => screen.getByRole("button", { name: "Enregistrer la bannière" });

/**
 * Liste blanche des bannières : appliquée à l'ÉCRITURE uniquement. Une
 * bannière déjà en base sur un ancien hôte (ou en http) s'affiche comme
 * avant dans le formulaire, sans erreur ; seule une NOUVELLE saisie est
 * contrôlée.
 */
describe("BannerForm — anciennes bannières hors liste blanche", () => {
  it.each([
    ["autre hôte", "https://ancien-hebergeur.example/banniere.png"],
    ["http", "http://i.imgur.com/ancienne.png"],
  ])("valeur déjà en base (%s) : aucune erreur, bouton actif", (_label, legacy) => {
    render(<BannerForm initialUrl={legacy} uploadEnabled={false} />);

    expect(screen.queryByText(BANNER_HOST_MESSAGE)).toBeNull();
    expect(screen.queryByText(BANNER_HTTPS_MESSAGE)).toBeNull();
    expect(screen.getByRole("textbox")).toHaveProperty("value", legacy);
    expect(saveButton()).toHaveProperty("disabled", false);
  });

  it("nouvelle saisie hors liste blanche : erreur affichée, enregistrement bloqué", async () => {
    render(<BannerForm initialUrl="https://ancien-hebergeur.example/banniere.png" uploadEnabled={false} />);

    const input = screen.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "https://evil.example/p.gif");

    expect(screen.getByText(BANNER_HOST_MESSAGE)).toBeTruthy();
    expect(saveButton()).toHaveProperty("disabled", true);
  });
});
