import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { currentUser, rateLimit, save, remove, revalidatePath } = vi.hoisted(() => ({
  currentUser: vi.fn(), rateLimit: vi.fn(), save: vi.fn(), remove: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: currentUser }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: rateLimit }));
vi.mock("@/lib/community-expressions", () => ({ saveCommunityExpression: save, deleteCommunityExpression: remove }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import { deleteCommunityExpressionAction, saveCommunityExpressionAction } from "./actions";

describe("expressions : actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("COMMUNITY_EXPRESSIONS_ENABLED", "true");
    currentUser.mockResolvedValue({ id: "authenticated" });
    rateLimit.mockReturnValue(true);
    save.mockResolvedValue("saved");
    remove.mockResolvedValue("deleted");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([saveCommunityExpressionAction, deleteCommunityExpressionAction])("refuse les appels trop fréquents sans écrire", async (action) => {
    rateLimit.mockReturnValue(false);
    await expect(action(new FormData())).rejects.toThrow("?result=rate");
    expect(save).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("utilise l’utilisateur authentifié et invalide uniquement après réussite", async () => {
    const form = new FormData();
    form.set("userId", "forged"); form.set("communityId", "displayed-server");
    form.set("title", "Expression"); form.set("meaning", "Sens");
    await expect(saveCommunityExpressionAction(form)).rejects.toThrow("?result=saved");
    expect(save).toHaveBeenCalledWith("authenticated", null, "Expression", "Sens", "displayed-server");
    expect(revalidatePath).toHaveBeenCalledWith("/profil/lore/expressions");
  });

  it.each([saveCommunityExpressionAction, deleteCommunityExpressionAction])("refuse un formulaire sans serveur affiché", async (action) => {
    await expect(action(new FormData())).rejects.toThrow("?result=invalid");
    expect(save).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("drapeau autre que true : aucun accès ni écriture", async () => {
    vi.stubEnv("COMMUNITY_EXPRESSIONS_ENABLED", "TRUE");
    await expect(saveCommunityExpressionAction(new FormData())).rejects.toThrow("redirect:/profil/lore");
    expect(currentUser).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("refuse un utilisateur déconnecté", async () => {
    currentUser.mockResolvedValue(null);
    await expect(deleteCommunityExpressionAction(new FormData())).rejects.toThrow("redirect:/");
    expect(remove).not.toHaveBeenCalled();
  });
});
