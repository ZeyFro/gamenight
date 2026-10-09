// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OnboardingFlow } from "./OnboardingFlow";
import { OnboardingPrompt } from "./OnboardingPrompt";

const mocks = vi.hoisted(() => ({ complete: vi.fn(), skip: vi.fn(), refresh: vi.fn(), push: vi.fn(), path: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.path, useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }) }));
vi.mock("@/app/onboarding-actions", () => ({ completeOnboardingAction: mocks.complete, skipSteamOnboardingAction: mocks.skip }));
const empty = { steamLinked: false, steamSkipped: false, planningReady: false, guideCompleted: false };
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); mocks.path = "/"; });
afterEach(cleanup);

describe("guide assisté : pas de validation fictive", () => {
  it("propose la vraie liaison Steam et le planning sans marquer terminé au clic Suivant", () => {
    render(<OnboardingFlow progress={empty} />);
    expect(screen.getByRole("link", { name: "Lier mon compte Steam" }).getAttribute("href")).toBe("/api/steam/link");
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    expect(screen.getByRole("link", { name: "Renseigner mon planning" }).getAttribute("href")).toBe("/disponibilites");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    expect(mocks.complete).not.toHaveBeenCalled();
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    expect(screen.getByRole("button", { name: "Terminer le guide" })).toHaveProperty("disabled", true);
  });
  it("reprend directement au planning si Steam est déjà lié", () => {
    render(<OnboardingFlow progress={{ ...empty, steamLinked: true }} />);
    expect(screen.getByRole("heading", { name: "Ton planning" })).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1");
  });
  it("persiste le choix sans Steam avant de poursuivre, et montre un échec", async () => {
    mocks.skip.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<OnboardingFlow progress={empty} />);
    fireEvent.click(screen.getByRole("button", { name: "Je n’utilise pas Steam" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(mocks.refresh).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Je n’utilise pas Steam" })).toHaveProperty("disabled", false));
    fireEvent.click(screen.getByRole("button", { name: "Je n’utilise pas Steam" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("heading", { name: "Ton planning" })).toBeTruthy();
  });
  it("un lien de MP planning sélectionne l'étape demandée", () => {
    render(<OnboardingFlow progress={empty} initialStep="planning" />);
    expect(screen.getByRole("heading", { name: "Ton planning" })).toBeTruthy();
  });
  it("la fin exige aussi l'accord de l'action serveur", async () => {
    mocks.complete.mockResolvedValue(false);
    render(<OnboardingFlow progress={{ ...empty, steamLinked: true, planningReady: true }} />);
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole("button", { name: "Suivant" }));
    fireEvent.click(screen.getByRole("button", { name: "Terminer le guide" }));
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledTimes(1));
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

describe("popup de connexion", () => {
  it("s'ouvre pour un ancien compte ayant passé le guide mais un profil incomplet", async () => {
    render(<OnboardingPrompt userId="a" progress={{ ...empty, guideCompleted: true }} />);
    await screen.findByRole("dialog");
    expect(screen.getByRole("link", { name: "Lier Steam maintenant" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Renseigner mes disponibilités" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Plus tard/ }));
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("gn:onboarding-prompt:a")).toBe("later");
    expect(screen.getByRole("button", { name: "Compléter mon profil" })).toBeTruthy();
  });
  it("ne recouvre pas l'écran où la personne renseigne son planning", () => {
    mocks.path = "/disponibilites";
    render(<OnboardingPrompt userId="a" progress={empty} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("un profil entièrement terminé n'affiche plus de popup", () => {
    render(<OnboardingPrompt userId="a" progress={{ ...empty, steamSkipped: true, planningReady: true, guideCompleted: true }} />);
    expect(screen.queryByRole("button", { name: "Compléter mon profil" })).toBeNull();
  });
});
