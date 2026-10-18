// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RankAvatar } from "./RankAvatar";
import { rankForLevel } from "@/lib/xp";

describe("RankAvatar tooltip layout", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("removes the closed tooltip from layout and opens it on click", () => {
    render(<RankAvatar src={null} alt="Player" level={4} rank={rankForLevel(4)} />);
    const tooltip = screen.getByRole("tooltip", { hidden: true });

    expect(tooltip.className.split(" ")).toContain("hidden");

    fireEvent.click(screen.getByRole("button"));

    expect(tooltip.getAttribute("aria-hidden")).toBe("false");
    expect(tooltip.className.split(" ")).toContain("block");
  });

  it("shifts an opened tooltip left when its right edge would leave the viewport", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute("role") === "tooltip") {
        return { x: 199, y: 0, left: 199, top: 0, right: 416, bottom: 30, width: 217, height: 30, toJSON: () => ({}) };
      }
      return new DOMRect();
    });

    const { getByRole } = render(<RankAvatar src={null} alt="Player" level={4} rank={rankForLevel(4)} />);
    const tooltip = getByRole("tooltip", { hidden: true });

    fireEvent.click(getByRole("button"));

    expect(tooltip.style.left).toBe("calc(50% - 34px)");
  });
});
