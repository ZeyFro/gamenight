import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/community-scoped-client", () => ({ getScopedPrisma: vi.fn(async () => ({ playerClassified: { findMany: mocks.findMany } })) }));
vi.mock("@/lib/community-access", () => ({ findActiveMembership: vi.fn() }));
vi.mock("@/lib/community-isolation", () => ({ resolveActiveCommunityId: vi.fn() }));
import { listPlayerClassifieds } from "./player-classifieds";
beforeEach(() => { vi.clearAllMocks(); mocks.findMany.mockResolvedValue([]); });
describe("requête des annonces filtrées", () => {
  it("conserve scope, expiration stricte et auteur actif avec tous les filtres", async () => {
    const now = new Date("2026-11-04T20:00:00Z");
    await listPlayerClassifieds("viewer", "community-a", now, { gameId: "game-2", platform: "LINUX", microphone: "unknown" });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      communityId: "community-a", gameId: "game-2", expiresAt: { gt: now },
      createdBy: { availablePlatforms: { has: "LINUX" }, microphoneAvailable: null, memberships: { some: { communityId: "community-a", status: "ACTIVE" } } },
    } }));
  });
  it("garde les anciens appelants sans option", async () => {
    await listPlayerClassifieds("viewer", "community-a", new Date());
    expect(mocks.findMany).toHaveBeenCalledOnce();
  });
  it("valide aussi les options d'un appel direct", async () => {
    await expect(listPlayerClassifieds("viewer", "community-a", new Date(), { microphone: "forged" } as never)).rejects.toThrow();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
