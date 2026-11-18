import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  community: vi.fn(),
  event: vi.fn(),
  delivery: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { community: { findUnique: mocks.community } } }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/notification-delivery", () => ({ createNotificationEvent: mocks.event, enqueueDelivery: mocks.delivery }));

import { enqueueTeamSpaceSync, teamSpaceQueueEnabled, teamSpaceSyncResolver } from "./discord-team-space-queue";

const GUILD = "100000000000000001";
const DISCORD = "100000000000000022";
const open = { status: "ACTIVE", communityTeamsEnabled: true, discordGuildId: GUILD };

function enableAll() {
  vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "true");
  vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
  vi.stubEnv("DISCORD_BOT_TOKEN", "faux-jeton");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.community.mockResolvedValue(open);
  mocks.event.mockResolvedValue({ id: "event-1" });
  mocks.delivery.mockResolvedValue({ id: "delivery-1" });
});
afterEach(() => vi.unstubAllEnvs());

describe("verrous de la file", () => {
  it.each([
    ["rien", {}],
    ["sans executor", { DISCORD_TEAM_SPACES_ENABLED: "true", DISCORD_BOT_TOKEN: "x" }],
    ["sans bot", { DISCORD_TEAM_SPACES_ENABLED: "true", NOTIFICATION_EXECUTOR_ENABLED: "true" }],
    ["valeur approximative", { DISCORD_TEAM_SPACES_ENABLED: "1", NOTIFICATION_EXECUTOR_ENABLED: "true", DISCORD_BOT_TOKEN: "x" }],
  ])("fermée : %s", (_label, env) => {
    expect(teamSpaceQueueEnabled(env as NodeJS.ProcessEnv)).toBe(false);
  });

  it("n'écrit ni événement ni livraison, et ne lit rien, drapeau fermé", async () => {
    expect(await enqueueTeamSpaceSync({ teamId: "team-1", communityId: "c1", intent: "provision" })).toBe("disabled");
    expect(mocks.community).not.toHaveBeenCalled();
    expect(mocks.event).not.toHaveBeenCalled();
    expect(mocks.delivery).not.toHaveBeenCalled();
  });
});

describe("enqueueTeamSpaceSync", () => {
  it("enfile un événement ADMIN et une livraison BOT sans message ni mention", async () => {
    enableAll();
    const now = new Date("2026-11-18T12:00:00Z");
    expect(await enqueueTeamSpaceSync({ teamId: "team-1", communityId: "c1", intent: "member", discordId: DISCORD }, now)).toBe("queued");
    expect(mocks.event).toHaveBeenCalledWith({
      communityId: "c1",
      category: "ADMIN",
      eventType: "TEAM_SPACE_SYNC",
      sourceId: "team-1",
      occurrence: expect.stringMatching(/^member:100000000000000022:\d+$/),
      payload: { intent: "member", discordId: DISCORD },
    });
    expect(mocks.delivery).toHaveBeenCalledWith({
      eventId: "event-1",
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: "team:team-1",
      targetSlot: `${GUILD}:ADMIN:team-1:team-space-member-${DISCORD}`,
    });
  });

  it("refuse une communauté inactive, sans équipes ou sans serveur relié, et un membre invalide", async () => {
    enableAll();
    for (const community of [null, { ...open, status: "PENDING" }, { ...open, communityTeamsEnabled: false }, { ...open, discordGuildId: null }]) {
      mocks.community.mockResolvedValue(community);
      expect(await enqueueTeamSpaceSync({ teamId: "team-1", communityId: "c1", intent: "provision" })).toBe("unavailable");
    }
    expect(await enqueueTeamSpaceSync({ teamId: "team-1", communityId: "c1", intent: "member", discordId: "pas-un-id" })).toBe("unavailable");
    expect(mocks.delivery).not.toHaveBeenCalled();
  });

  it("ne casse jamais l'action appelante si la file échoue", async () => {
    enableAll();
    mocks.event.mockRejectedValue(new Error("db"));
    expect(await enqueueTeamSpaceSync({ teamId: "team-1", communityId: "c1", intent: "provision" })).toBe("unavailable");
  });
});

describe("teamSpaceSyncResolver", () => {
  const event = (over = {}) => ({
    category: "ADMIN", eventType: "TEAM_SPACE_SYNC", sourceId: "team-1", communityId: "c1",
    payload: { intent: "member", discordId: DISCORD }, ...over,
  });
  const delivery = (over = {}) => ({
    operation: "SEND", channel: "DISCORD_CHANNEL", transport: "BOT", recipientKey: "team:team-1",
    targetSlot: `${GUILD}:ADMIN:team-1:team-space-member-${DISCORD}`, ...over,
  });
  const resolve = (e = event(), d = delivery()) => teamSpaceSyncResolver.resolve({ event: e as never, delivery: d as never, now: new Date() });

  it("résout vers l'action de l'executor, relue sur l'état courant", async () => {
    enableAll();
    expect(await resolve()).toEqual({
      eligible: true,
      action: { kind: "sync_team_space", intent: "member", teamId: "team-1", communityId: "c1", discordId: DISCORD },
    });
  });

  it("refuse sans drapeau, sans jeton, ou si la communauté n'est plus éligible", async () => {
    expect(await resolve()).toEqual({ eligible: false, reason: "not_configured" });
    vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "true");
    expect(await resolve()).toEqual({ eligible: false, reason: "configuration_unavailable" });
    enableAll();
    mocks.community.mockResolvedValue({ ...open, communityTeamsEnabled: false });
    expect(await resolve()).toEqual({ eligible: false, reason: "expired" });
  });

  it("refuse un événement, une charge ou une livraison incohérents (jamais de cible devinée)", async () => {
    enableAll();
    expect(await resolve(event({ category: "SESSION" }))).toEqual({ eligible: false, reason: "unresolvable" });
    expect(await resolve(event({ communityId: null }))).toEqual({ eligible: false, reason: "unresolvable" });
    expect(await resolve(event({ payload: { intent: "supprimer" } }))).toEqual({ eligible: false, reason: "unresolvable" });
    expect(await resolve(event(), delivery({ targetSlot: `${GUILD}:ADMIN:team-2:team-space-member-${DISCORD}` }))).toEqual({ eligible: false, reason: "unresolvable" });
    expect(await resolve(event(), delivery({ transport: "WEBHOOK" }))).toEqual({ eligible: false, reason: "unresolvable" });
    expect(await resolve(event(), delivery({ recipientKey: "team:team-2" }))).toEqual({ eligible: false, reason: "unresolvable" });
  });
});
