// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { computeWinningRotation } from "./RouletteWheelDisplay";

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ haptics: { medium: vi.fn(), light: vi.fn(), success: vi.fn() } }));
vi.mock("framer-motion", () => ({ motion: { div: "div" } }));
vi.mock("@/components/ui/Button", () => ({ ButtonLink: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock("./RouletteWheelDisplay", async (original) => ({
  ...await original<typeof import("./RouletteWheelDisplay")>(),
  RouletteWheelDisplay: ({ rotation, spinning }: { rotation: number; spinning: boolean }) =>
    <div data-testid="wheel" data-rotation={rotation} data-spinning={String(spinning)} />,
}));
import { RouletteResultReveal } from "./RouletteResultReveal";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("révélation après veto", () => {
  it("anime le nouveau gagnant après une revalidation et nettoie l'ancienne animation", () => {
    vi.useFakeTimers();
    const props = {
      entries: [{ userId: "u", game: { id: "a", name: "A" } }, { userId: "v", game: { id: "b", name: "B" } }],
      winnerGameId: "a", winnerGameName: "A", winnerGameCoverUrl: null,
      sessionId: "s", soundEnabled: false,
    };
    const view = render(<RouletteResultReveal {...props} />);
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.getByText("A")).toBeTruthy();
    view.rerender(<RouletteResultReveal {...props} winnerGameId="b" winnerGameName="B" />);
    expect(screen.queryByText("B")).toBeNull();
    expect(screen.getByTestId("wheel").getAttribute("data-spinning")).toBe("true");
    expect(Number(screen.getByTestId("wheel").getAttribute("data-rotation"))).toBe(computeWinningRotation(0, 1, 2));
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.getByText("B")).toBeTruthy();
    expect(screen.queryByText("A")).toBeNull();
  });
});
