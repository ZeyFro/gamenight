import type { Prisma, NotificationType } from "@prisma/client";
import type { DiscordEmbed } from "@/lib/discord";
import { webhookAllowedMentions } from "@/lib/discord";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { isCommunityIsolationEnabled } from "@/lib/community-isolation";

export interface RewardNotice {
  type: Extract<NotificationType, "PRONOSTIC" | "XP_BET">;
  title: string;
  message: string;
  relatedSessionId: string;
  embed: DiscordEmbed;
}

/** Le journal durable est la clé de reprise, même après purge de la notification in-app. */
export async function persistRewardNotice(
  tx: Prisma.TransactionClient,
  credit: { id: string; communityId: string; userId: string },
  notice: RewardNotice,
): Promise<void> {
  const scopedDb = scopedTransactionPrisma(tx, isCommunityIsolationEnabled()
    ? { communityIds: [credit.communityId], includesDefault: false } : null);
  const eventId = `xp-reward:${credit.id}`;
  const created = await scopedDb.notificationEvent.createMany({ data: [{
    id: eventId, communityId: credit.communityId, category: "REWARD",
    eventType: "COMMUNITY_SYSTEM_ANNOUNCE", sourceId: credit.id, occurrence: "",
    payload: JSON.parse(JSON.stringify({ channelCategory: "SESSION", embed: notice.embed,
      recipientDiscordIds: webhookAllowedMentions(notice.embed.description).users ?? [],
    })) as Prisma.InputJsonValue,
  }], skipDuplicates: true });
  if (created.count === 0) return;
  await scopedDb.notification.create({ data: {
    id: eventId, communityId: credit.communityId, userId: credit.userId,
    type: notice.type, title: notice.title, message: notice.message, relatedSessionId: notice.relatedSessionId,
  } });
  const bot = process.env.DISCORD_BOT_SESSION_ANNOUNCE_ENABLED === "true";
  const community = await tx.community.findUniqueOrThrow({ where: { id: credit.communityId }, select: { slug: true } });
  // Aucun serveur tiers ne peut utiliser le webhook historique de default.
  if (!bot && community.slug !== "default") return;
  await tx.notificationDelivery.create({ data: {
    eventId, channel: "DISCORD_CHANNEL", transport: bot ? "BOT" : "WEBHOOK", operation: "SEND",
    recipientKey: `community:${credit.communityId}`,
    targetSlot: `community:${credit.communityId}:REWARD:${eventId}:announce`,
  } });
}
