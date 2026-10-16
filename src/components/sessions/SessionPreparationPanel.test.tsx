// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ action: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/sessions/actions/preparation", () => ({ sessionPreparationAction: m.action }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
import { SessionPreparationPanel } from "./SessionPreparationPanel";
const participants = [{ id: "me", discordName: "Moi", installed: false, updated: false, microphone: false, lobby: false }, { id: "other", discordName: "Autre", installed: true, updated: true, microphone: true, lobby: true }];
beforeEach(() => { vi.resetAllMocks(); m.action.mockResolvedValue({ ok: true }); });
afterEach(cleanup);
it("montre le collectif mais ne permet de modifier que sa ligne", async () => {
  render(<SessionPreparationPanel sessionId="s" userId="me" participants={participants} />);
  expect(screen.getByText("1/2 participants prêts")).toBeTruthy();
  const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
  expect(boxes).toHaveLength(8); expect(boxes[0].closest("fieldset")?.disabled).toBe(false); expect(boxes[4].closest("fieldset")?.disabled).toBe(true);
  fireEvent.click(boxes[0]);
  await waitFor(() => expect(m.action).toHaveBeenCalledWith({ sessionId: "s", field: "installed", checked: true }));
  await waitFor(() => expect(m.refresh).toHaveBeenCalledOnce());
});
it("signale un échec sans afficher une réussite optimiste", async () => {
  m.action.mockResolvedValue({ ok: false });
  render(<SessionPreparationPanel sessionId="s" userId="me" participants={participants} />);
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  expect(await screen.findByRole("alert")).toBeTruthy(); expect(m.refresh).not.toHaveBeenCalled();
});
