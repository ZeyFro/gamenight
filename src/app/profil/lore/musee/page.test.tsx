import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const { currentUser, list } = vi.hoisted(() => ({ currentUser: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: currentUser }));
vi.mock("@/lib/community-highlights", () => ({ listCommunityHighlights: list }));
vi.mock("./actions", () => ({ saveHighlightAction: vi.fn(), deleteHighlightAction: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); }, notFound: () => { throw new Error("notFound"); } }));
import Page from "./page";

const item = { id: "souvenir", createdById: "other", createdBy: { discordName: "Pote" }, kind: "SHAME", title: "<script>alert(1)</script>", description: "Le souvenir", mediaUrl: "https://example.org/clip" };
beforeEach(() => {
  currentUser.mockResolvedValue({ id: "alice" });
  list.mockResolvedValue({ communityId: "a", communityName: "Serveur A", canModerate: false, items: [item], hasNext: false });
});

describe("musée : rendu serveur", () => {
  it("affiche le serveur, le texte échappé et le lien média sans contrôle d'édition pour autrui", async () => {
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Serveur A");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain('href="https://example.org/clip"');
    expect(html).not.toContain("Modifier ou supprimer");
    expect(html).not.toContain("Publier");
    expect(html).not.toContain('name="creationKey"');
  });

  it("ne propose pas d'édition à un ancien auteur sans rôle de modération", async () => {
    currentUser.mockResolvedValue({ id: "other" });
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain("Modifier ou supprimer");
    expect(html).not.toContain("Publier");
  });

  it("propose la modération et la pagination au rôle autorisé", async () => {
    list.mockResolvedValue({ communityId: "a", communityName: "A", canModerate: true, items: [item], hasNext: true });
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ page: "2" }) }));
    expect(list).toHaveBeenCalledWith("alice", 2);
    expect(html).toContain("Modifier ou supprimer");
    expect(html).toContain("Publier");
    expect(html).toContain('name="communityId" value="a"');
    expect(html).toContain('name="creationKey"');
    expect(html).toContain("?page=1");
    expect(html).toContain("?page=3");
  });

  it("refuse l'accès anonyme ou indisponible", async () => {
    currentUser.mockResolvedValue(null);
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect");
    currentUser.mockResolvedValue({ id: "alice" });
    list.mockResolvedValue(null);
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow("notFound");
  });
});
