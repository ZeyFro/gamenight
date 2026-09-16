import { beforeEach, describe, expect, it, vi } from "vitest";

const { userFindMany, preferenceFindMany, postToDiscord } = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  preferenceFindMany: vi.fn(),
  postToDiscord: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: userFindMany },
    userNotificationPreference: { findMany: preferenceFindMany },
  },
}));
vi.mock("@/lib/discord", () => ({
  ACCENT_COLOR: 0x8b5cf6,
  DESTRUCTIVE_COLOR: 0xff0000,
  postToDiscord,
}));
vi.mock("@/lib/notifications", () => ({ createNotifications: vi.fn() }));

import { announceRouletteReminder } from "./discord-roulette";

describe("rappel collectif de roulette et préférences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postToDiscord.mockResolvedValue({ ok: true });
  });

  it("publie encore l'annonce du salon quand tous les destinataires refusent la mention", async () => {
    userFindMany.mockResolvedValue([
      { id: "u-refuse", discordId: "discord-refuse", silenceReminders: false },
    ]);
    preferenceFindMany.mockResolvedValue([{ userId: "u-refuse", enabled: false }]);

    await announceRouletteReminder(
      { id: "roulette-1", deadline: new Date("2026-09-20T20:00:00Z") },
      ["u-refuse"]
    );

    expect(postToDiscord).toHaveBeenCalledOnce();
    expect(postToDiscord.mock.calls[0][1]).toBeUndefined();
  });
});
