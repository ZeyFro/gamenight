// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SlotSuggestionsResult } from "@/lib/session-slot-data";
const { suggest } = vi.hoisted(() => ({ suggest: vi.fn() }));
vi.mock("@/app/sessions/actions/suggest-slots", () => ({ suggestSessionSlotsAction: suggest }));
import { SessionPlanningFields } from "./SessionPlanningFields";

const potes = [
  { id: "a", discordName: "Alice", discordAvatar: null, color: "#ffffff", tagIds: ["team"] },
  { id: "b", discordName: "Bob", discordAvatar: null, color: "#ffffff", tagIds: [] },
];
const success: SlotSuggestionsResult = { ok: true, suggestions: [{ date: "2026-10-09", time: "20:30", endDate: "2026-10-09", endTime: "22:30", availableCount: 2, totalParticipants: 3, unknownCount: 1, creatorAvailable: true }] };
function setup() {
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  const view = render(<form onSubmit={submit}><SessionPlanningFields potes={potes} tags={[{ id: "team", name: "Team", color: "#ffffff" }]} minDate="2026-10-08" initialDate="2026-10-10" initialTime="19:00" /><button type="submit">Créer</button></form>);
  return { ...view, submit };
}
beforeEach(() => { vi.clearAllMocks(); suggest.mockResolvedValue(success); });
afterEach(cleanup);

it("aucune recherche au montage ; choisir remplit les champs postés sans soumettre ni changer les invités", async () => {
  const { container, submit } = setup();
  expect(suggest).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Proposer des créneaux" }));
  expect(suggest).toHaveBeenCalledWith({ guestIds: ["a", "b"], durationMinutes: 120 });
  await userEvent.click(await screen.findByRole("button", { name: /vendredi 9 octobre/ }));
  const data = new FormData(container.querySelector("form")!);
  expect(data.get("date")).toBe("2026-10-09"); expect(data.get("time")).toBe("20:30");
  expect(data.getAll("notifyUserId")).toEqual(["a", "b"]);
  expect(submit).not.toHaveBeenCalled();
  expect(screen.getByText(/1 personne sans disponibilité/)).toBeTruthy();
});

it("la sélection individuelle, par tag, tout et rien restent synchronisées", async () => {
  setup();
  await userEvent.click(screen.getByRole("button", { name: /Team/ })); // Retire Alice.
  await userEvent.click(screen.getByRole("button", { name: "Proposer des créneaux" }));
  await waitFor(() => expect(suggest).toHaveBeenLastCalledWith({ guestIds: ["b"], durationMinutes: 120 }));
  await userEvent.click(screen.getByRole("button", { name: "Tout désélectionner" }));
  await userEvent.click(screen.getByRole("checkbox", { name: "Alice" }));
  await userEvent.selectOptions(screen.getByLabelText("Durée à trouver"), "60");
  await userEvent.click(screen.getByRole("button", { name: "Proposer des créneaux" }));
  expect(suggest).toHaveBeenLastCalledWith({ guestIds: ["a"], durationMinutes: 60 });
  await userEvent.click(screen.getByRole("button", { name: "Tout sélectionner" }));
  expect(screen.queryByRole("button", { name: /vendredi 9 octobre/ })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Proposer des créneaux" }));
  expect(suggest).toHaveBeenLastCalledWith({ guestIds: ["a", "b"], durationMinutes: 60 });
});

it("double clic : un seul appel ; une réponse pour l'ancien groupe est ignorée", async () => {
  let finish!: (result: SlotSuggestionsResult) => void;
  suggest.mockImplementation(() => new Promise<SlotSuggestionsResult>((resolve) => { finish = resolve; }));
  setup();
  const button = screen.getByRole("button", { name: "Proposer des créneaux" });
  fireEvent.click(button); fireEvent.click(button);
  expect(suggest).toHaveBeenCalledOnce();
  expect(button.hasAttribute("disabled")).toBe(true);
  await userEvent.click(screen.getByRole("checkbox", { name: "Alice" }));
  await act(async () => finish(success));
  expect(screen.queryByRole("button", { name: /vendredi 9 octobre/ })).toBeNull();
  expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-10-10");
  expect(button.hasAttribute("disabled")).toBe(false);
});

it("un changement de durée invalide également la réponse en cours", async () => {
  let finish!: (result: SlotSuggestionsResult) => void;
  suggest.mockImplementation(() => new Promise<SlotSuggestionsResult>((resolve) => { finish = resolve; }));
  setup();
  await userEvent.click(screen.getByRole("button", { name: "Proposer des créneaux" }));
  await userEvent.selectOptions(screen.getByLabelText("Durée à trouver"), "180");
  await act(async () => finish(success));
  expect(screen.queryByRole("button", { name: /vendredi 9 octobre/ })).toBeNull();
});

it("échec puis reprise : conserve les champs saisis et les invités", async () => {
  suggest.mockRejectedValueOnce(new Error("network lost"));
  setup();
  await userEvent.click(screen.getByRole("button", { name: "Proposer des créneaux" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Réessaie");
  expect((screen.getByLabelText("Heure") as HTMLInputElement).value).toBe("19:00");
  await userEvent.click(screen.getByRole("button", { name: "Proposer des créneaux" }));
  await screen.findByRole("button", { name: /vendredi 9 octobre/ });
  expect(screen.queryByRole("alert")).toBeNull();
});

it("aucun résultat : explique quoi ajuster et conserve la création manuelle", async () => {
  suggest.mockResolvedValue({ ok: true, suggestions: [] });
  setup();
  await userEvent.click(screen.getByRole("button", { name: "Proposer des créneaux" }));
  await screen.findByText(/Aucun créneau trouvé/);
  expect(screen.getByRole("link", { name: /Renseigner mes disponibilités/ }).getAttribute("href")).toBe("/disponibilites");
  expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-10-10");
});
