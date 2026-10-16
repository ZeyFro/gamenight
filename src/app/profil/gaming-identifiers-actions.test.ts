import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), update: vi.fn(), rate: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { update: mocks.update } } }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));

import { updateGamingIdentifiersAction } from "./gaming-identifiers-actions";

function form() {
  const data = new FormData();
  for (const key of ["psnId", "xboxGamertag", "switchFriendCode", "epicDisplayName", "battleTag"]) data.set(key, "");
  data.set("psnId", "  MonPseudo  ");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "self" });
  mocks.rate.mockReturnValue(true);
  mocks.update.mockResolvedValue({});
});

describe("édition de ses identifiants", () => {
  it("ignore toute identité forgée et invalide les affichages concernés", async () => {
    const data = form(); data.set("userId", "victim"); data.set("steamId64", "forged");
    await expect(updateGamingIdentifiersAction(data)).rejects.toThrow("REDIRECT:/profil/parametres?identifiants=ok");
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ where: { id: "self" }, data: {
      psnId: "MonPseudo", xboxGamertag: null, switchFriendCode: null, epicDisplayName: null, battleTag: null,
    } });
    expect(mocks.revalidate).toHaveBeenCalledWith("/potes/self", "layout");
    expect(mocks.revalidate).toHaveBeenCalledWith("/profil/parametres");
  });

  it("refuse toute écriture sans authentification", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(updateGamingIdentifiersAction(form())).rejects.toThrow("REDIRECT:/");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("refuse les données invalides et le dépassement de fréquence", async () => {
    const data = form(); data.set("battleTag", "x".repeat(101));
    await expect(updateGamingIdentifiersAction(data)).rejects.toThrow("identifiants=invalide");
    mocks.rate.mockReturnValue(false);
    await expect(updateGamingIdentifiersAction(form())).rejects.toThrow("identifiants=rate_limited");
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("propage une panne d'enregistrement au lieu d'annoncer un succès", async () => {
    mocks.update.mockRejectedValue(new Error("database unavailable"));
    await expect(updateGamingIdentifiersAction(form())).rejects.toThrow("database unavailable");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
