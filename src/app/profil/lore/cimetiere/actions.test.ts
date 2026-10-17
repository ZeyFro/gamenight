import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { currentUser, rateLimit, save, remove, revalidatePath } = vi.hoisted(() => ({
  currentUser: vi.fn(), rateLimit: vi.fn(), save: vi.fn(), remove: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: currentUser }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: rateLimit }));
vi.mock("@/lib/community-game-graveyard", () => ({ saveCommunityGameEpitaph: save, deleteCommunityGameEpitaph: remove }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import { deleteCommunityGameEpitaphAction, saveCommunityGameEpitaphAction } from "./actions";

describe("cimetière : actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("COMMUNITY_GAME_GRAVEYARD_ENABLED", "true");
    currentUser.mockResolvedValue({ id: "authenticated" }); rateLimit.mockReturnValue(true);
    save.mockResolvedValue("saved"); remove.mockResolvedValue("deleted");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([saveCommunityGameEpitaphAction, deleteCommunityGameEpitaphAction])("refuse le spam sans écrire", async action => {
    rateLimit.mockReturnValue(false);
    await expect(action(new FormData())).rejects.toThrow("?result=rate");
    expect(save).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
  it.each([saveCommunityGameEpitaphAction, deleteCommunityGameEpitaphAction])("refuse un formulaire sans serveur affiché", async action => {
    await expect(action(new FormData())).rejects.toThrow("?result=invalid");
    expect(save).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
  it("utilise l’utilisateur authentifié et le serveur affiché", async () => {
    const form = new FormData();
    form.set("userId", "forged"); form.set("communityId", "displayed"); form.set("gameId", "game"); form.set("epitaph", "Adieu");
    await expect(saveCommunityGameEpitaphAction(form)).rejects.toThrow("?result=saved");
    expect(save).toHaveBeenCalledWith("authenticated", null, "game", "Adieu", "displayed");
    expect(revalidatePath).toHaveBeenCalledWith("/profil/lore/cimetiere");
  });
  it("n’écrit rien lorsque le drapeau n’est pas exactement true", async () => {
    vi.stubEnv("COMMUNITY_GAME_GRAVEYARD_ENABLED", "TRUE");
    await expect(saveCommunityGameEpitaphAction(new FormData())).rejects.toThrow("redirect:/profil/lore");
    expect(currentUser).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  });
  it("refuse un utilisateur déconnecté", async () => {
    currentUser.mockResolvedValue(null);
    await expect(deleteCommunityGameEpitaphAction(new FormData())).rejects.toThrow("redirect:/");
    expect(remove).not.toHaveBeenCalled();
  });
});
