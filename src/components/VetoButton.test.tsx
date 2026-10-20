// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const actions = vi.hoisted(() => ({ setVeto: vi.fn(), clearVeto: vi.fn() }));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("@/app/sessions/actions/veto", () => actions);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
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
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("rafraîchit les autres boutons après remplacement réussi du veto unique", async () => {
    actions.setVeto.mockResolvedValue({ ok: true });
    const view = render(<>
      <VetoButton proposalId="a" initialVetoed={true} />
      <VetoButton proposalId="b" initialVetoed={false} />
    </>);
    expect(screen.getAllByRole("button").map(button => button.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Poser mon veto sur ce jeu" }));
    expect(router.refresh).toHaveBeenCalledOnce();
    view.rerender(<>
      <VetoButton proposalId="a" initialVetoed={false} />
      <VetoButton proposalId="b" initialVetoed={true} />
    </>);
    expect(screen.getAllByRole("button").map(button => button.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
  });
});
