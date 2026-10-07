import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolveInput } from "@/lib/notification-executor";

const { community, defaultId, postDiscord, createEvent, enqueue, destination, transaction, recipients } = vi.hoisted(() => ({
  community: vi.fn(), defaultId: vi.fn(), postDiscord: vi.fn(), createEvent: vi.fn(), enqueue: vi.fn(),
  destination: vi.fn(), transaction: vi.fn(),
  recipients: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { community: { findUnique: community }, user: { findMany: recipients }, $transaction: transaction } }));
vi.mock("@/lib/default-community", () => ({ DEFAULT_COMMUNITY_SLUG: "default", getDefaultCommunityId: defaultId }));
vi.mock("@/lib/community-channels", () => ({
  isCommunityChannelsEnabled: () => process.env.COMMUNITY_CHANNELS_ENABLED === "true",
  resolveSessionAnnounceConfig: destination, resolveTournamentAnnounceConfig: destination,
}));
vi.mock("@/lib/discord", async () => ({ ...(await vi.importActual<typeof import("./discord")>("./discord")), postToDiscord: postDiscord }));
vi.mock("@/lib/notification-delivery", () => ({ createNotificationEvent: createEvent, enqueueDelivery: enqueue }));
import { communitySystemAnnounceResolver, postToCommunity } from "./community-announce";

const embed = { title: "Badge", color: 123 };
const input = (): ResolveInput => ({
  event: { id: "event", category: "REWARD", eventType: "COMMUNITY_SYSTEM_ANNOUNCE", communityId: "b",
    payload: { channelCategory: "SESSION", embed, content: "<@123>", recipientDiscordIds: ["123"] } },
  delivery: { channel: "DISCORD_CHANNEL", transport: "BOT", operation: "SEND" },
  now: new Date(),
} as unknown as ResolveInput);

beforeEach(() => {
  vi.clearAllMocks();
  for (const flag of ["COMMUNITY_CHANNELS_ENABLED", "DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED", "NOTIFICATION_EXECUTOR_ENABLED"])
    vi.stubEnv(flag, "true");
  community.mockResolvedValue({ slug: "b", status: "ACTIVE", discordGuildId: "guild-b" });
  defaultId.mockResolvedValue("default-id");
  destination.mockResolvedValue({ guildId: "guild-b", channelId: "channel-b" });
  postDiscord.mockResolvedValue({ ok: true });
  transaction.mockImplementation(async (callback) => callback({}));
  createEvent.mockResolvedValue({ id: "event" });
  enqueue.mockResolvedValue({});
  recipients.mockResolvedValue([{ discordId: "123" }]);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Aucun réseau dans ces tests"); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("annonces système : file communautaire sans réseau depuis l'action", () => {
  it("fige communauté et contenu, enqueue BOT/SEND, sans webhook ni réseau", async () => {
    await expect(postToCommunity("b", embed, "<@123>")).resolves.toEqual({ ok: true });
    expect(createEvent).toHaveBeenCalledWith(expect.objectContaining({ communityId: "b", category: "REWARD",
      payload: { channelCategory: "SESSION", embed, content: "<@123>", recipientDiscordIds: ["123"] } }), expect.anything());
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ eventId: "event", channel: "DISCORD_CHANNEL", transport: "BOT", operation: "SEND" }), expect.anything());
    expect(postDiscord).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["COMMUNITY_CHANNELS_ENABLED", "DISCORD_BOT_SESSION_ANNOUNCE_ENABLED"])("aucun repli non-default si %s éteint", async (flag) => {
    vi.stubEnv(flag, "false");
    await expect(postToCommunity("b", embed)).resolves.toEqual({ ok: false, error: "not_configured" });
    expect(postDiscord).not.toHaveBeenCalled(); expect(createEvent).not.toHaveBeenCalled();
  });
  it("aucun repli non-default sans destination", async () => {
    destination.mockResolvedValue(null);
    await expect(postToCommunity("b", embed)).resolves.toEqual({ ok: false, error: "not_configured" });
    expect(postDiscord).not.toHaveBeenCalled();
  });
  it("default actif conserve le transport legacy si bot inactif", async () => {
    community.mockResolvedValue({ slug: "default", status: "ACTIVE" }); vi.stubEnv("COMMUNITY_CHANNELS_ENABLED", "false");
    vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "false");
    await expect(postToCommunity(null, embed)).resolves.toEqual({ ok: true });
    expect(postDiscord).toHaveBeenCalledWith(embed, undefined);
  });
  it("legacy default : un membre retiré ne reçoit pas d'annonce personnelle", async () => {
    community.mockResolvedValue({ slug: "default", status: "ACTIVE" });
    vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "false"); recipients.mockResolvedValue([]);
    await expect(postToCommunity("default-id", embed, "<@123>")).resolves.toEqual({ ok: false, error: "recipient_unavailable" });
    expect(postDiscord).not.toHaveBeenCalled();
  });
  it("serveur suspendu : aucune file ni webhook", async () => {
    community.mockResolvedValue({ slug: "default", status: "SUSPENDED" });
    await expect(postToCommunity("default-id", embed)).resolves.toEqual({ ok: false, error: "community_unavailable" });
    expect(postDiscord).not.toHaveBeenCalled(); expect(createEvent).not.toHaveBeenCalled();
  });
  it("ne lève jamais si default ne peut être résolue", async () => {
    defaultId.mockRejectedValue(new Error("DB indisponible"));
    await expect(postToCommunity(null, embed)).resolves.toEqual({ ok: false, error: "community_announce_error" });
  });
  it("ne lève jamais si la persistance de livraison échoue", async () => {
    enqueue.mockRejectedValue(new Error("DB indisponible"));
    await expect(postToCommunity("b", embed)).resolves.toEqual({ ok: false, error: "community_announce_error" });
  });
});

