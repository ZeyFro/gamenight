import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  userFindMany: vi.fn(),
  sessionFindFirst: vi.fn(),
  sessionFindUnique: vi.fn(),
  transaction: vi.fn(),
  membershipQueryRaw: vi.fn(),
  intervalUpsert: vi.fn(),
  intervalGroupBy: vi.fn(),
  consentFindUnique: vi.fn(),
  controlFindUnique: vi.fn(),
  gapFindMany: vi.fn(),
  membershipFind: vi.fn(),
  accessRole: vi.fn(),
  isolationEnabled: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {
  $transaction: mocks.transaction,
  user: { findUnique: mocks.userFindUnique, findFirst: mocks.userFindFirst, findMany: mocks.userFindMany },
  session: { findFirst: mocks.sessionFindFirst, findUnique: mocks.sessionFindUnique },
  sessionVoicePresenceInterval: { upsert: mocks.intervalUpsert, groupBy: mocks.intervalGroupBy },
  sessionVoicePresenceConsent: { findUnique: mocks.consentFindUnique },
  sessionVoicePresenceControl: { findUnique: mocks.controlFindUnique },
  sessionVoicePresenceGap: { findMany: mocks.gapFindMany },
  membership: { findUnique: mocks.membershipFind },
} }));
vi.mock("@/lib/session-access", () => ({ getSessionAccessRole: mocks.accessRole }));
vi.mock("@/lib/community-access", () => ({
  findActiveMembership: mocks.membershipFind,
  hasCommunityRole: (role: string, minimum: string) => role === "OWNER" || (role === "ADMIN" && minimum === "ADMIN"),
}));
vi.mock("@/lib/community-stats", () => ({ statsCommunityIdForSession: async () => "community-1" }));
vi.mock("@/lib/admin-rules", () => ({
  isAdminUser: (user: { role: string }) => user.role === "ADMIN",
  parseAdminDiscordIds: () => new Set<string>(),
}));
vi.mock("@/lib/community-isolation", () => ({
  isCommunityIsolationEnabled: mocks.isolationEnabled,
}));

import { readSessionVoicePresence, sessionVoiceConfig, storeSessionVoiceInterval } from "./session-voice-presence";

