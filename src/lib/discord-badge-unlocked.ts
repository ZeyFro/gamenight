import { ACCENT_COLOR, type DiscordEmbed, type PostToDiscordResult } from "@/lib/discord";
import { postCommunityEmbed } from "@/lib/community-announce";
import { pickMessageTemplate } from "@/lib/message-templates";
import { RARITY_LABELS } from "@/lib/badge-rarity";
import type { Badge, User } from "@prisma/client";

/**
 * Notifie Discord quand un user débloque un badge (PR 7/9) — même schéma
 * que `announceLevelUp` (une seule personne concernée, `{user}` toujours
 * un mention `<@id>`, pas de condition de silence : ce n'est pas un
 * rappel dont on peut se couper, c'est l'identité de la personne dont on
 * parle).
 *
 * PR B : le badge est gagné dans `communityId` ; l'annonce part dans le salon de
 * CETTE communauté (webhook historique pour `default`).
 */
export async function announceBadgeUnlocked(
  user: Pick<User, "discordId">,
  communityId: string,
  badge: Pick<Badge, "name" | "icon" | "description" | "rarity">
): Promise<PostToDiscordResult> {
  const rarity = RARITY_LABELS[badge.rarity];

  const vars = {
    user: `<@${user.discordId}>`,
    badge_name: badge.name,
    badge_icon: badge.icon,
    rarity,
  };

  const message = await pickMessageTemplate("BADGE_UNLOCKED", vars);

  const embed: DiscordEmbed = {
    title: `${badge.icon} ${badge.name}`,
    description: badge.description,
    color: ACCENT_COLOR,
    fields: [{ name: "Rareté", value: rarity, inline: true }],
  };

  return postCommunityEmbed(communityId, embed, message);
}
