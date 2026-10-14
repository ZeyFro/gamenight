import { beforeEach, describe, expect, it, vi } from "vitest";

const { userFindMany, preferenceFindMany, sessionInviteFindMany, postToDiscord, createNotifications } = vi.hoisted(
  () => ({
    userFindMany: vi.fn(),
    preferenceFindMany: vi.fn(),
    sessionInviteFindMany: vi.fn(),
    postToDiscord: vi.fn(),
    createNotifications: vi.fn(),
  })
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: userFindMany },
    userNotificationPreference: { findMany: preferenceFindMany },
    sessionInvite: { findMany: sessionInviteFindMany },
  },
}));
vi.mock("@/lib/discord", () => ({
  ACCENT_COLOR: 0x8b5cf6,
  postToDiscord,
  WEBHOOK_ANNOUNCE_DISABLED_FOR_PRIVACY: "confidentialite_soirees_webhook_public_desactive",
}));
vi.mock("@/lib/notifications", () => ({ createNotifications }));

import { announceSessionCreated } from "./discord-session-created";

/**
 * Chantier confidentialité des soirées — ce chemin webhook n'a plus
 * AUCUNE annonce Discord publique (voir le commentaire de fonction de
 * `announceSessionCreated`) : cette suite, qui vérifiait auparavant que
 * l'annonce collective partait toujours même quand tout le monde refuse,
 * vérifie désormais l'inverse (jamais de POST Discord) PLUS la nouvelle
 * restriction par invitation active.
 */
describe("annonce webhook de création — supprimée par confidentialité, notifications internes filtrées", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ne poste JAMAIS dans Discord (salon public, aucun mécanisme privé pour ce chemin legacy)", async () => {
    userFindMany.mockResolvedValue([
      { id: "u-accepte", discordId: "discord-accepte", silenceReminders: false },
    ]);
    preferenceFindMany.mockResolvedValue([]);
    sessionInviteFindMany.mockResolvedValue([{ userId: "u-accepte" }]);

    const result = await announceSessionCreated(
      {
        id: "session-1",
        createdById: "creator",
        date: new Date("2026-09-20T20:00:00Z"),
        votingDeadline: new Date("2026-09-19T20:00:00Z"),
        communityId: "community-1",
        notifiedUserIds: ["u-accepte"],
      },
      { id: "creator", discordId: "discord-creator" }
    );

    expect(postToDiscord).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: "confidentialite_soirees_webhook_public_desactive" });
  });

  it("aucune notification interne pour un refus de préférence SESSION", async () => {
    userFindMany.mockResolvedValue([
      { id: "u-refuse", discordId: "discord-refuse", silenceReminders: false },
    ]);
    preferenceFindMany.mockResolvedValue([{ userId: "u-refuse", enabled: false }]);
    sessionInviteFindMany.mockResolvedValue([{ userId: "u-refuse" }]);

    await announceSessionCreated(
      {
        id: "session-1",
        createdById: "creator",
        date: new Date("2026-09-20T20:00:00Z"),
        votingDeadline: new Date("2026-09-19T20:00:00Z"),
        communityId: "community-1",
        notifiedUserIds: ["u-refuse"],
      },
      { id: "creator", discordId: "discord-creator" }
    );

    expect(createNotifications).toHaveBeenCalledWith([]);
  });

  it("aucune notification interne pour un invité dont l'invitation n'est plus active (révoquée)", async () => {
    userFindMany.mockResolvedValue([
      { id: "u-revoque", discordId: "discord-revoque", silenceReminders: false },
    ]);
    preferenceFindMany.mockResolvedValue([]);
    // Aucune ligne ACTIVE retournée pour cet utilisateur — `filterByActiveSessionInvite`
    // (session-access.ts) l'exclut donc, même s'il aurait accepté la préférence SESSION.
    sessionInviteFindMany.mockResolvedValue([]);

    await announceSessionCreated(
      {
        id: "session-1",
        createdById: "creator",
        date: new Date("2026-09-20T20:00:00Z"),
        votingDeadline: new Date("2026-09-19T20:00:00Z"),
        communityId: "community-1",
        notifiedUserIds: ["u-revoque"],
      },
      { id: "creator", discordId: "discord-creator" }
    );

    expect(createNotifications).toHaveBeenCalledWith([]);
  });

  it("notification interne écrite pour un invité actif qui accepte la préférence SESSION", async () => {
    userFindMany.mockResolvedValue([
      { id: "u-accepte", discordId: "discord-accepte", silenceReminders: false },
    ]);
    preferenceFindMany.mockResolvedValue([]);
    sessionInviteFindMany.mockResolvedValue([{ userId: "u-accepte" }]);

    await announceSessionCreated(
      {
        id: "session-1",
        createdById: "creator",
        date: new Date("2026-09-20T20:00:00Z"),
        votingDeadline: new Date("2026-09-19T20:00:00Z"),
        communityId: "community-1",
        notifiedUserIds: ["u-accepte"],
      },
      { id: "creator", discordId: "discord-creator" }
    );

    expect(createNotifications).toHaveBeenCalledWith([
      expect.objectContaining({ userId: "u-accepte", type: "SESSION_CREATED" }),
    ]);
  });
});
