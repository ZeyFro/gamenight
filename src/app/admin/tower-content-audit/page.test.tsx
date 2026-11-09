import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/components/admin/TowerContentAuditClient", () => ({
  default: () => <div data-testid="tower-audit">audit</div>,
}));

import Page from "./page";

const OWNER = "699223334046531636";

beforeEach(() => vi.clearAllMocks());

describe("page admin tower-content-audit : réservée au propriétaire Tower", () => {
  it("affiche le message « connexion requise » à un administrateur non propriétaire, sans l'audit", async () => {
    mocks.requireAdmin.mockResolvedValue({ id: "u1", discordId: "111111111111111111" });
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain("connexion requise");
    expect(html).not.toContain("tower-audit");
  });

  it("affiche le message « connexion requise » à un administrateur sans discordId", async () => {
    mocks.requireAdmin.mockResolvedValue({ id: "u1", discordId: null });
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain("connexion requise");
    expect(html).not.toContain("tower-audit");
  });

  it("affiche le message « connexion requise » à un non-administrateur", async () => {
    mocks.requireAdmin.mockResolvedValue(null);
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain("connexion requise");
    expect(html).not.toContain("tower-audit");
  });

  it("affiche l'audit au propriétaire", async () => {
    mocks.requireAdmin.mockResolvedValue({ id: "owner", discordId: OWNER });
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain("tower-audit");
    expect(html).not.toContain("connexion requise");
  });
});
