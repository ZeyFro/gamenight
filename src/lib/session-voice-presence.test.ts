import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  userFindMany: vi.fn(),
  sessionFindFirst: vi.fn(),
  transaction: vi.fn(),
  membershipQueryRaw: vi.fn(),
  intervalUpsert: vi.fn(),
  intervalGroupBy: vi.fn(),
  accessRole: vi.fn(),
  isolationEnabled: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {
  $transaction: mocks.transaction,
  user: { findUnique: mocks.userFindUnique, findFirst: mocks.userFindFirst, findMany: mocks.userFindMany },
  session: { findFirst: mocks.sessionFindFirst },
  sessionVoicePresenceInterval: { upsert: mocks.intervalUpsert, groupBy: mocks.intervalGroupBy },
} }));
vi.mock("@/lib/session-access", () => ({ getSessionAccessRole: mocks.accessRole }));
vi.mock("@/lib/community-isolation", () => ({
  isCommunityIsolationEnabled: mocks.isolationEnabled,
}));

import { readSessionVoicePresence, sessionVoiceConfig, storeSessionVoiceInterval } from "./session-voice-presence";

const env = {
  VOICE_PRESENCE_ENABLED: "true",
  VOICE_PRESENCE_GUILD_ID: "123456789012345678",
  VOICE_PRESENCE_SESSION_ID: "session-test",
  VOICE_PRESENCE_CHANNEL_IDS: "456789012345678901",
};
const interval = { memberKey: "789012345678901234", channelId: "456789012345678901", startedAt: 1_800_000, endedAt: 1_860_000 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isolationEnabled.mockReturnValue(true);
  mocks.membershipQueryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const query = strings.join("");
    if (query.includes('FROM "User"')) return [{ id: "user-1" }];
    if (query.includes('FROM "Session"')) return [{ id: "session-test", createdById: "creator-id", communityId: "community-1" }];
    if (query.includes('FROM "Community"')) return [{ id: "community-1" }];
    if (query.includes('FROM "CommunityChannelConfig"')) return [{ id: "voice-config" }];
    if (query.includes('FROM "SessionInvite"')) return [{ id: "invite-1" }];
    if (query.includes('FROM "Membership"')) return [{ userId: "user-1" }];
    return [];
  });
  mocks.transaction.mockImplementation(async (work: (tx: {
    $queryRaw: typeof mocks.membershipQueryRaw;
    sessionVoicePresenceInterval: { upsert: typeof mocks.intervalUpsert };
  }) => Promise<unknown>) => work({
    $queryRaw: mocks.membershipQueryRaw,
    sessionVoicePresenceInterval: { upsert: mocks.intervalUpsert },
  }));
  process.env.VOICE_PRESENCE_ENABLED = "true";
  process.env.DISCORD_BOT_GUILD_ID = "";
});

