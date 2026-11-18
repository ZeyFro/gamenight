// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/page-reload", () => ({ reloadPage: vi.fn() }));

import { reloadPage } from "@/lib/page-reload";
import { OfflineBanner } from "./OfflineBanner";

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => value });
}

afterEach(cleanup);
beforeEach(() => setOnline(true));

describe("bandeau hors ligne", () => {
  it("reste invisible tant que la connexion est là", () => {
    render(<OfflineBanner />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("annonce la perte de réseau sans proposer de relance inutile", () => {
    render(<OfflineBanner />);
    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    const banner = screen.getByRole("status");
    expect(banner.getAttribute("aria-live")).toBe("polite");
    expect(banner.textContent).toContain("Hors ligne");
    expect(screen.queryByRole("button", { name: "Recharger" })).toBeNull();
  });

  it("au retour du réseau, propose Recharger sans recharger tout seul", () => {
    render(<OfflineBanner />);
    act(() => {
      setOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    act(() => {
      setOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.getByRole("status").textContent).toContain("Connexion retrouvée");
    expect(vi.mocked(reloadPage)).not.toHaveBeenCalled();
    act(() => screen.getByRole("button", { name: "Recharger" }).click());
    expect(vi.mocked(reloadPage)).toHaveBeenCalledOnce();
  });
});
