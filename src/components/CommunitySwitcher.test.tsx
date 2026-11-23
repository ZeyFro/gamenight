// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const { change, replace, refresh } = vi.hoisted(() => ({ change: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/serveurs/actions", () => ({ changeCommunityAction: change }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));
import { CommunitySwitcher } from "./CommunitySwitcher";
const communities = [{ id: "a", name: "Vrai nom A", slug: "a" }, { id: "b", name: "Vrai nom B", slug: "b" }];

describe("sélecteur permanent", () => {
  beforeEach(() => { vi.clearAllMocks(); change.mockResolvedValue(true); });
  afterEach(cleanup);
  it("affiche le choix actuel et attend la sauvegarde avant de recharger les données", async () => {
    let finish!: (accepted: boolean) => void;
    change.mockImplementation(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    render(<CommunitySwitcher communities={communities} currentId="a" />);
    const select = screen.getByRole("combobox", { name: "Changer de serveur" }) as HTMLSelectElement;
    expect(select.value).toBe("a");
    await userEvent.selectOptions(select, "b");
    expect(change).toHaveBeenCalledWith("b");
    expect(select.disabled).toBe(true);
    expect(replace).not.toHaveBeenCalled();
    finish(true);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("refus d'appartenance : affiche l'erreur et revalide l'accès sans naviguer", async () => {
    change.mockResolvedValue(false);
    render(<CommunitySwitcher communities={communities} currentId="a" />);
    await userEvent.selectOptions(screen.getByRole("combobox"), "b");
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("plus accessible");
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("un seul serveur reste visible et choisi automatiquement", () => {
    render(<CommunitySwitcher communities={communities.slice(0, 1)} currentId="a" />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe("a");
    expect(select.disabled).toBe(true);
    expect(screen.getByText("Vrai nom A")).toBeTruthy();
  });
});

describe("icône du serveur : jamais d'image cassée", () => {
  afterEach(cleanup);
  const withIcon = [{ id: "a", name: "The Tower", slug: "a", discordGuildId: "123", iconHash: "abc" }] as never;
  it("sans iconHash : l'initiale du serveur dans un rond, aucune image", () => {
    const { container } = render(<CommunitySwitcher communities={communities} currentId="a" />);
    expect(screen.getByTestId("community-icon-fallback").textContent).toBe("V");
    expect(container.querySelector("img")).toBeNull();
  });
  it("avec un iconHash : l'image Discord est affichée", () => {
    const { container } = render(<CommunitySwitcher communities={withIcon} currentId="a" />);
    expect(container.querySelector("img")?.getAttribute("src")).toContain("/icons/123/abc.png");
    expect(screen.queryByTestId("community-icon-fallback")).toBeNull();
  });
  it("image en erreur (hash périmé, 404) : repli sur l'initiale, plus d'image cassée", () => {
    const { container } = render(<CommunitySwitcher communities={withIcon} currentId="a" />);
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByTestId("community-icon-fallback").textContent).toBe("T");
  });
  it("aucun serveur courant : aucune icône", () => {
    const { container } = render(<CommunitySwitcher communities={communities} currentId={null} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByTestId("community-icon-fallback")).toBeNull();
  });
});
