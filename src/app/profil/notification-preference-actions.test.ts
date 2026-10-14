import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUser, setOwnNotificationPreference, redirect, checkRateLimit } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  setOwnNotificationPreference: vi.fn(),
  redirect: vi.fn((location: string) => {
    throw new Error(`REDIRECT:${location}`);
  }),
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser }));
vi.mock("@/lib/notification-preferences", () => ({
  isAvailableNotificationCategory: (value: string) => ["SESSION", "ROULETTE"].includes(value),
  setOwnNotificationPreference,
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

import { updateNotificationPreferenceAction } from "./actions";

describe("updateNotificationPreferenceAction — autorisation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimit.mockReturnValue(true);
    setOwnNotificationPreference.mockResolvedValue(undefined);
  });

  it("refuse toute écriture sans session serveur", async () => {
    getCurrentUser.mockResolvedValue(null);
    const formData = new FormData();
    formData.set("category", "SESSION");
    formData.set("enabled", "false");

    await expect(updateNotificationPreferenceAction(formData)).rejects.toThrow("REDIRECT:/");
    expect(setOwnNotificationPreference).not.toHaveBeenCalled();
  });

  it("ignore un userId forgé et écrit exclusivement pour l'utilisateur de la session", async () => {
    getCurrentUser.mockResolvedValue({ id: "authenticated-user" });
    const formData = new FormData();
    formData.set("userId", "victim-user");
    formData.set("category", "ROULETTE");
    formData.set("enabled", "false");

    await expect(updateNotificationPreferenceAction(formData)).rejects.toThrow(
      "REDIRECT:/profil/parametres?notifications=ok"
    );
    expect(setOwnNotificationPreference).toHaveBeenCalledWith(
      "authenticated-user",
      "ROULETTE",
      false
    );
    expect(setOwnNotificationPreference).not.toHaveBeenCalledWith(
      "victim-user",
      expect.anything(),
      expect.anything()
    );
  });

  it("refuse une catégorie ou une valeur hors contrat", async () => {
    getCurrentUser.mockResolvedValue({ id: "authenticated-user" });
    const formData = new FormData();
    formData.set("category", "TOURNAMENT");
    formData.set("enabled", "yes");

    await expect(updateNotificationPreferenceAction(formData)).rejects.toThrow(
      "REDIRECT:/profil/parametres?notifications=invalide"
    );
    expect(setOwnNotificationPreference).not.toHaveBeenCalled();
  });
});
