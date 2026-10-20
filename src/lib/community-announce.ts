import { randomUUID } from "crypto";
import { z } from "zod";
import type { CommunityChannelCategory, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_COMMUNITY_SLUG, getDefaultCommunityId } from "@/lib/default-community";
import { isCommunityChannelsEnabled, resolveFreeGamesAnnounceConfig, resolveSessionAnnounceConfig, resolveTournamentAnnounceConfig } from "@/lib/community-channels";
import { postToDiscord, webhookAllowedMentions, type DiscordEmbed, type PostToDiscordResult } from "@/lib/discord";
import { createNotificationEvent, enqueueDelivery } from "@/lib/notification-delivery";
import type { DeliveryResolver } from "@/lib/notification-executor";
import { logger } from "@/lib/logger";
import { isRewardWebhookConfigured, NO_MENTIONS } from "@/lib/discord-rest";

/** Annonces système : la destination dépend du serveur, jamais du lecteur ni d'un repli interserveurs. */
export async function postToCommunity(
  communityId: string | null,
  embed: DiscordEmbed,
  content?: string,
  category: CommunityChannelCategory = "SESSION",
): Promise<PostToDiscordResult> {
  try {
    // Même la résolution de default est best effort : une annonce ne casse pas l'attribution.
    const id = communityId ?? await getDefaultCommunityId();
    const community = await prisma.community.findUnique({ where: { id }, select: { slug: true, status: true } });
    if (!community || community.status !== "ACTIVE") return { ok: false, error: "community_unavailable" };
    const isDefault = community.slug === DEFAULT_COMMUNITY_SLUG;
    const botEnabled = process.env[category === "SESSION" ? "DISCORD_BOT_SESSION_ANNOUNCE_ENABLED" : "DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED"] === "true";
    if (!isCommunityChannelsEnabled() && !isDefault) return { ok: false, error: "not_configured" };
    const recipientDiscordIds = webhookAllowedMentions([content, embed.description, ...(embed.fields?.map((f) => f.value) ?? [])].filter(Boolean).join("\n")).users ?? [];
    if (!botEnabled) {
      if (!isDefault) return { ok: false, error: "not_configured" };
      if (!(await recipientsAreActive(id, recipientDiscordIds))) return { ok: false, error: "recipient_unavailable" };
      return await postToDiscord(embed, content);
    }
    const destination = category === "TOURNAMENT"
      ? await resolveTournamentAnnounceConfig(id)
      : await resolveSessionAnnounceConfig(id);
    if (!destination) return { ok: false, error: "not_configured" };
    await prisma.$transaction(async (tx) => {
      const event = await createNotificationEvent({
        communityId: id, category: "REWARD", eventType: "COMMUNITY_SYSTEM_ANNOUNCE", sourceId: randomUUID(),
        payload: JSON.parse(JSON.stringify({ channelCategory: category, embed,
          recipientDiscordIds,
          ...(content === undefined ? {} : { content }) })) as Prisma.InputJsonValue,
      }, tx);
      await enqueueDelivery({ eventId: event.id, channel: "DISCORD_CHANNEL", transport: "BOT", operation: "SEND",
        recipientKey: `community:${id}`, targetSlot: `community:${id}:REWARD:${event.id}:announce`,
      }, tx);
    });
    // ok = intention persistée ; Discord n'est appelé que par l'executor.
    return { ok: true };
  } catch (error) {
    logger.error("community-announce", error);
    return { ok: false, error: "community_announce_error" };
  }
}

async function recipientsAreActive(communityId: string, discordIds: string[]): Promise<boolean> {
  if (discordIds.length === 0) return true;
  const recipients = await prisma.user.findMany({
    where: { discordId: { in: discordIds }, memberships: { some: { communityId, status: "ACTIVE", community: { status: "ACTIVE" } } } },
    select: { discordId: true },
  });
  const activeIds = new Set(recipients.map((user) => user.discordId));
  return discordIds.every((id) => activeIds.has(id));
}

const announcePayload = z.object({
  channelCategory: z.enum(["SESSION", "TOURNAMENT", "FREE_GAMES"]),
  content: z.string().optional(),
  recipientDiscordIds: z.array(z.string()).optional(),
  embed: z.object({
    title: z.string(), description: z.string().optional(), color: z.number(),
    fields: z.array(z.object({ name: z.string(), value: z.string(), inline: z.boolean().optional() })).optional(),
  }),
});

