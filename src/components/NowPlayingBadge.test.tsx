// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NowPlayingBadge } from "./NowPlayingBadge";

afterEach(cleanup);

describe("NowPlayingBadge", () => {
  it("affiche « En jeu » et le nom du jeu", () => {
    render(<NowPlayingBadge game="Rocket League" />);
    expect(screen.getByText("En jeu · Rocket League")).toBeTruthy();
  });

  it("le point animé est décoratif (masqué aux lecteurs d'écran) et l'animation respecte « réduire les animations »", () => {
    const { container } = render(<NowPlayingBadge game="X" />);
    const dot = container.querySelector("[aria-hidden='true']");
    expect(dot).not.toBeNull();
    expect(dot!.innerHTML).toContain("motion-safe:animate-ping");
  });

  it("un nom de jeu très long est tronqué plutôt que de déborder (mobile)", () => {
    render(<NowPlayingBadge game={"Un jeu au titre vraiment très très long ".repeat(5)} />);
    const text = screen.getByText(/En jeu · /);
    expect(text.className).toContain("truncate");
  });
});
