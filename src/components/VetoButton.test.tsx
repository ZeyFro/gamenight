// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const actions = vi.hoisted(() => ({ setVeto: vi.fn(), clearVeto: vi.fn() }));
vi.mock("@/app/sessions/actions/veto", () => actions);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { VetoButton } from "./VetoButton";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("VetoButton", () => {
  it("reflète le veto remplacé sur une autre proposition après revalidation", async () => {
    actions.setVeto.mockResolvedValue({ ok: true });
    const view = render(<VetoButton proposalId="a" initialVetoed={true} />);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
    view.rerender(<VetoButton proposalId="a" initialVetoed={false} />);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("false");
    await userEvent.setup().click(screen.getByRole("button"));
    expect(actions.setVeto).toHaveBeenCalledOnce();
    expect(actions.clearVeto).not.toHaveBeenCalled();
  });

  it("un refus conserve l'état confirmé par le serveur", async () => {
    actions.setVeto.mockResolvedValue({ ok: false, error: "last_candidate" });
    render(<VetoButton proposalId="a" initialVetoed={false} />);
    await userEvent.setup().click(screen.getByRole("button"));
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("false");
  });
});
