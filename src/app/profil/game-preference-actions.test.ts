import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), update: vi.fn(), visible: vi.fn(), add: vi.fn(), remove: vi.fn(), rate: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { update: mocks.update }, game: { findFirst: mocks.visible }, userGameRefusal: { createMany: mocks.add, deleteMany: mocks.remove } } }));
vi.mock("@/lib/game-suggestions", () => ({ gamePreferenceMemberWhere: async () => ({ memberships: { some: { communityId: "active" } } }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
import { setGameRefusalAction, updateGamePreferencesAction } from "./game-preference-actions";
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "self" }); mocks.rate.mockReturnValue(true); mocks.visible.mockResolvedValue({ id: "game" }); mocks.update.mockResolvedValue({}); });
const refusal = (mode = "refuse") => { const form = new FormData(); form.set("gameId", "game"); form.set("mode", mode); form.set("userId", "victim"); return form; };
describe("préférences personnelles : action serveur", () => {
  it("ignore userId forgé et écrit uniquement les deux listes pour la session", async () => {
    const form = new FormData(); form.append("preferredGameCategories", "COOP"); form.append("refusedGameCategories", "HORROR"); form.set("userId", "victim");
    await expect(updateGamePreferencesAction(form)).rejects.toThrow("gouts=ok");
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ where: { id: "self" }, data: { preferredGameCategories: ["COOP"], refusedGameCategories: ["HORROR"] } });
  });
  it("refuse contradictions et identifiants de jeu hors contrat sans écriture", async () => {
    const form = new FormData(); form.append("preferredGameCategories", "HORROR"); form.append("refusedGameCategories", "HORROR");
    await expect(updateGamePreferencesAction(form)).rejects.toThrow("gouts=invalide");
    await expect(setGameRefusalAction(refusal("forged"))).rejects.toThrow("gouts=invalide");
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.add).not.toHaveBeenCalled();
  });
  it("vérifie la visibilité du jeu et garde l'ajout idempotent", async () => {
    await expect(setGameRefusalAction(refusal())).rejects.toThrow("gouts=ok");
    expect(mocks.visible).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userGames: { some: { owned: true, user: { memberships: { some: { communityId: "active" } } } } } }) }));
    expect(mocks.add).toHaveBeenCalledExactlyOnceWith({ data: [{ userId: "self", gameId: "game" }], skipDuplicates: true });
    mocks.add.mockClear(); mocks.visible.mockResolvedValue(null);
    await expect(setGameRefusalAction(refusal())).rejects.toThrow("gouts=inaccessible"); expect(mocks.add).not.toHaveBeenCalled();
  });
  it("retire seulement son propre refus, même si la bibliothèque n'est plus accessible", async () => {
    await expect(setGameRefusalAction(refusal("remove"))).rejects.toThrow("gouts=ok");
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({ where: { userId: "self", gameId: "game" } }); expect(mocks.visible).not.toHaveBeenCalled();
  });
  it("exige une session et limite les actions avant toute écriture", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(setGameRefusalAction(refusal())).rejects.toThrow("REDIRECT:/");
    await expect(updateGamePreferencesAction(new FormData())).rejects.toThrow("REDIRECT:/");
    mocks.user.mockResolvedValue({ id: "self" }); mocks.rate.mockReturnValue(false);
    await expect(setGameRefusalAction(refusal())).rejects.toThrow("gouts=rate_limited");
    await expect(updateGamePreferencesAction(new FormData())).rejects.toThrow("gouts=rate_limited");
    expect(mocks.add).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });
  it("ne transforme pas une panne de persistance en succès", async () => {
    mocks.update.mockRejectedValue(new Error("database unavailable"));
    await expect(updateGamePreferencesAction(new FormData())).rejects.toThrow("database unavailable");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
