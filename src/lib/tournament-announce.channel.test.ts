import { beforeEach, describe, expect, it, vi } from "vitest";

const { tournamentFindUnique, userFindUnique, deliveryFindFirst, activeCommunity, sourceMatches, memberCheck, channelFilter } = vi.hoisted(() => ({
  tournamentFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  deliveryFindFirst: vi.fn(),
  activeCommunity: vi.fn(),
  sourceMatches: vi.fn(),
  memberCheck: vi.fn(),
  channelFilter: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {
  tournament: { findUnique: tournamentFindUnique }, user: { findUnique: userFindUnique },
  notificationDelivery: { findFirst: deliveryFindFirst },
} }));
vi.mock("@/lib/community-channels", () => ({ resolveTournamentAnnounceConfig: vi.fn().mockResolvedValue({ guildId: "guild-1", channelId: "channel-1" }) }));
vi.mock("@/lib/community-isolation", () => ({ isMemberOfCommunity: memberCheck, isCommunityIsolationEnabled: () => true }));
vi.mock("@/lib/notification-delivery", () => ({
  notificationEventMatchesSource: sourceMatches,
  isNotificationEventCommunityActive: activeCommunity,
  createNotificationEvent: vi.fn(), enqueueDelivery: vi.fn(),
}));
vi.mock("@/lib/notification-channel-preferences", () => ({ filterUsersByNotificationChannelPreference: channelFilter }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { tournamentAnnounceResolver } from "./tournament-announce";

const event = { sourceId: "tournament-1", communityId: "community-1", category: "TOURNAMENT", eventType: "TOURNAMENT_DM_FALLBACK", payload: null } as never;
const delivery = { targetSlot: "default-guild:TOURNAMENT:tournament-1:dm-fallback:announce:creator-1", operation: "SEND", channel: "DISCORD_CHANNEL" } as never;
const creator = { id: "creator-1", discordId: "discord-creator", silenceReminders: false };

describe("tournament mention fallback preference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeCommunity.mockResolvedValue(true);
    sourceMatches.mockResolvedValue(true);
    memberCheck.mockResolvedValue(true);
    channelFilter.mockResolvedValue([]);
    tournamentFindUnique.mockResolvedValue({
      id: "tournament-1", communityId: "community-1", createdById: "creator-1", notifiedUserIds: [],
      name: "Tournoi", status: "REGISTRATION", startsAt: new Date("2026-12-01T18:00:00Z"),
      discordGuildId: "guild-1", discordChannelId: "channel-1", matches: [],
    });
    userFindUnique.mockResolvedValue(creator);
    deliveryFindFirst.mockResolvedValue({ discordThreadId: "thread-1" });
  });

  it("ne transforme pas un MP fermé en mention après désactivation de DISCORD_MENTION", async () => {
    const result = await tournamentAnnounceResolver.resolve({ delivery, event, now: new Date() });
    expect(result).toEqual({ eligible: false, reason: "preference_declined" });
    expect(channelFilter).toHaveBeenCalledWith([creator], "TOURNAMENT", "DISCORD_MENTION");
  });
});
