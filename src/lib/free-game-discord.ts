import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { listAutomaticFreeGameOffers } from "@/lib/gamerpower-free-games";
import { createNotificationEvent, enqueueDelivery } from "@/lib/notification-delivery";

const DISCORD_ID = /^\d{17,20}$/;

/** Enqueues one idempotent announcement per active community and live offer. */
export async function enqueueFreeGameAnnouncements() {
  if (
    process.env.FREE_GAME_FEED_ENABLED !== "true" ||
    process.env.COMMUNITY_CHANNELS_ENABLED !== "true" ||
    process.env.DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED !== "true" ||
    process.env.NOTIFICATION_EXECUTOR_ENABLED !== "true" ||
    !process.env.DISCORD_BOT_TOKEN?.trim()
  ) return { communities: 0, offers: 0, enqueued: 0 };

  const offers = await listAutomaticFreeGameOffers();
  if (offers.length === 0) return { communities: 0, offers: 0, enqueued: 0 };

  const communities = await prisma.community.findMany({
    where: {
      status: "ACTIVE",
      freeGamesEnabled: true,
      channelConfigs: { some: { category: "FREE_GAMES", enabled: true } },
    },
    select: {
      id: true,
      slug: true,
      discordGuildId: true,
      channelConfigs: { where: { category: "FREE_GAMES", enabled: true } },
    },
  });

  let enqueued = 0;
  for (const community of communities) {
    const guildId = community.discordGuildId ?? (community.slug === "default" ? process.env.DISCORD_BOT_GUILD_ID?.trim() : undefined);
    const channelId = community.channelConfigs[0]?.discordChannelId;
    if (!guildId || !DISCORD_ID.test(guildId) || !channelId || !DISCORD_ID.test(channelId)) continue;

    for (const offer of offers) {
      const event = await createNotificationEvent({
        communityId: community.id,
        category: "REWARD",
        eventType: "COMMUNITY_SYSTEM_ANNOUNCE",
        sourceId: offer.id,
        occurrence: community.id,
        payload: JSON.parse(JSON.stringify({
          channelCategory: "FREE_GAMES",
          content: `🎮 **${offer.title}** est offert sur ${offer.store === "STEAM" ? "Steam" : "Epic Games Store"}. [Voir l’offre](${offer.storeUrl}) · [Source GamerPower](https://www.gamerpower.com)`,
          embed: { title: "Jeu gratuit à récupérer", description: offer.title, color: 0x5865f2 },
        })) as Prisma.InputJsonValue,
      });
      await enqueueDelivery({
        eventId: event.id,
        channel: "DISCORD_CHANNEL",
        transport: "BOT",
        recipientKey: `community:${community.id}`,
        targetSlot: `${guildId}:FREE_GAMES:${offer.id}:${channelId}:announce`,
      });
      enqueued++;
    }
  }

  return { communities: communities.length, offers: offers.length, enqueued };
}
