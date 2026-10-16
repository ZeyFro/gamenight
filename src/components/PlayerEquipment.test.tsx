// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { playerEquipmentSchema } from "@/lib/player-equipment";
vi.mock("@/app/profil/player-equipment-actions", () => ({ updatePlayerEquipmentAction: vi.fn() }));
vi.mock("@/components/ui/Button", () => ({ Button: ({ children, type }: { children: React.ReactNode; type: "submit" }) => <button type={type}>{children}</button> }));
import { PlayerEquipmentForm } from "./PlayerEquipmentForm";
import { PlayerEquipment } from "./PlayerEquipment";
afterEach(cleanup);

describe("formulaire et lecture du matériel", () => {
  it("préremplit les sélections répétées et permet d'effacer toutes les informations", () => {
    render(<PlayerEquipmentForm user={{ inputDevices: ["CONTROLLER", "KEYBOARD_MOUSE"], availablePlatforms: ["WINDOWS", "LINUX"], microphoneAvailable: false }} />);
    const form = screen.getByRole("button", { name: "Enregistrer mon matériel" }).closest("form")!;
    const initial = new FormData(form);
    expect(initial.getAll("inputDevices")).toEqual(["KEYBOARD_MOUSE", "CONTROLLER"]);
    expect(initial.getAll("availablePlatforms")).toEqual(["WINDOWS", "LINUX"]);
    expect(initial.get("microphoneAvailable")).toBe("no");
    for (const checkbox of screen.getAllByRole("checkbox")) if ((checkbox as HTMLInputElement).checked) fireEvent.click(checkbox);
    fireEvent.change(screen.getByLabelText("Micro disponible"), { target: { value: "" } });
    const cleared = new FormData(form);
    expect(playerEquipmentSchema.parse({ inputDevices: cleared.getAll("inputDevices"), availablePlatforms: cleared.getAll("availablePlatforms"), microphoneAvailable: cleared.get("microphoneAvailable") })).toEqual({ inputDevices: [], availablePlatforms: [], microphoneAvailable: null });
  });
  it("distingue micro absent et informations non renseignées à la lecture", () => {
    render(<PlayerEquipment user={{ inputDevices: [], availablePlatforms: ["LINUX"], microphoneAvailable: false }} />);
    expect(screen.getByText("Non disponible")).toBeTruthy();
    expect(screen.getByText("Non renseignées")).toBeTruthy();
    expect(screen.getByText("Linux / Steam Deck")).toBeTruthy();
  });
  it("n'affiche aucune carte quand tout est non renseigné", () => {
    const { container } = render(<PlayerEquipment user={{ inputDevices: [], availablePlatforms: [], microphoneAvailable: null }} />);
    expect(container.textContent).toBe("");
  });
});