const env = {
  VOICE_PRESENCE_ENABLED: "true",
  VOICE_PRESENCE_GUILD_ID: "123456789012345678",
  VOICE_PRESENCE_SESSION_ID: "session-test",
  VOICE_PRESENCE_CHANNEL_IDS: "456789012345678901",
  VOICE_PRESENCE_WORKER_ID: "worker-1",
  VOICE_PRESENCE_WORKER_GENERATION: "1",
};
const interval = { memberKey: "789012345678901234", channelId: "456789012345678901", startedAt: 1_800_000, endedAt: 1_860_000 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isolationEnabled.mockReturnValue(true);
  mocks.membershipQueryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
    const query = strings.join("");
    if (query.includes('FROM "User"')) return [{ id: "user-1" }];
    if (query.includes('FROM "Session"')) return [{ id: "session-test", createdById: "creator-id", communityId: "community-1", status: "SCHEDULED" }];
    if (query.includes('FROM "Community"')) return [{ id: "community-1" }];
    if (query.includes('FROM "CommunityChannelConfig"')) return [{ id: "voice-config" }];
    if (query.includes('FROM "SessionInvite"')) return [{ id: "invite-1" }];
    if (query.includes('FROM "Membership"')) return [{ userId: "user-1" }];
    if (query.includes('FROM "SessionVoicePresenceControl"')) return [{ status: "ACTIVE", generation: 1, leaseOwner: "worker-1", leaseExpiresAt: new Date(Date.now() + 3 * 60 * 60_000), stopAt: null }];
    if (query.includes('FROM "SessionVoicePresenceConsent"')) return [{ id: "consent-1", consentedAt: new Date(0) }];
    return [];
  });
  mocks.transaction.mockImplementation(async (work: (tx: {
    $queryRaw: typeof mocks.membershipQueryRaw;
    sessionVoicePresenceInterval: { upsert: typeof mocks.intervalUpsert };
  }) => Promise<unknown>) => work({
    $queryRaw: mocks.membershipQueryRaw,
    sessionVoicePresenceInterval: { upsert: mocks.intervalUpsert },
  }));
  mocks.membershipFind.mockResolvedValue({ role: "MEMBER" });
  mocks.userFindUnique.mockResolvedValue({ id: "user-1", discordId: "789012345678901234", role: "USER" });
  mocks.sessionFindUnique.mockResolvedValue({ createdById: "owner-id", communityId: "community-1", status: "SCHEDULED" });
  mocks.consentFindUnique.mockResolvedValue({ id: "consent-1", expiresAt: null });
  mocks.controlFindUnique.mockResolvedValue({ gapDetected: false, gapStartedAt: null, lastGapAt: null });
  mocks.gapFindMany.mockResolvedValue([]);
  mocks.intervalGroupBy.mockResolvedValue([]);
  mocks.userFindMany.mockResolvedValue([]);
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
    expect(mocks.sessionFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "session-test", status: { in: ["SCHEDULED", "DONE"] }, OR: expect.any(Array) }) }));
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
      if (query.includes('FROM "Session"')) return [{ id: "session-test", createdById: "creator-id", communityId: "community-1", status: "SCHEDULED" }];
      if (query.includes('FROM "Community"')) {
        return values.at(-1) === true && query.includes('"slug" = \'default\'') && query.includes('"discordGuildId" IS NULL')
          ? [{ id: "community-1" }]
          : [];
      }
      if (query.includes('FROM "CommunityChannelConfig"')) return [{ id: "voice-config" }];
      if (query.includes('FROM "SessionInvite"')) return [{ id: "invite-1" }];
      if (query.includes('FROM "Membership"')) return [{ userId: "user-1" }];
      if (query.includes('FROM "SessionVoicePresenceControl"')) return [{ status: "ACTIVE", generation: 1, leaseOwner: "worker-1", leaseExpiresAt: new Date(Date.now() + 3 * 60 * 60_000), stopAt: null }];
      if (query.includes('FROM "SessionVoicePresenceConsent"')) return [{ id: "consent-1", consentedAt: new Date(0) }];
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
      "User", "Session", "Community", "CommunityChannelConfig", "SessionInvite", "Membership", "SessionVoicePresenceControl", "SessionVoicePresenceConsent",
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
    expect(mocks.membershipQueryRaw).toHaveBeenCalledTimes(7);
    expect(mocks.membershipQueryRaw.mock.calls.map(([strings]) => strings.join("")).join(" ")).not.toContain('FROM "Membership"');
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.intervalUpsert).toHaveBeenCalledOnce();
  });

  it("keeps private sessions hidden and scopes guest totals to their own consent", async () => {
    mocks.accessRole.mockResolvedValue(null);
    expect(await readSessionVoicePresence("session-test", "guest-id")).toBeNull();
    expect(mocks.intervalGroupBy).not.toHaveBeenCalled();
    mocks.accessRole.mockResolvedValue("guest");
    mocks.sessionFindUnique.mockResolvedValue({ createdById: "owner-id", communityId: "community-1", status: "SCHEDULED" });
    mocks.userFindUnique.mockResolvedValue({ id: "guest-id", discordId: "guest", role: "USER" });
    mocks.consentFindUnique.mockResolvedValue({ id: "guest-consent", expiresAt: null });
    mocks.intervalGroupBy.mockResolvedValue([{ userId: "user-1", _sum: { durationSeconds: 65 }, _max: { partial: false } }]);
    mocks.userFindMany.mockResolvedValue([{ id: "user-1", discordName: "Member" }]);
    expect(await readSessionVoicePresence("session-test", "guest-id")).toMatchObject({
      consented: true,
      canWithdraw: true,
      canConsent: true,
      canReadAll: false,
      entries: [{ userId: "user-1", name: "Member", durationSeconds: 65, partial: false }],
    });
    expect(mocks.intervalGroupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "guest-id" }) }));

    mocks.accessRole.mockResolvedValue("creator");
    mocks.sessionFindUnique.mockResolvedValue({ createdById: "owner-id", communityId: "community-1", status: "SCHEDULED" });
    mocks.userFindUnique.mockResolvedValue({ id: "owner-id", discordId: "owner", role: "USER" });
    const gapStartedAt = new Date("2026-10-22T10:00:00.000Z");
    mocks.gapFindMany.mockResolvedValue([{ startedAt: gapStartedAt, resumedAt: null }]);
    expect(await readSessionVoicePresence("session-test", "owner-id")).toMatchObject({
      canReadAll: true,
      gapPeriods: [{ startedAt: gapStartedAt, resumedAt: null }],
    });

    mocks.accessRole.mockClear();
    mocks.userFindUnique.mockResolvedValue({ id: "community-admin", discordId: "admin", role: "USER" });
    mocks.membershipFind.mockResolvedValue({ role: "ADMIN" });
    mocks.accessRole.mockResolvedValue("guest");
    const adminPresence = await readSessionVoicePresence("session-test", "community-admin");
    expect(adminPresence).toMatchObject({ canReadAll: true, canConsent: true });
    expect(mocks.accessRole).toHaveBeenCalledWith("community-admin", "session-test");
    mocks.accessRole.mockResolvedValue(null);
    expect(await readSessionVoicePresence("session-test", "community-admin")).toMatchObject({ canReadAll: true, canConsent: false });
    expect(mocks.intervalGroupBy).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.not.objectContaining({ userId: expect.any(String) }),
    }));
    mocks.sessionFindUnique.mockResolvedValue({ createdById: "owner-id", communityId: "community-1", status: "DONE" });
    expect(await readSessionVoicePresence("session-test", "community-admin")).toMatchObject({ canConsent: false, canWithdraw: true });
    process.env.VOICE_PRESENCE_ENABLED = "false";
    expect(await readSessionVoicePresence("session-test", "community-admin")).toMatchObject({ enabled: false, canWithdraw: true });
  });

  it("does not treat expired consent as active but leaves withdrawal available during retention", async () => {
    mocks.sessionFindUnique.mockResolvedValue({ createdById: "owner-id", communityId: "community-1", status: "DONE" });
    mocks.userFindUnique.mockResolvedValue({ id: "owner-id", discordId: "owner", role: "USER" });
    mocks.accessRole.mockResolvedValue("creator");
    mocks.consentFindUnique.mockResolvedValue({ id: "expired-consent", expiresAt: new Date(Date.now() - 1) });

    expect(await readSessionVoicePresence("session-test", "owner-id")).toMatchObject({
      consented: false,
      canWithdraw: true,
      canConsent: false,
    });
  });

  it("returns every retained gap period in chronological order for authorized readers", async () => {
    mocks.accessRole.mockResolvedValue("creator");
    mocks.sessionFindUnique.mockResolvedValue({ createdById: "owner-id", communityId: "community-1", status: "DONE" });
    mocks.userFindUnique.mockResolvedValue({ id: "owner-id", discordId: "owner", role: "USER" });
    const firstStart = new Date("2026-10-22T10:00:00.000Z");
    const firstResume = new Date("2026-10-22T10:05:00.000Z");
    const secondStart = new Date("2026-10-22T11:00:00.000Z");
    mocks.gapFindMany.mockResolvedValue([
      { startedAt: firstStart, resumedAt: firstResume },
      { startedAt: secondStart, resumedAt: null },
    ]);

    expect(await readSessionVoicePresence("session-test", "owner-id")).toMatchObject({
      hasGaps: true,
      gapPeriods: [
        { startedAt: firstStart, resumedAt: firstResume },
        { startedAt: secondStart, resumedAt: null },
      ],
    });
    expect(mocks.gapFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sessionId: "session-test" }),
      orderBy: { startedAt: "asc" },
    }));
  });

  it("masks gap history after the cutoff retention window even before cleanup runs", async () => {
    mocks.accessRole.mockResolvedValue("creator");
    mocks.sessionFindUnique.mockResolvedValue({ createdById: "owner-id", communityId: "community-1", status: "DONE" });
    mocks.userFindUnique.mockResolvedValue({ id: "owner-id", discordId: "owner", role: "USER" });
    mocks.controlFindUnique.mockResolvedValue({ stopAt: new Date(Date.now() - 31 * 24 * 60 * 60_000) });
    mocks.gapFindMany.mockResolvedValue([{ startedAt: new Date(0), resumedAt: new Date(60_000) }]);

    expect(await readSessionVoicePresence("session-test", "owner-id")).toMatchObject({ hasGaps: false, gapPeriods: [] });
    expect(mocks.gapFindMany).not.toHaveBeenCalled();
  });
});
