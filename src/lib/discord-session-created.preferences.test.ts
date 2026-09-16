import { beforeEach, describe, expect, it, vi } from "vitest";

const { userFindMany, preferenceFindMany, postToDiscord, createNotifications } = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  preferenceFindMany: vi.fn(),
  postToDiscord: vi.fn(),
  createNotifications: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: userFindMany },
    userNotificationPreference: { findMany: preferenceFindMany },
  },
}));
vi.mock("@/lib/discord", () => ({
  ACCENT_COLOR: 0x8b5cf6,
  postToDiscord,
}));
vi.mock("@/lib/message-templates", () => ({
  pickMessageTemplate: vi.fn().mockResolvedValue("Une nouvelle soirée arrive !"),
}));
vi.mock("@/lib/notifications", () => ({ createNotifications }));

import { announceSessionCreated } from "./discord-session-created";

describe("annonce collective et préférences personnelles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postToDiscord.mockResolvedValue({ ok: true });
  });

  it("poste toujours l'annonce sans mention ni notification interne quand tous refusent", async () => {
    userFindMany.mockResolvedValue([
      { id: "u-refuse", discordId: "discord-refuse", silenceReminders: false },
    ]);
    preferenceFindMany.mockResolvedValue([{ userId: "u-refuse", enabled: false }]);

    await announceSessionCreated(
      {
        id: "session-1",
        date: new Date("2026-09-20T20:00:00Z"),
        votingDeadline: new Date("2026-09-19T20:00:00Z"),
        notifiedUserIds: ["u-refuse"],
      },
      { id: "creator", discordId: "discord-creator" }
    );

    expect(createNotifications).toHaveBeenCalledWith([]);
    expect(postToDiscord).toHaveBeenCalledOnce();
    const [, content] = postToDiscord.mock.calls[0];
    expect(content).toBe("Une nouvelle soirée arrive !");
    expect(content).not.toContain("discord-refuse");
  });
});
