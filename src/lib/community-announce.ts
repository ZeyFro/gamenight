import { getDefaultCommunityId } from "@/lib/default-community";
import { resolveSessionAnnounceConfig } from "@/lib/community-channels";
import {
  postToDiscord,
  webhookAllowedMentions,
  type DiscordEmbed,
  type PostToDiscordResult,
} from "@/lib/discord";
import { sendChannelMessageVerified } from "@/lib/discord-rest";
import { logger } from "@/lib/logger";

/**
 * Multi-communautés, PR B — annonce « système » d'une communauté (niveau
 * atteint, badge, récompenses de soirée, pari ou prono gagné, trophée, fin de
 * saison, récap mensuel).
 *
 * - Communauté `default` : le webhook historique (`DISCORD_WEBHOOK_URL`), comme
 *   avant — aucun changement pour le serveur existant.
 * - Toute autre communauté : le salon des annonces de SOIRÉES de CETTE
 *   communauté (`CommunityChannelConfig`, catégorie `SESSION`, choisi par
 *   l'admin du serveur via `/gamenight setup` ou l'écran d'administration),
 *   envoyé par le bot après vérification que le salon appartient bien au
 *   serveur. Jamais de repli : sans `COMMUNITY_CHANNELS_ENABLED`, sans salon
 *   configuré, salon désactivé ou communauté non ACTIVE, rien n'est envoyé (et
 *   surtout pas dans le salon d'une autre communauté).
 *
 * Ne lève jamais : un échec est renvoyé comme résultat, comme `postToDiscord`.
 */

const SEND_BUDGET_MS = 10_000;

export const NO_COMMUNITY_CHANNEL = "no_community_channel";

export async function postCommunityEmbed(
  communityId: string,
  embed: DiscordEmbed,
  content?: string
): Promise<PostToDiscordResult> {
  if (communityId === (await getDefaultCommunityId())) return postToDiscord(embed, content);

  try {
    const config = await resolveSessionAnnounceConfig(communityId);
    if (!config) {
      logger.warn("community-announce", "Aucun salon d'annonce pour cette communauté — message non envoyé.", {
        communityId,
      });
      return { ok: false, error: NO_COMMUNITY_CHANNEL };
    }
    const result = await sendChannelMessageVerified({
      guildId: config.guildId,
      channelId: config.channelId,
      content: content || undefined,
      embeds: [embed],
      allowedMentions: webhookAllowedMentions(content),
      deadline: new Date(Date.now() + SEND_BUDGET_MS),
    });
    if (!result.ok) {
      logger.warn("community-announce", "Envoi Discord refusé.", { communityId, kind: result.kind });
      return { ok: false, error: result.kind };
    }
    return { ok: true };
  } catch (error) {
    logger.error("community-announce", error, { communityId });
    return { ok: false, error: "network_error" };
  }
}
