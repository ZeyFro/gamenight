import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ community: vi.fn(), attempt: vi.fn(), membership: vi.fn() }));
vi.mock("@/lib/community-scoped-client", () => ({
  scopedPrisma: () => ({
    community: { findUnique: mocks.community },
    towerChallengeAttempt: { findFirst: mocks.attempt },
    membership: { findUnique: mocks.membership },
  }),
}));
vi.mock("@/lib/notification-delivery", () => ({ createNotificationEvent: vi.fn(), enqueueDelivery: vi.fn() }));
import { towerSteamAnnounceResolver, towerSteamConfig, TOWER_AUTO_VALIDATED, TOWER_AUTO_VALIDATION, TOWER_AUTO_VALIDATION_UPDATED } from "./tower-steam-announcements";

const guildId = "100000000000000001";
const channelId = "100000000000000002";
const slot = guildId + ":TOWER:att1:auto";
const autoValidatedAt = new Date("2026-12-10T12:00:00Z");

const attempt = (overrides: Record<string, unknown> = {}) => ({
  id: "att1", userId: "u1", title: "Défi Steam", rewardFloors: 2, status: "ASSIGNED", rewardedAt: null, autoValidatedAt, doubtReportedAt: null,
  measureKind: "STEAM_PLAYTIME", measureTarget: 60, measureAchievement: null, measureValue: 75,
  user: { discordId: "200000000000000001", discordName: "Joueur" }, ...overrides,
});
function request(eventType: string, channel: string, operation: string, targetSlot: string, recipientKey: string, now = new Date("2026-12-10T13:00:00Z"), targetMessage: unknown = null) {
  return {
    event: { category: "ACHIEVEMENT", eventType, communityId: "c1", sourceId: "att1" },
    delivery: { channel, transport: "BOT", operation, recipientKey, targetSlot, targetMessage }, now,
  } as unknown as Parameters<typeof towerSteamAnnounceResolver.resolve>[0];
}

beforeEach(() => {
  vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
  vi.stubEnv("TOWER_STEAM_AUTOVALIDATE_ENABLED", "true");
  vi.stubEnv("TOWER_DISCORD_ANNOUNCE_ENABLED", "true");
  vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
  vi.stubEnv("TOWER_DISCORD_GUILD_ID", guildId);
  vi.stubEnv("TOWER_DISCORD_CHANNEL_ID", channelId);
  mocks.community.mockReset().mockResolvedValue({ status: "ACTIVE", towerChallengesEnabled: true, discordGuildId: guildId });
  mocks.attempt.mockReset().mockResolvedValue(attempt());
  mocks.membership.mockReset().mockResolvedValue({ status: "ACTIVE" });
});
afterEach(() => vi.unstubAllEnvs());

describe("validation automatique Steam : file de notifications", () => {
  it("exige les trois verrous et la configuration Discord", () => {
    expect(towerSteamConfig()).toEqual({ guildId, channelId });
    vi.stubEnv("TOWER_STEAM_AUTOVALIDATE_ENABLED", "false");
    expect(towerSteamConfig()).toBeNull();
    vi.stubEnv("TOWER_STEAM_AUTOVALIDATE_ENABLED", "true");
    vi.stubEnv("TOWER_DISCORD_ANNOUNCE_ENABLED", "false");
    expect(towerSteamConfig()).toBeNull();
  });

  it("publie le message en attente avec le bouton « Signaler un doute » et aucune mention", async () => {
    const result = await towerSteamAnnounceResolver.resolve(request(TOWER_AUTO_VALIDATION, "DISCORD_CHANNEL", "SEND", slot, channelId));
    if (!result.eligible || result.action.kind !== "send_channel_message_verified") throw new Error("Envoi attendu");
    expect(result.action.message.content).toContain("75 min de jeu");
    expect(result.action.message.allowedMentions).toEqual({ parse: [] });
    expect(result.action.message.components?.[0].components[0].custom_id).toBe("gn:tower:doubt:att1");
  });

  it("n'annonce plus rien une fois la fenêtre écoulée ou le doute posé", async () => {
    expect(await towerSteamAnnounceResolver.resolve(request(TOWER_AUTO_VALIDATION, "DISCORD_CHANNEL", "SEND", slot, channelId, new Date("2026-12-10T18:00:00Z"))))
      .toMatchObject({ eligible: false, reason: "expired" });
    mocks.attempt.mockResolvedValue(attempt({ doubtReportedAt: autoValidatedAt, status: "SUBMITTED" }));
    expect(await towerSteamAnnounceResolver.resolve(request(TOWER_AUTO_VALIDATION, "DISCORD_CHANNEL", "SEND", slot, channelId)))
      .toMatchObject({ eligible: false, reason: "expired" });
  });

  it("édite le message sans bouton à la validation et au doute", async () => {
    const ref = { discordMessageId: "300000000000000001", discordChannelId: channelId, discordThreadId: null };
    mocks.attempt.mockResolvedValue(attempt({ status: "APPROVED", rewardedAt: new Date("2026-12-10T18:00:00Z") }));
    const validated = await towerSteamAnnounceResolver.resolve(request(TOWER_AUTO_VALIDATION_UPDATED, "DISCORD_CHANNEL", "EDIT", slot, channelId, undefined, ref));
    if (!validated.eligible || validated.action.kind !== "edit_channel_message") throw new Error("Édition attendue");
    expect(validated.action.message.content).toContain("Validé automatiquement");
    expect(validated.action.message.components).toEqual([]);
    mocks.attempt.mockResolvedValue(attempt({ status: "SUBMITTED", doubtReportedAt: new Date("2026-12-10T13:00:00Z") }));
    const doubt = await towerSteamAnnounceResolver.resolve(request(TOWER_AUTO_VALIDATION_UPDATED, "DISCORD_CHANNEL", "EDIT", slot, channelId, undefined, ref));
    if (!doubt.eligible || doubt.action.kind !== "edit_channel_message") throw new Error("Édition attendue");
    expect(doubt.action.message.content).toContain("Doute signalé");
  });

  it("envoie le MP de validation au joueur seulement après le crédit", async () => {
    const dm = request(TOWER_AUTO_VALIDATED, "DISCORD_DM", "SEND", guildId + ":TOWER:att1:auto-dm", "user:u1");
    expect(await towerSteamAnnounceResolver.resolve(dm)).toMatchObject({ eligible: false, reason: "expired" });
    mocks.attempt.mockResolvedValue(attempt({ status: "APPROVED", rewardedAt: new Date("2026-12-10T18:00:00Z") }));
    const result = await towerSteamAnnounceResolver.resolve(dm);
    if (!result.eligible || result.action.kind !== "send_direct_message") throw new Error("MP attendu");
    expect(result.action.userId).toBe("200000000000000001");
    expect(result.action.message.content).toContain("+2 étage(s)");
  });

  it("refuse un créneau ou un destinataire qui ne correspond pas", async () => {
    expect(await towerSteamAnnounceResolver.resolve(request(TOWER_AUTO_VALIDATION, "DISCORD_CHANNEL", "SEND", slot + "x", channelId))).toMatchObject({ eligible: false, reason: "unresolvable" });
    mocks.attempt.mockResolvedValue(attempt({ status: "APPROVED", rewardedAt: new Date() }));
    expect(await towerSteamAnnounceResolver.resolve(request(TOWER_AUTO_VALIDATED, "DISCORD_DM", "SEND", guildId + ":TOWER:att1:auto-dm", "user:autre"))).toMatchObject({ eligible: false, reason: "unresolvable" });
  });
});
