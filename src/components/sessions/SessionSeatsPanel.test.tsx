// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const mocks = vi.hoisted(() => ({ action: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/sessions/actions/seats", () => ({ sessionSeatAction: mocks.action }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import { SessionSeatsPanel } from "./SessionSeatsPanel";
const base = { sessionId: "s", userId: "me", isCreator: false, open: true, capacity: 1, maxPlayers: 4, seats: [{ userId: "host", status: "CONFIRMED" as const, user: { discordName: "Host" } }] };
beforeEach(() => { vi.resetAllMocks(); mocks.action.mockResolvedValue({ ok: true, status: "WAITLIST" }); });
afterEach(cleanup);
it("une soirée pleine propose l'attente et le double clic ne fait qu'un appel", async () => {
  let resolve!: (value: unknown) => void;
  mocks.action.mockReturnValue(new Promise(r => { resolve = r; })); render(<SessionSeatsPanel {...base} />);
  const button = screen.getByRole("button", { name: "Rejoindre la liste d’attente" });
  fireEvent.click(button); fireEvent.click(button); expect(mocks.action).toHaveBeenCalledOnce(); expect(button.hasAttribute("disabled")).toBe(true);
  await act(async () => { resolve({ ok: true, status: "WAITLIST" }); });
  expect(screen.getByRole("status").textContent).toContain("liste d’attente"); expect(mocks.refresh).toHaveBeenCalledOnce();
});
it("affiche la position et permet un désistement sans exposer la capacité aux invités", async () => {
  render(<SessionSeatsPanel {...base} seats={[...base.seats, { userId: "me", status: "WAITLIST", user: { discordName: "Moi" } }]} />);
  expect(screen.getByText("Ta position : 1.")).toBeTruthy(); expect(screen.queryByLabelText("Nombre de places")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Me désister" })); expect(mocks.action).toHaveBeenCalledWith({ sessionId: "s", command: { kind: "leave" } });
});
it("seul le créateur active une capacité ; un échec permet de réessayer", async () => {
  mocks.action.mockRejectedValueOnce(new Error("network")); render(<SessionSeatsPanel {...base} isCreator capacity={null} />);
  await userEvent.click(screen.getByRole("button", { name: "Activer les places" })); expect(screen.getByRole("status").textContent).toContain("Réessaie"); expect(mocks.refresh).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Activer les places" })); expect(mocks.action).toHaveBeenLastCalledWith({ sessionId: "s", command: { kind: "capacity", capacity: 4 } });
});
it("ne propose aucune mutation après fermeture", () => { render(<SessionSeatsPanel {...base} isCreator open={false} />); expect(screen.queryByRole("button")).toBeNull(); });
