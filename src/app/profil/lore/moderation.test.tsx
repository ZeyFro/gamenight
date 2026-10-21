import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "MEMBER" as "MEMBER" | "ADMIN" | "OWNER",
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: async () => ({ id: "author" }) }));
vi.mock("@/lib/community-expressions", () => ({ listCommunityExpressions: async () => ({
  community: { id: "community", name: "Serveur" }, role: mocks.role,
  entries: [{ id: "expression", title: "Souvenir expression", meaning: "Sens", createdById: "author" }],
}) }));
vi.mock("@/lib/community-game-graveyard", () => ({ listCommunityGameGraveyard: async () => ({
  community: { id: "community", name: "Serveur" }, role: mocks.role,
  entries: [{ id: "epitaph", epitaph: "Souvenir épitaphe", game: { id: "game", name: "Jeu" }, createdById: "author" }],
  games: [{ id: "other", name: "Autre jeu" }], hasMoreGames: false,
}) }));
vi.mock("./expressions/actions", () => ({ saveCommunityExpressionAction: async () => {}, deleteCommunityExpressionAction: async () => {} }));
vi.mock("./cimetiere/actions", () => ({ saveCommunityGameEpitaphAction: async () => {}, deleteCommunityGameEpitaphAction: async () => {} }));

import ExpressionsPage from "./expressions/page";
import GraveyardPage from "./cimetiere/page";

describe("Lore : formulaires de gestion", () => {
  beforeEach(() => {
    vi.stubEnv("COMMUNITY_EXPRESSIONS_ENABLED", "true");
    vi.stubEnv("COMMUNITY_GAME_GRAVEYARD_ENABLED", "true");
    mocks.role = "MEMBER";
  });
  afterEach(() => vi.unstubAllEnvs());

  for (const collection of [
    { page: ExpressionsPage, create: "Ajouter une expression", edit: "Modifier ou supprimer", content: "Souvenir expression" },
    { page: GraveyardPage, create: "Écrire une épitaphe", edit: "Modifier ou retirer", content: "Souvenir épitaphe" },
  ]) {
    it(`${collection.create} : le membre auteur consulte sans formulaire`, async () => {
      const html = renderToStaticMarkup(await collection.page({ searchParams: Promise.resolve({}) }));
      expect(html).toContain(collection.content);
      expect(html).not.toContain(collection.create);
      expect(html).not.toContain(collection.edit);
      expect(html).not.toContain("<form");
    });
    it.each(["ADMIN", "OWNER"] as const)(`${collection.create} : %s dispose des formulaires`, async role => {
      mocks.role = role;
      const html = renderToStaticMarkup(await collection.page({ searchParams: Promise.resolve({}) }));
      expect(html).toContain(collection.create);
      expect(html).toContain(collection.edit);
    });
  }
});
