import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /design-preview : derrière l'authentification, jamais indexée, et sans
 * aucun accès aux données. Le mock de `@/lib/prisma` fait ÉCHOUER le
 * chargement du module si quoi que ce soit dans l'arbre d'imports de la page
 * (hors `getCurrentUser`, mocké) tente d'atteindre la base.
 */

const { currentUserMock, redirectMock } = vi.hoisted(() => ({
  currentUserMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser: currentUserMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/prisma", () => {
  throw new Error("La page /design-preview ne doit jamais importer Prisma.");
});

import DesignPreviewPage, { metadata } from "./page";

beforeEach(() => vi.clearAllMocks());

describe("/design-preview", () => {
  it("n'est jamais indexée", () => {
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });

  it("redirige vers l'accueil quand personne n'est connecté", async () => {
    currentUserMock.mockResolvedValue(null);
    await expect(DesignPreviewPage()).rejects.toThrow("REDIRECT:/");
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("affiche l'aperçu pour un utilisateur connecté, sans toucher à la base", async () => {
    currentUserMock.mockResolvedValue({ id: "u1" });
    const element = await DesignPreviewPage();
    expect(element).toBeTruthy();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
