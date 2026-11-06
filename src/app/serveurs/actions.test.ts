import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ setActiveCommunity: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({
  getCurrentUser: async (options?: { allowCommunitySelection?: boolean }) =>
    options?.allowCommunitySelection ? { id: "member" } : null,
}));
vi.mock("@/lib/community-picker", () => ({
  SERVEURS_PATH: "/serveurs", isCommunityPickerEnabled: () => true,
  safeNextPath: () => "/", setActiveCommunity: mocks.setActiveCommunity,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("404"); },
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
}));
import { changeCommunityAction, selectCommunityAction } from "./actions";

describe("sélection après connexion sans serveur choisi", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.setActiveCommunity.mockResolvedValue(true); });

  it("enregistre le choix puis revient à l'accueil", async () => {
    const form = new FormData();
    form.set("communityId", "allowed");
    await expect(selectCommunityAction(form)).rejects.toThrow("redirect:/");
    expect(mocks.setActiveCommunity).toHaveBeenCalledWith("member", "allowed");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("permet aussi le choix via le sélecteur rapide", async () => {
    await expect(changeCommunityAction("allowed")).resolves.toBe(true);
    expect(mocks.setActiveCommunity).toHaveBeenCalledWith("member", "allowed");
  });

  it("un choix refusé ne revalide aucune donnée et retourne au sélecteur", async () => {
    mocks.setActiveCommunity.mockResolvedValue(false);
    const form = new FormData();
    form.set("communityId", "foreign");
    await expect(selectCommunityAction(form)).rejects.toThrow("redirect:/serveurs");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    await expect(changeCommunityAction("foreign")).resolves.toBe(false);
  });
});