describe("résolveur : droit et destination relus à la livraison", () => {
  it("outbox webhook : default seulement, bot éteint et maître actif", async () => {
    community.mockResolvedValue({ slug: "default", status: "ACTIVE" });
    vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "false");
    vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/123/test");
    const request = input(); request.delivery.transport = "WEBHOOK";
    await expect(communitySystemAnnounceResolver.resolve(request)).resolves.toMatchObject({ eligible: true, action: { kind: "send_reward_webhook" } });
    community.mockResolvedValue({ slug: "b", status: "ACTIVE" });
    await expect(communitySystemAnnounceResolver.resolve(request)).resolves.toEqual({ eligible: false, reason: "not_configured" });
    community.mockResolvedValue({ slug: "default", status: "ACTIVE" });
    vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "true");
    await expect(communitySystemAnnounceResolver.resolve(request)).resolves.toEqual({ eligible: false, reason: "not_configured" });
    vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "false");
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "false");
    await expect(communitySystemAnnounceResolver.resolve(request)).resolves.toEqual({ eligible: false, reason: "not_configured" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("demande une vérification du guild avant le POST", async () => {
    await expect(communitySystemAnnounceResolver.resolve(input())).resolves.toMatchObject({ eligible: true,
      action: { kind: "send_channel_message_verified", guildId: "guild-b", channelId: "channel-b",
        message: { allowedMentions: { parse: [], users: ["123"] } } } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["COMMUNITY_CHANNELS_ENABLED", "DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "NOTIFICATION_EXECUTOR_ENABLED"])("refuse une livraison quand %s est éteint", async (flag) => {
    vi.stubEnv(flag, "false");
    await expect(communitySystemAnnounceResolver.resolve(input())).resolves.toEqual({ eligible: false, reason: "not_configured" });
  });
  it("refuse le serveur suspendu depuis l'enqueue", async () => {
    community.mockResolvedValue({ slug: "b", status: "SUSPENDED" });
    await expect(communitySystemAnnounceResolver.resolve(input())).resolves.toEqual({ eligible: false, reason: "expired" });
  });
  it("refuse une configuration issue d'un autre guild", async () => {
    destination.mockResolvedValue({ guildId: "guild-a", channelId: "channel-a" });
    await expect(communitySystemAnnounceResolver.resolve(input())).resolves.toEqual({ eligible: false, reason: "not_configured" });
  });
  it("membre retiré entre enqueue et résolution : pas d'annonce personnelle", async () => {
    recipients.mockResolvedValue([]);
    await expect(communitySystemAnnounceResolver.resolve(input())).resolves.toEqual({ eligible: false, reason: "expired" });
  });
  it("default bot ENV reste dans la file avec channels OFF, master OFF empêche la livraison", async () => {
    community.mockResolvedValue({ slug: "default", status: "ACTIVE", discordGuildId: "guild-default" });
    vi.stubEnv("COMMUNITY_CHANNELS_ENABLED", "false"); vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "false");
    await expect(postToCommunity("default-id", embed)).resolves.toEqual({ ok: true });
    expect(postDiscord).not.toHaveBeenCalled();
    await expect(communitySystemAnnounceResolver.resolve(input())).resolves.toEqual({ eligible: false, reason: "not_configured" });
  });
});
