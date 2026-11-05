import { beforeEach, describe, expect, it, vi } from "vitest";

const { categoryFindMany, channelFindMany, channelUpsert } = vi.hoisted(() => ({
  categoryFindMany: vi.fn(),
  channelFindMany: vi.fn(),
  channelUpsert: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    userNotificationPreference: { findMany: categoryFindMany },
    userNotificationChannelPreference: { findMany: channelFindMany, upsert: channelUpsert },
  },
}));

import {
  filterUsersByNotificationChannelPreference,
  isCoveredNotificationChannel,
  isAvailableNotificationChannel,
  resolveNotificationChannelEnabled,
  setOwnNotificationChannelPreference,
} from "./notification-channel-preferences";

describe("notification-channel-preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    categoryFindMany.mockResolvedValue([]);
    channelFindMany.mockResolvedValue([]);
    channelUpsert.mockResolvedValue(undefined);
  });

  it("garde le comportement historique quand aucune préférence de canal n'existe", () => {
    expect(resolveNotificationChannelEnabled({ silenceReminders: false }, "SESSION", "DISCORD_DM")).toBe(true);
    expect(resolveNotificationChannelEnabled({ silenceReminders: true }, "SESSION", "DISCORD_DM")).toBe(false);
  });

  it("un refus catégoriel ne peut pas être réactivé par un canal activé", () => {
    expect(resolveNotificationChannelEnabled({
      silenceReminders: false,
      notificationPreferences: [{ category: "SESSION", enabled: false }],
    }, "SESSION", "IN_APP", { enabled: true })).toBe(false);
  });

  it("n'applique le refus de canal qu'au canal demandé", () => {
    const user = { silenceReminders: false, notificationPreferences: [{ category: "SESSION" as const, enabled: true }] };
    expect(resolveNotificationChannelEnabled(user, "SESSION", "DISCORD_DM", { enabled: false })).toBe(false);
    expect(resolveNotificationChannelEnabled(user, "SESSION", "IN_APP")).toBe(true);
  });

  it("valide seulement les canaux supportés", () => {
    expect(isAvailableNotificationChannel("WEB_PUSH")).toBe(true);
    expect(isAvailableNotificationChannel("DISCORD_MENTION")).toBe(true);
    expect(isAvailableNotificationChannel("DISCORD_CHANNEL")).toBe(false);
  });

  it("n'expose pas un canal qui n'est pas appliqué à tous les parcours de sa catégorie", () => {
    expect(isCoveredNotificationChannel("SESSION", "DISCORD_MENTION")).toBe(true);
    expect(isCoveredNotificationChannel("ROULETTE", "DISCORD_MENTION")).toBe(false);
    expect(isCoveredNotificationChannel("TOURNAMENT", "IN_APP")).toBe(false);
    expect(isCoveredNotificationChannel("INSTANT_SESSION", "WEB_PUSH")).toBe(false);
    expect(isCoveredNotificationChannel("REWARD", "IN_APP")).toBe(true);
    expect(isCoveredNotificationChannel("REWARD", "WEB_PUSH")).toBe(false);
  });

  it("lit les préférences par lots et ne réintroduit aucun utilisateur", async () => {
    categoryFindMany.mockResolvedValue([{ userId: "allowed", enabled: true }]);
    channelFindMany.mockResolvedValue([{ userId: "allowed", enabled: false }]);
    const candidates = [
      { id: "allowed", silenceReminders: true },
      { id: "legacy-disabled", silenceReminders: true },
    ];

    await expect(filterUsersByNotificationChannelPreference(candidates, "SESSION", "DISCORD_DM")).resolves.toEqual([]);
    expect(categoryFindMany).toHaveBeenCalledOnce();
    expect(channelFindMany).toHaveBeenCalledWith({
      where: { userId: { in: candidates.map(({ id }) => id) }, category: "SESSION", channel: "DISCORD_DM" },
      select: { userId: true, enabled: true },
    });
  });

  it("écrit le canal uniquement pour l'identité authentifiée", async () => {
    await setOwnNotificationChannelPreference("session-user", "SESSION", "DISCORD_DM", false);
    expect(channelUpsert).toHaveBeenCalledWith({
      where: { userId_category_channel: { userId: "session-user", category: "SESSION", channel: "DISCORD_DM" } },
      create: { userId: "session-user", category: "SESSION", channel: "DISCORD_DM", enabled: false },
      update: { enabled: false },
    });
  });
});