/** Le serveur et ses flags sont relus à la livraison, après toute suspension/reconfiguration. */
async function resolveCommunityReward(
  { event, delivery }: Parameters<DeliveryResolver["resolve"]>[0], immediateDefaultWebhook = false,
): ReturnType<DeliveryResolver["resolve"]> {
    if (event.category !== "REWARD" || event.eventType !== "COMMUNITY_SYSTEM_ANNOUNCE" || !event.communityId ||
      !["BOT", "WEBHOOK"].includes(delivery.transport) || delivery.channel !== "DISCORD_CHANNEL" || delivery.operation !== "SEND") {
      return { eligible: false, reason: "unresolvable" };
    }
    const payload = announcePayload.safeParse(event.payload);
    if (!payload.success) return { eligible: false, reason: "unresolvable" };
    const category = payload.data.channelCategory;
    if (category === "FREE_GAMES" && delivery.transport !== "BOT") return { eligible: false, reason: "not_configured" };
    const botEnabled = process.env[category === "SESSION" ? "DISCORD_BOT_SESSION_ANNOUNCE_ENABLED" : category === "TOURNAMENT" ? "DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED" : "DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED"] === "true";
    if ((!immediateDefaultWebhook && process.env.NOTIFICATION_EXECUTOR_ENABLED !== "true") ||
      (immediateDefaultWebhook && delivery.transport !== "WEBHOOK")) {
      return { eligible: false, reason: "not_configured" };
    }
    const community = await prisma.community.findUnique({
      where: { id: event.communityId }, select: { status: true, slug: true, discordGuildId: true, freeGamesEnabled: true },
    });
    if (community?.status !== "ACTIVE") return { eligible: false, reason: "expired" };
    if (category === "FREE_GAMES" && (!community.freeGamesEnabled || process.env.FREE_GAME_FEED_ENABLED !== "true")) return { eligible: false, reason: "expired" };
    if (!isCommunityChannelsEnabled() && community.slug !== DEFAULT_COMMUNITY_SLUG) return { eligible: false, reason: "configuration_unavailable" };
    const recipientDiscordIds = payload.data.recipientDiscordIds ?? [];
    if (!(await recipientsAreActive(event.communityId, recipientDiscordIds))) return { eligible: false, reason: "expired" };
    const allowedMentions = category === "FREE_GAMES" ? NO_MENTIONS : webhookAllowedMentions(payload.data.content);
    if (delivery.transport === "WEBHOOK") {
      // Le transport choisi au commit reste autoritaire, même après activation du bot.
      if (community.slug !== DEFAULT_COMMUNITY_SLUG) return { eligible: false, reason: "not_configured" };
      if (!isRewardWebhookConfigured()) return { eligible: false, reason: "configuration_unavailable" };
      return { eligible: true, action: { kind: "send_reward_webhook",
        message: { content: payload.data.content, embeds: [payload.data.embed], allowedMentions },
      } };
    }
    if (!botEnabled) return { eligible: false, reason: "configuration_unavailable" };
    const destination = category === "TOURNAMENT"
      ? await resolveTournamentAnnounceConfig(event.communityId)
      : category === "FREE_GAMES"
        ? await resolveFreeGamesAnnounceConfig(event.communityId)
        : await resolveSessionAnnounceConfig(event.communityId);
    if (!destination || !process.env.DISCORD_BOT_TOKEN?.trim()) return { eligible: false, reason: "configuration_unavailable" };
    if (community.slug !== DEFAULT_COMMUNITY_SLUG && destination.guildId !== community.discordGuildId) return { eligible: false, reason: "not_configured" };
    return { eligible: true, action: { kind: "send_channel_message_verified", ...destination,
      message: { content: payload.data.content, embeds: [payload.data.embed], allowedMentions },
    } };
}

export const communitySystemAnnounceResolver: DeliveryResolver = {
  resolve: (input) => resolveCommunityReward(input),
};

/** Seule la livraison WEBHOOK de default peut tenter le chemin historique sans flag maître. */
export const immediateDefaultRewardResolver: DeliveryResolver = {
  resolve: (input) => resolveCommunityReward(input, true),
};
