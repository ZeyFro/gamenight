// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RankAvatar } from "./RankAvatar";
import { rankForLevel } from "@/lib/xp";

describe("RankAvatar tooltip layout", () => {
  it("removes the closed tooltip from layout and opens it on click", () => {
    render(<RankAvatar src={null} alt="Player" level={4} rank={rankForLevel(4)} />);
    const tooltip = screen.getByRole("tooltip", { hidden: true });

    expect(tooltip.className.split(" ")).toContain("hidden");

    fireEvent.click(screen.getByRole("button"));

    expect(tooltip.getAttribute("aria-hidden")).toBe("false");
    expect(tooltip.className.split(" ")).toContain("block");
  });
});
