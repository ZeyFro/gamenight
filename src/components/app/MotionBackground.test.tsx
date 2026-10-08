// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionBackground, MotionToggle } from "./MotionBackground";

let reduced = false;
let desktop = true;
let hidden = false;
const listeners = new Set<() => void>();
function updateMedia() { act(() => { for (const listener of listeners) listener(); }); }

beforeEach(() => {
  reduced = false; desktop = true; hidden = false;
  localStorage.clear(); listeners.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() { return query.includes("reduced-motion") ? reduced : desktop; },
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
  }));
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("décor ambiant", () => {
  it("retire les météores en pause et conserve le décor statique, puis respecte la préférence au remontage", () => {
    const { container, unmount } = render(<><MotionBackground /><MotionToggle /></>);
    expect(container.querySelectorAll(".animate-meteor")).toHaveLength(7);
    fireEvent.click(screen.getByRole("button", { name: /Animations activées/ }));
    expect(container.querySelectorAll(".animate-meteor")).toHaveLength(0);
    expect(container.querySelector(".gn-constellations")).not.toBeNull();
    expect(document.documentElement.dataset.ambientMotion).toBe("off");
    unmount();
    const remounted = render(<><MotionBackground /><MotionToggle /></>);
    expect(remounted.container.querySelectorAll(".animate-meteor")).toHaveLength(0);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("false");
  });

  it("désactive les mouvements avec la préférence système et sur petit écran", () => {
    const { container } = render(<MotionBackground />);
    reduced = true; updateMedia();
    expect(container.querySelectorAll(".animate-meteor")).toHaveLength(0);
    expect(document.documentElement.dataset.ambientMotion).toBe("off");
    reduced = false; desktop = false; updateMedia();
    expect(container.querySelectorAll(".animate-meteor")).toHaveLength(0);
    desktop = true; updateMedia();
    expect(container.querySelectorAll(".animate-meteor")).toHaveLength(7);
  });

  it("arrête le décor animé dans un onglet caché et le reprend au retour", () => {
    const { container } = render(<MotionBackground />);
    hidden = true; fireEvent(document, new Event("visibilitychange"));
    expect(container.querySelectorAll(".animate-meteor")).toHaveLength(0);
    expect(document.documentElement.dataset.ambientMotion).toBe("off");
    hidden = false; fireEvent(document, new Event("visibilitychange"));
    expect(container.querySelectorAll(".animate-meteor")).toHaveLength(7);
    expect(document.documentElement.dataset.ambientMotion).toBe("on");
  });
});
