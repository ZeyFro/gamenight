import { beforeEach, describe, expect, it, vi } from "vitest";

const { sessionFindUnique, userFindUnique, deliveryFindFirst, activeCommunity, sourceMatches, inviteFilter, memberCheck, channelFilter } = vi.hoisted(() => ({
  sessionFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  deliveryFindFirst: vi.fn(),
  activeCommunity: vi.fn(),
  sourceMatches: vi.fn(),
  inviteFilter: vi.fn(),
  memberCheck: vi.fn(),
  channelFilter: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {
  session: { findUnique: sessionFindUnique }, user: { findUnique: userFindUnique },
  notificationDelivery: { findFirst: deliveryFindFirst },
} }));
vi.mock("@/lib/community-channels", () => ({ resolveSessionAnnounceConfig: vi.fn().mockResolvedValue({ guildId: "guild-1", channelId: "channel-1" }) }));
vi.mock("@/lib/community-isolation", () => ({ isMemberOfCommunity: memberCheck, isCommunityIsolationEnabled: () => true }));
vi.mock("@/lib/notification-delivery", () => ({
  notificationEventMatchesSource: sourceMatches,
  isNotificationEventCommunityActive: activeCommunity,
  createNotificationEvent: vi.fn(), enqueueDelivery: vi.fn(), hasUnsettledDeliveriesWithPrefix: vi.fn(),
}));
vi.mock("@/lib/session-access", () => ({ filterByActiveSessionInvite: inviteFilter }));
vi.mock("@/lib/notification-channel-preferences", () => ({ filterUsersByNotificationChannelPreference: channelFilter }));
vi.mock("@/lib/notifications", () => ({ createNotifications: vi.fn() }));
vi.mock("@/lib/notification-executor-kick", () => ({ kickNotificationExecutor: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { sessionAnnounceResolver } from "./session-announce";

const recipient = { id: "player-1", discordId: "discord-1", silenceReminders: false, discordName: "Player" };
const event = { sourceId: "session-1", communityId: "community-1", category: "SESSION", eventType: "SESSION_DM", payload: null } as never;
const delivery = (role: string, operation: "SEND" | "EDIT" = "SEND") => ({
  targetSlot: `default-guild:SESSION:session-1:${role}`,
  operation,
  channel: role.startsWith("dm-fallback:") ? "DISCORD_CHANNEL" : "DISCORD_DM",
}) as never;

describe("session DM channel preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeCommunity.mockResolvedValue(true);
    sourceMatches.mockResolvedValue(true);
    memberCheck.mockResolvedValue(true);
    inviteFilter.mockImplementation(async (_id: string, _creator: string, users: typeof recipient[]) => users);
    channelFilter.mockResolvedValue([]);
    deliveryFindFirst.mockImplementation(async ({ where }: { where: { targetSlot: string } }) =>
      where.targetSlot.endsWith(":thread")
        ? { discordThreadId: "thread-1" }
        : { discordMessageId: "message-1", discordChannelId: "dm-1" }
    );
    sessionFindUnique.mockResolvedValue({
      id: "session-1", communityId: "community-1", createdById: "creator-1", createdViaRoulette: false,
      deferredRoulette: false, notifiedUserIds: [recipient.id], status: "VOTING", date: new Date("2026-11-10T18:00:00Z"),
      votingDeadline: new Date("2026-11-10T17:00:00Z"), attendanceCapacity: null, proposals: [], seats: [],
      createdBy: { discordName: "Creator" }, invites: [],
    });
    userFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === recipient.id ? recipient : { ...recipient, id: "creator-1", discordId: "discord-creator" }
    );
  });

  it("relit DISCORD_DM au SEND et refuse un opt-out intervenu après la mise en file", async () => {
    const result = await sessionAnnounceResolver.resolve({ delivery: delivery("dm:announce:player-1"), event, now: new Date() });
    expect(result).toEqual({ eligible: false, reason: "preference_declined" });
    expect(channelFilter).toHaveBeenCalledWith([recipient], "SESSION", "DISCORD_DM");
  });

  it("met à jour le MP existant en EDIT sans le transformer en nouveau ping", async () => {
    const result = await sessionAnnounceResolver.resolve({ delivery: delivery("dm:announce:player-1", "EDIT"), event, now: new Date() });
    expect(result).toMatchObject({ eligible: true, action: { kind: "edit_channel_message", messageId: "message-1" } });
    expect(channelFilter).not.toHaveBeenCalled();
  });

  it("refuse le fallback dans le fil dès que DISCORD_MENTION est désactivé", async () => {
    const result = await sessionAnnounceResolver.resolve({ delivery: delivery("dm-fallback:announce:creator-1"), event, now: new Date() });
    expect(result).toEqual({ eligible: false, reason: "preference_declined" });
    expect(channelFilter).toHaveBeenCalledWith([expect.objectContaining({ id: "creator-1" })], "SESSION", "DISCORD_MENTION");
  });
});
