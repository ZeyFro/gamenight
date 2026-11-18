import { beforeEach, describe, expect, it, vi } from "vitest";

const { rouletteFindUnique, userFindUnique, sessionFindUnique, deliveryFindFirst, isMember, filterInvite, channelFilter } = vi.hoisted(() => ({
  rouletteFindUnique: vi.fn(),
  userFindUnique: vi.fn(),
  sessionFindUnique: vi.fn(),
  deliveryFindFirst: vi.fn(),
  isMember: vi.fn(),
  filterInvite: vi.fn(),
  channelFilter: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {
  roulette: { findUnique: rouletteFindUnique }, user: { findUnique: userFindUnique },
  session: { findUnique: sessionFindUnique }, notificationDelivery: { findFirst: deliveryFindFirst },
} }));
vi.mock("@/lib/community-isolation", () => ({ isMemberOfCommunity: isMember }));
vi.mock("@/lib/session-access", () => ({ filterByActiveSessionInvite: filterInvite }));
vi.mock("@/lib/notification-channel-preferences", () => ({ filterUsersByNotificationChannelPreference: channelFilter }));
vi.mock("@/lib/discord-bot-config", () => ({ isRouletteDirectMessageEnabled: () => true, isSessionDirectMessageEnabled: () => true }));
vi.mock("@/lib/discord-dm", () => ({ enqueueDirectMessages: vi.fn(), enqueueDirectMessageEdits: vi.fn(), parseDmRole: (role: string, prefix: string) => {
  if (!role.startsWith(prefix)) return null;
  const parts = role.slice(prefix.length).split(":");
  return { kind: parts.slice(0, -1).join(":"), userId: parts.at(-1) };
} }));

import { rouletteDmResolver } from "./roulette-dm";

const recipient = { id: "user-1", discordId: "discord-1", silenceReminders: false };
const delivery = (operation: "SEND" | "EDIT") => ({
  targetSlot: "default-guild:ROULETTE:roulette-1:dm:created:user-1",
  operation,
  channel: "DISCORD_DM",
}) as never;
const event = { sourceId: "roulette-1" } as never;

describe("roulette DM channel preference", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rouletteFindUnique.mockResolvedValue({
      id: "roulette-1", status: "OPEN", resultSessionId: null, communityId: "community-1",
      createdById: "creator-1", notifiedUserIds: ["user-1"], scheduledAt: new Date("2026-11-10T18:00:00Z"),
      deadline: new Date("2026-11-10T18:00:00Z"),
    });
    userFindUnique.mockResolvedValue(recipient);
    isMember.mockResolvedValue(true);
    channelFilter.mockResolvedValue([]);
    sessionFindUnique.mockResolvedValue({ id: "session-1", createdById: "creator-1", decidedGame: { name: "Jeu" } });
    filterInvite.mockImplementation(async (_id: string, _creator: string, users: typeof recipient[]) => [users[0]]);
    deliveryFindFirst.mockResolvedValue({ discordMessageId: "message-1", discordChannelId: "dm-1" });
  });

  it("rechecke DISCORD_DM au SEND et laisse le participant sans DM", async () => {
    const result = await rouletteDmResolver.resolve({ delivery: delivery("SEND"), event, now: new Date() });
    expect(result).toEqual({ eligible: false, reason: "preference_declined" });
    expect(channelFilter).toHaveBeenCalledWith([recipient], "ROULETTE", "DISCORD_DM");
  });

  it("édite le MP déjà livré malgré un opt-out intervenu après le SEND", async () => {
    rouletteFindUnique.mockResolvedValue({
      id: "roulette-1", status: "DONE", resultSessionId: "session-1", communityId: "community-1",
      createdById: "creator-1", notifiedUserIds: ["user-1"], scheduledAt: new Date("2026-11-10T18:00:00Z"),
      deadline: new Date("2026-11-10T18:00:00Z"),
    });
    const result = await rouletteDmResolver.resolve({ delivery: delivery("EDIT"), event, now: new Date() });
    expect(result).toMatchObject({ eligible: true, action: { kind: "edit_channel_message", messageId: "message-1" } });
    expect(channelFilter).not.toHaveBeenCalled();
  });
});