describe("voice presence session link (synthetic DB doubles)", () => {
  it("keeps collection disabled unless the explicit flag is true", async () => {
    expect(sessionVoiceConfig({})).toBeNull();
    process.env.VOICE_PRESENCE_ENABLED = "false";
    expect(await storeSessionVoiceInterval(null, interval)).toBe(false);
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });

  it("requires a configured session, community guild and enabled voice channel", async () => {
    const config = sessionVoiceConfig(env)!;
    mocks.userFindUnique.mockResolvedValue({ id: "user-1" });
    mocks.sessionFindFirst.mockResolvedValue(null);
    expect(await storeSessionVoiceInterval(config, { ...interval, channelId: "000000000000000000" })).toBe(false);
    expect(mocks.sessionFindFirst).not.toHaveBeenCalled();
    expect(await storeSessionVoiceInterval(config, interval)).toBe(false);
    expect(mocks.sessionFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "session-test", status: "SCHEDULED", OR: expect.any(Array) }) }));
    expect(mocks.intervalUpsert).not.toHaveBeenCalled();
  });

  it("stores intervals for the default community through its configured bot guild fallback", async () => {
    const fallbackGuildId = env.VOICE_PRESENCE_GUILD_ID;
    process.env.DISCORD_BOT_GUILD_ID = fallbackGuildId;
    const config = sessionVoiceConfig({ ...env, DISCORD_BOT_GUILD_ID: fallbackGuildId })!;
    mocks.userFindUnique.mockResolvedValue({ id: "user-1" });
    mocks.sessionFindFirst.mockResolvedValue({ id: "session-test", communityId: "community-1" });
    mocks.intervalUpsert.mockResolvedValue({});
    mocks.membershipQueryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("");
      if (query.includes('FROM "User"')) return [{ id: "user-1" }];
      if (query.includes('FROM "Session"')) return [{ id: "session-test", createdById: "creator-id", communityId: "community-1" }];
      if (query.includes('FROM "Community"')) {
        return values.at(-1) === true && query.includes('"slug" = \'default\'') && query.includes('"discordGuildId" IS NULL')
          ? [{ id: "community-1" }]
          : [];
      }
      if (query.includes('FROM "CommunityChannelConfig"')) return [{ id: "voice-config" }];
      if (query.includes('FROM "SessionInvite"')) return [{ id: "invite-1" }];
      if (query.includes('FROM "Membership"')) return [{ userId: "user-1" }];
      return [];
    });

    expect(await storeSessionVoiceInterval(config, interval)).toBe(true);
    expect(mocks.sessionFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ community: { is: expect.objectContaining({
        OR: [
          { discordGuildId: fallbackGuildId },
          { slug: "default", discordGuildId: null },
        ],
      }) } }),
    }));
    expect(mocks.intervalUpsert).toHaveBeenCalledOnce();
  });

  it("does not use the default-community fallback for another bot guild", async () => {
    const config = sessionVoiceConfig({ ...env, DISCORD_BOT_GUILD_ID: "987654321098765432" })!;
    mocks.userFindUnique.mockResolvedValue({ id: "user-1" });
    mocks.sessionFindFirst.mockResolvedValue({ id: "session-test", communityId: "community-1" });
    mocks.membershipQueryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const query = strings.join("");
      if (query.includes('FROM "User"')) return [{ id: "user-1" }];
      if (query.includes('FROM "Session"')) return [{ id: "session-test", createdById: "creator-id", communityId: "community-1" }];
      if (query.includes('FROM "Community"')) {
        return values.at(-1) === true ? [{ id: "community-1" }] : [];
      }
      if (query.includes('FROM "CommunityChannelConfig"')) return [{ id: "voice-config" }];
      if (query.includes('FROM "SessionInvite"')) return [{ id: "invite-1" }];
      if (query.includes('FROM "Membership"')) return [{ userId: "user-1" }];
      return [];
    });

    expect(await storeSessionVoiceInterval(config, interval)).toBe(false);
    expect(mocks.intervalUpsert).not.toHaveBeenCalled();
  });

  it("compares a session start with the Paris wall clock", async () => {
    const config = sessionVoiceConfig(env)!;
    const startedAt = Date.parse("2026-07-14T18:00:00.000Z");
    mocks.userFindUnique.mockResolvedValue({ id: "user-1" });
    mocks.sessionFindFirst.mockResolvedValue(null);

    await storeSessionVoiceInterval(config, { ...interval, startedAt, endedAt: startedAt + 60_000 });

    expect(mocks.sessionFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ date: { lte: new Date("2026-07-14T20:00:00.000Z") } }),
    }));
  });

  it("stores a deduplicated interval after revalidating each predicate under ordered row locks", async () => {
    const config = sessionVoiceConfig(env)!;
    mocks.userFindUnique.mockResolvedValue({ id: "user-1" });
    mocks.sessionFindFirst.mockResolvedValue({ id: "session-test", communityId: "community-1" });
    mocks.intervalUpsert.mockResolvedValue({});
    expect(await storeSessionVoiceInterval(config, { ...interval, partial: true })).toBe(true);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    const queries = mocks.membershipQueryRaw.mock.calls.map(([strings]) => strings.join(""));
    expect(queries.map(query => query.match(/FROM "([^"]+)"/)?.[1])).toEqual([
      "User", "Session", "Community", "CommunityChannelConfig", "SessionInvite", "Membership",
    ]);
    expect(queries.every(query => query.includes("FOR SHARE"))).toBe(true);
    expect(mocks.membershipQueryRaw.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.transaction.mock.invocationCallOrder[0]);
    expect(mocks.membershipQueryRaw.mock.invocationCallOrder.at(-1)).toBeLessThan(mocks.intervalUpsert.mock.invocationCallOrder[0]);
    expect(mocks.intervalUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { sessionId_userId_channelId_startedAt: { sessionId: "session-test", userId: "user-1", channelId: interval.channelId, startedAt: new Date(interval.startedAt) } },
      create: expect.objectContaining({ durationSeconds: 60, partial: true }),
    }));
  });

  it("does not store an interval after community membership is revoked", async () => {
    const config = sessionVoiceConfig(env)!;
    mocks.userFindUnique.mockResolvedValue({ id: "user-1" });
    mocks.sessionFindFirst.mockResolvedValue({ id: "session-test", communityId: "community-1" });
    mocks.membershipQueryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const query = strings.join("");
      if (query.includes('FROM "Membership"')) return [];
      if (query.includes('FROM "User"')) return [{ id: "user-1" }];
      if (query.includes('FROM "Session"')) return [{ id: "session-test", createdById: "creator-id", communityId: "community-1" }];
      if (query.includes('FROM "Community"')) return [{ id: "community-1" }];
      if (query.includes('FROM "CommunityChannelConfig"')) return [{ id: "voice-config" }];
      if (query.includes('FROM "SessionInvite"')) return [{ id: "invite-1" }];
      return [];
    });
    expect(await storeSessionVoiceInterval(config, interval)).toBe(false);
    expect(mocks.intervalUpsert).not.toHaveBeenCalled();
    expect(mocks.membershipQueryRaw).toHaveBeenCalledTimes(6);
  });

  it("keeps membership checks disabled with community isolation off", async () => {
    const config = sessionVoiceConfig(env)!;
    mocks.isolationEnabled.mockReturnValue(false);
    mocks.userFindUnique.mockResolvedValue({ id: "user-1" });
    mocks.sessionFindFirst.mockResolvedValue({ id: "session-test", communityId: "community-1" });
    mocks.intervalUpsert.mockResolvedValue({});
    expect(await storeSessionVoiceInterval(config, interval)).toBe(true);
    expect(mocks.userFindFirst).not.toHaveBeenCalled();
    expect(mocks.membershipQueryRaw).toHaveBeenCalledTimes(5);
    expect(mocks.membershipQueryRaw.mock.calls.map(([strings]) => strings.join("")).join(" ")).not.toContain('FROM "Membership"');
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.intervalUpsert).toHaveBeenCalledOnce();
  });

  it("shows session totals to the creator only, and keeps the flag gate", async () => {
    mocks.accessRole.mockResolvedValue("guest");
    expect(await readSessionVoicePresence("session-test", "guest-id")).toBeNull();
    expect(mocks.intervalGroupBy).not.toHaveBeenCalled();
    mocks.accessRole.mockResolvedValue("creator");
    mocks.intervalGroupBy.mockResolvedValue([{ userId: "user-1", _sum: { durationSeconds: 65 }, _max: { partial: false } }]);
    mocks.userFindMany.mockResolvedValue([{ id: "user-1", discordName: "Member" }]);
    expect(await readSessionVoicePresence("session-test", "owner-id")).toEqual([{ userId: "user-1", name: "Member", durationSeconds: 65, partial: false }]);
    process.env.VOICE_PRESENCE_ENABLED = "false";
    expect(await readSessionVoicePresence("session-test", "owner-id")).toBeNull();
  });
});
