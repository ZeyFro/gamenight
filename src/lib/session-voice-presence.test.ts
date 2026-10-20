import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  userFindMany: vi.fn(),
  sessionFindFirst: vi.fn(),
  intervalUpsert: vi.fn(),
  intervalGroupBy: vi.fn(),
  accessRole: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {
  user: { findUnique: mocks.userFindUnique, findFirst: mocks.userFindFirst, findMany: mocks.userFindMany },
  session: { findFirst: mocks.sessionFindFirst },
  sessionVoicePresenceInterval: { upsert: mocks.intervalUpsert, groupBy: mocks.intervalGroupBy },
} }));
vi.mock("@/lib/session-access", () => ({ getSessionAccessRole: mocks.accessRole }));
vi.mock("@/lib/community-isolation", () => ({ communityMemberUserWhere: vi.fn(async () => ({ memberships: { some: { status: "ACTIVE" } } })) }));

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
  process.env.VOICE_PRESENCE_ENABLED = "true";
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
  mocks.userFindFirst.mockResolvedValue({ id: "user-1" });
    mocks.sessionFindFirst.mockResolvedValue(null);
    expect(await storeSessionVoiceInterval(config, { ...interval, channelId: "000000000000000000" })).toBe(false);
    expect(mocks.sessionFindFirst).not.toHaveBeenCalled();
    expect(await storeSessionVoiceInterval(config, interval)).toBe(false);
    expect(mocks.sessionFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "session-test", status: "SCHEDULED", OR: expect.any(Array) }) }));
    expect(mocks.intervalUpsert).not.toHaveBeenCalled();
  });

  it("stores a deduplicated interval only for an invited member of the configured session", async () => {
    const config = sessionVoiceConfig(env)!;
    mocks.userFindUnique.mockResolvedValue({ id: "user-1" });
    mocks.sessionFindFirst.mockResolvedValue({ id: "session-test" });
    mocks.intervalUpsert.mockResolvedValue({});
    expect(await storeSessionVoiceInterval(config, { ...interval, partial: true })).toBe(true);
    expect(mocks.intervalUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { sessionId_userId_channelId_startedAt: { sessionId: "session-test", userId: "user-1", channelId: interval.channelId, startedAt: new Date(interval.startedAt) } },
      create: expect.objectContaining({ durationSeconds: 60, partial: true }),
    }));
  });

  it("does not store an interval after community membership is revoked", async () => {
    const config = sessionVoiceConfig(env)!;
    mocks.userFindUnique.mockResolvedValue({ id: "user-1" });
    mocks.sessionFindFirst.mockResolvedValue({ id: "session-test", communityId: "community-1" });
    mocks.userFindFirst.mockResolvedValue(null);
    expect(await storeSessionVoiceInterval(config, interval)).toBe(false);
    expect(mocks.intervalUpsert).not.toHaveBeenCalled();
    expect(mocks.userFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ memberships: { some: { status: "ACTIVE" } } }) }));
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
