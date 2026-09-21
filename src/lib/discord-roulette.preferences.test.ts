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
  WEBHOOK_ANNOUNCE_DISABLED_FOR_PRIVACY: "confidentialite_soirees_webhook_public_desactive",
}));
vi.mock("@/lib/notifications", () => ({ createNotifications: vi.fn() }));

import { announceRouletteReminder } from "./discord-roulette";

/**
 * Chantier confidentialité des soirées — ce rappel de roulette n'a plus
 * AUCUNE annonce Discord publique (voir le commentaire de fonction de
 * `announceRouletteReminder`, discord-roulette.ts) : cette suite, qui
 * vérifiait auparavant que l'annonce du salon partait toujours même
 * quand tout le monde refuse la mention, vérifie désormais l'inverse
 * (jamais de POST Discord, quelle que soit la préférence).
 */
describe("rappel collectif de roulette — supprimé par confidentialité", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postToDiscord.mockResolvedValue({ ok: true });
  });

  it("ne poste JAMAIS dans Discord, même quand tous les destinataires refusent la mention", async () => {
    userFindMany.mockResolvedValue([
      { id: "u-refuse", discordId: "discord-refuse", silenceReminders: false },
    ]);
    preferenceFindMany.mockResolvedValue([{ userId: "u-refuse", enabled: false }]);

    const result = await announceRouletteReminder(
      { id: "roulette-1", deadline: new Date("2026-09-20T20:00:00Z") },
      ["u-refuse"]
    );

    expect(postToDiscord).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: "confidentialite_soirees_webhook_public_desactive" });
  });
});
