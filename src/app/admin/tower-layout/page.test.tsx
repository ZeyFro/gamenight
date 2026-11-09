import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/components/admin/TowerLayoutClient", () => ({ default: () => <div data-testid="tower-console">console</div> }));

import Page from "./page";

const OWNER = "699223334046531636";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((to: string) => {
    throw new Error("REDIRECT:" + to);
  });
});

describe("page admin tower-layout : réservée au propriétaire Tower", () => {
  it("redirige un administrateur qui n'est pas le propriétaire, sans rendre la console", async () => {
    mocks.requireAdmin.mockResolvedValue({ id: "u1", discordId: "111111111111111111" });
    await expect(Page()).rejects.toThrow("REDIRECT:/");
    expect(mocks.redirect).toHaveBeenCalledWith("/");
  });

  it("redirige un administrateur sans discordId", async () => {
    mocks.requireAdmin.mockResolvedValue({ id: "u1", discordId: null });
    await expect(Page()).rejects.toThrow("REDIRECT:/");
  });

  it("redirige un non-administrateur (requireAdmin renvoie null)", async () => {
    mocks.requireAdmin.mockResolvedValue(null);
    await expect(Page()).rejects.toThrow("REDIRECT:/");
  });

  it("affiche la console au propriétaire, sans redirection", async () => {
    mocks.requireAdmin.mockResolvedValue({ id: "owner", discordId: OWNER });
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain("tower-console");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
