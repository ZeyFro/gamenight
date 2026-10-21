import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "MEMBER" as "MEMBER" | "ADMIN" | "OWNER",
  findMany: vi.fn(), create: vi.fn(), createMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  $transaction: (work: (tx: unknown) => unknown) => work({
    $queryRaw: (strings: TemplateStringsArray) => strings.join("").includes('FROM "Community"')
      ? [{ status: "ACTIVE", name: "Serveur" }] : [{ status: "ACTIVE", role: mocks.role }],
    communityExpression: mocks, communityGameEpitaph: mocks,
    game: { findFirst: async () => ({ id: "game" }), findMany: async () => [] },
  }),
} }));
vi.mock("@/lib/community-isolation", () => ({ resolveActiveCommunityId: async () => "community" }));
vi.mock("@/lib/community-scoped-client", () => ({ scopedTransactionPrisma: (tx: unknown) => tx }));

import { deleteCommunityExpression, listCommunityExpressions, saveCommunityExpression } from "./community-expressions";
import { deleteCommunityGameEpitaph, listCommunityGameGraveyard, saveCommunityGameEpitaph } from "./community-game-graveyard";

describe("Lore communautaire : gestion réservée aux administrateurs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("COMMUNITY_EXPRESSIONS_ENABLED", "true");
    vi.stubEnv("COMMUNITY_GAME_GRAVEYARD_ENABLED", "true");
    mocks.role = "MEMBER";
    mocks.findMany.mockResolvedValue([{ id: "entry", createdById: "author" }]);
    mocks.create.mockResolvedValue({ id: "entry" });
    mocks.createMany.mockResolvedValue({ count: 1 });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.deleteMany.mockResolvedValue({ count: 1 });
  });
  afterEach(() => vi.unstubAllEnvs());

  const collections = [
    { name: "expressions", list: listCommunityExpressions,
      save: (id: string | null) => saveCommunityExpression("author", id, "Expression", "Sens"),
      remove: () => deleteCommunityExpression("author", "entry") },
    { name: "cimetière", list: listCommunityGameGraveyard,
      save: (id: string | null) => saveCommunityGameEpitaph("author", id, "game", "Souvenir"),
      remove: () => deleteCommunityGameEpitaph("author", "entry") },
  ];
  for (const collection of collections) {
    it(`${collection.name} : le membre lit mais ne crée, modifie ou supprime rien, même auteur`, async () => {
      expect((await collection.list("author"))?.entries).toHaveLength(1);
      expect(await collection.save(null)).toBe("unavailable");
      expect(await collection.save("entry")).toBe("unavailable");
      expect(await collection.remove()).toBe("unavailable");
      for (const mutation of [mocks.create, mocks.createMany, mocks.updateMany, mocks.deleteMany]) expect(mutation).not.toHaveBeenCalled();
    });
    it.each(["ADMIN", "OWNER"] as const)(`${collection.name} : %s gère la collection`, async role => {
      mocks.role = role;
      expect(await collection.save(null)).toBe("saved");
      expect(await collection.save("entry")).toBe("saved");
      expect(await collection.remove()).toBe("deleted");
    });
  }
});
