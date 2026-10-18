// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/app/tierlist/actions", () => ({ setGameTierAction: vi.fn() }));

import { TierlistBoard } from "./TierlistBoard";

afterEach(() => {
  cleanup();
  delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).complete;
  delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).naturalWidth;
  delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).naturalHeight;
});

function stubImageState(state: { complete: boolean; width: number; height: number }) {
  Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => state.complete });
  Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => state.width });
  Object.defineProperty(HTMLImageElement.prototype, "naturalHeight", { configurable: true, get: () => state.height });
}

const game = { id: "broken", name: "ARK: Survival Of The Fittest", coverUrl: "https://steam.example/404.jpg" };

describe("TierlistBoard game cover fallback", () => {
  it("replaces a cover that fails after hydration with the game name", () => {
    stubImageState({ complete: false, width: 0, height: 0 });
    render(<TierlistBoard games={[game]} initialTiers={{}} />);

    fireEvent.error(screen.getByAltText(game.name));

    expect(screen.queryByAltText(game.name)).toBeNull();
    expect(screen.getByText(game.name)).toBeTruthy();
  });

  it("replaces a cover that failed before hydration", () => {
    stubImageState({ complete: true, width: 0, height: 0 });

    render(<TierlistBoard games={[game]} initialTiers={{}} />);

    expect(screen.queryByAltText(game.name)).toBeNull();
    expect(screen.getByText(game.name)).toBeTruthy();
  });
});
