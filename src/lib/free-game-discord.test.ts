import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  offers: vi.fn(),
  createEvent: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { community: { findMany: mocks.findMany } } }));
vi.mock("@/lib/gamerpower-free-games", () => ({ listAutomaticFreeGameOffers: mocks.offers }));
vi.mock("@/lib/notification-delivery", () => ({
  createNotificationEvent: mocks.createEvent,
  enqueueDelivery: mocks.enqueue,
}));

import { enqueueFreeGameAnnouncements } from "./free-game-discord";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("FREE_GAME_FEED_ENABLED", "true");
  vi.stubEnv("COMMUNITY_CHANNELS_ENABLED", "true");
  vi.stubEnv("DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED", "true");
  vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
  vi.stubEnv("DISCORD_BOT_TOKEN", "test-token");
  mocks.offers.mockResolvedValue([{
    id: "gamerpower-steam-42", store: "STEAM", title: "Portal", storeUrl: "https://store.steampowered.com/app/620/Portal/", source: "gamerpower",
  }]);
  mocks.findMany.mockResolvedValue([{
    id: "community-1", discordGuildId: "12345678901234567",
    channelConfigs: [{ discordChannelId: "23456789012345678" }],
  }]);
  mocks.createEvent.mockResolvedValue({ id: "event-1" });
});

describe("enqueueFreeGameAnnouncements", () => {
  it.each(["FREE_GAME_FEED_ENABLED", "COMMUNITY_CHANNELS_ENABLED", "DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED", "NOTIFICATION_EXECUTOR_ENABLED"])("ne crée rien quand %s est désactivé", async (flag) => {
    vi.stubEnv(flag, "false");
    await expect(enqueueFreeGameAnnouncements()).resolves.toEqual({ communities: 0, offers: 0, enqueued: 0 });

    expect(mocks.offers).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("met chaque offre en file une fois par communauté avec des clés stables", async () => {
    await expect(enqueueFreeGameAnnouncements()).resolves.toEqual({ communities: 1, offers: 1, enqueued: 1 });

    expect(mocks.createEvent).toHaveBeenCalledWith(expect.objectContaining({
      communityId: "community-1", category: "REWARD", eventType: "COMMUNITY_SYSTEM_ANNOUNCE",
      sourceId: "gamerpower-steam-42", occurrence: "community-1",
      payload: expect.objectContaining({ channelCategory: "FREE_GAMES" }),
    }));
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "ACTIVE", freeGamesEnabled: true }),
    }));
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "event-1", channel: "DISCORD_CHANNEL", transport: "BOT",
      recipientKey: "community:community-1",
      targetSlot: "12345678901234567:FREE_GAMES:gamerpower-steam-42:23456789012345678:announce",
    }));
  });

  it("ignore les salons invalides et distingue les destinations lorsque plusieurs communautés sont configurées", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "invalid", slug: "other", discordGuildId: "bad", channelConfigs: [{ discordChannelId: "23456789012345678" }] },
      { id: "community-2", slug: "other", discordGuildId: "333333333333333333", channelConfigs: [{ discordChannelId: "444444444444444444" }] },
      { id: "community-3", slug: "other", discordGuildId: "555555555555555555", channelConfigs: [{ discordChannelId: "666666666666666666" }] },
    ]);

    await expect(enqueueFreeGameAnnouncements()).resolves.toEqual({ communities: 3, offers: 1, enqueued: 2 });

    expect(mocks.createEvent).toHaveBeenCalledTimes(2);
    expect(new Set(mocks.enqueue.mock.calls.map(([delivery]) => delivery.targetSlot))).toEqual(new Set([
      "333333333333333333:FREE_GAMES:gamerpower-steam-42:444444444444444444:announce",
      "555555555555555555:FREE_GAMES:gamerpower-steam-42:666666666666666666:announce",
    ]));
  });
});
