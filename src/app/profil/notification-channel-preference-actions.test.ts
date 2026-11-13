import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUser, isAvailableNotificationCategory, isAvailableNotificationChannel, isCoveredNotificationChannel, setOwnNotificationChannelPreference, redirect, checkRateLimit } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  isAvailableNotificationCategory: vi.fn((value: string) => ["SESSION", "ROULETTE"].includes(value)),
  isAvailableNotificationChannel: vi.fn((value: string) => ["IN_APP", "WEB_PUSH", "DISCORD_DM", "DISCORD_MENTION"].includes(value)),
  isCoveredNotificationChannel: vi.fn((category: string, channel: string) => category === "SESSION" || channel !== "DISCORD_MENTION"),
  setOwnNotificationChannelPreference: vi.fn(),
  redirect: vi.fn((location: string) => { throw new Error(`REDIRECT:${location}`); }),
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser }));
vi.mock("@/lib/notification-preferences", () => ({ isAvailableNotificationCategory }));
vi.mock("@/lib/notification-channel-preferences", () => ({
  isAvailableNotificationChannel,
  isCoveredNotificationChannel,
  setOwnNotificationChannelPreference,
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

import { updateNotificationChannelPreferenceAction } from "./notification-channel-actions";

describe("updateNotificationChannelPreferenceAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimit.mockReturnValue(true);
    setOwnNotificationChannelPreference.mockResolvedValue(undefined);
  });

  it("n'écrit rien sans session serveur", async () => {
    getCurrentUser.mockResolvedValue(null);
    const form = new FormData();
    form.set("category", "SESSION");
    form.set("channel", "DISCORD_DM");
    form.set("enabled", "false");
    await expect(updateNotificationChannelPreferenceAction(form)).rejects.toThrow("REDIRECT:/");
    expect(setOwnNotificationChannelPreference).not.toHaveBeenCalled();
  });

  it("écrit seulement pour l'utilisateur authentifié", async () => {
    getCurrentUser.mockResolvedValue({ id: "logged-user" });
    const form = new FormData();
    form.set("userId", "victim");
    form.set("category", "SESSION");
    form.set("channel", "DISCORD_DM");
    form.set("enabled", "false");
    await expect(updateNotificationChannelPreferenceAction(form)).rejects.toThrow("REDIRECT:/profil/parametres?notifications=ok");
    expect(setOwnNotificationChannelPreference).toHaveBeenCalledWith("logged-user", "SESSION", "DISCORD_DM", false);
  });

  it("refuse une combinaison ou une valeur hors contrat", async () => {
    getCurrentUser.mockResolvedValue({ id: "logged-user" });
    const form = new FormData();
    form.set("category", "ROULETTE");
    form.set("channel", "DISCORD_MENTION");
    form.set("enabled", "yes");
    await expect(updateNotificationChannelPreferenceAction(form)).rejects.toThrow("REDIRECT:/profil/parametres?notifications=invalide");
    expect(setOwnNotificationChannelPreference).not.toHaveBeenCalled();
  });
});
