import {
  postToDiscord,
  ACCENT_COLOR,
  type DiscordEmbed,
  type PostToDiscordResult,
} from "@/lib/discord";
import { pickMessageTemplate } from "@/lib/message-templates";
import { RARITY_LABELS } from "@/lib/badge-rarity";
import type { Badge, User } from "@prisma/client";

/**
 * Notifie Discord quand un user débloque un badge (PR 7/9) — même schéma
 * que `announceLevelUp` (une seule personne concernée, `{user}` toujours
 * un mention `<@id>`, pas de condition de silence : ce n'est pas un
 * rappel dont on peut se couper, c'est l'identité de la personne dont on
 * parle).
 */
export async function announceBadgeUnlocked(
  user: Pick<User, "discordId">,
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

  return postToDiscord(embed, message);
}
