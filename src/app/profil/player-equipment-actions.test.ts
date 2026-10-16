import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), update: vi.fn(), rate: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { update: mocks.update } } }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw Error(`REDIRECT:${url}`); } }));
import { updatePlayerEquipmentAction } from "./player-equipment-actions";

function form() {
  const data = new FormData();
  data.append("inputDevices", "CONTROLLER"); data.append("inputDevices", "KEYBOARD_MOUSE");
  data.append("availablePlatforms", "WINDOWS"); data.append("availablePlatforms", "LINUX");
  data.set("microphoneAvailable", "no"); data.set("userId", "victim"); data.set("steamId64", "forged");
  return data;
}
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "self" }); mocks.rate.mockReturnValue(true); mocks.update.mockResolvedValue({}); });

describe("édition de son matériel", () => {
  it("écrit la sélection complète pour la session, jamais l'identité ou Steam forgés", async () => {
    await expect(updatePlayerEquipmentAction(form())).rejects.toThrow("materiel=ok");
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ where: { id: "self" }, data: {
      inputDevices: ["CONTROLLER", "KEYBOARD_MOUSE"], availablePlatforms: ["WINDOWS", "LINUX"], microphoneAvailable: false,
    } });
    expect(mocks.revalidate).toHaveBeenCalledWith("/potes/self", "layout");
  });
  it("exige une session et limite la fréquence avant toute écriture", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(updatePlayerEquipmentAction(form())).rejects.toThrow("REDIRECT:/");
    mocks.user.mockResolvedValue({ id: "self" }); mocks.rate.mockReturnValue(false);
    await expect(updatePlayerEquipmentAction(form())).rejects.toThrow("materiel=rate_limited");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("refuse une plateforme forgée sans écriture partielle", async () => {
    const data = form(); data.append("availablePlatforms", "forged");
    await expect(updatePlayerEquipmentAction(data)).rejects.toThrow("materiel=invalide");
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("laisse remonter une panne d'écriture", async () => {
    mocks.update.mockRejectedValue(new Error("database unavailable"));
    await expect(updatePlayerEquipmentAction(form())).rejects.toThrow("database unavailable");
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
