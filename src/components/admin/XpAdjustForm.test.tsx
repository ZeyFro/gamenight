// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { adjustPlayerXpAction, refresh } = vi.hoisted(() => ({ adjustPlayerXpAction: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/admin/joueurs/actions", () => ({ adjustPlayerXpAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { XpAdjustForm } from "./XpAdjustForm";

const props = { communityId: "c1", communityName: "Serveur test", userId: "u1", userName: "Titouan", currentXp: 1596 };
beforeEach(() => { vi.clearAllMocks(); adjustPlayerXpAction.mockResolvedValue({ ok: true }); });
afterEach(cleanup);

describe("XpAdjustForm", () => {
  it("bouton désactivé tant que la valeur est vide, invalide ou identique au solde", () => {
    render(<XpAdjustForm {...props} />);
    const button = screen.getByRole("button", { name: /Corriger l'XP/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true); // valeur initiale = solde actuel
    const input = screen.getByLabelText(/Nouvelle valeur d'XP/);
    for (const bad of ["", "abc", "-3", "1.5", "99999999"]) {
      fireEvent.change(input, { target: { value: bad } });
      expect(button.disabled, bad).toBe(true);
    }
    fireEvent.change(input, { target: { value: "500" } });
    expect(button.disabled).toBe(false);
  });

  it("confirmation : montre avant → après avec niveau et rang, puis envoie les champs attendus", async () => {
    render(<XpAdjustForm {...props} />);
    fireEvent.change(screen.getByLabelText(/Nouvelle valeur d'XP/), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText(/Raison/), { target: { value: " abus " } });
    fireEvent.click(screen.getByRole("button", { name: /Corriger l'XP/ }));

    expect(await screen.findByText(/Corriger l'XP de Titouan/)).toBeTruthy();
    expect(screen.getByText(/1\s?596 XP · niveau 6/)).toBeTruthy();
    expect(screen.getByText(/500 XP · niveau 4/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Confirmer" }));
    await vi.waitFor(() => expect(adjustPlayerXpAction).toHaveBeenCalledOnce());
    const sent = adjustPlayerXpAction.mock.calls[0][0] as FormData;
    expect(Object.fromEntries(sent.entries())).toEqual({
      userId: "u1", communityId: "c1", expectedOldXp: "1596", newXp: "500", reason: " abus ",
    });
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("Annuler n'envoie rien", async () => {
    render(<XpAdjustForm {...props} />);
    fireEvent.change(screen.getByLabelText(/Nouvelle valeur d'XP/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /Corriger l'XP/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Annuler" }));
    expect(adjustPlayerXpAction).not.toHaveBeenCalled();
  });
});
