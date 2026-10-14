import {
  ACCENT_COLOR,
  type DiscordEmbed,
  type PostToDiscordResult,
} from "@/lib/discord";
import { pickMessageTemplate } from "@/lib/message-templates";
import { rankForLevel, titleForLevel } from "@/lib/xp";
import type { User } from "@prisma/client";
import { postToCommunity } from "@/lib/community-announce";

/**
 * Notifie Discord quand un user passe un niveau (chantier XP, PR 2/9).
 * Contrairement à `announceSessionCreated`/`announceSessionModified`
 * (plusieurs personnes concernées, mentions conditionnelles selon
 * `silenceReminders`), il n'y a ici qu'une seule personne concernée — le
 * user qui vient de monter de niveau — donc `{user}` est toujours un
 * mention `<@id>`, sans condition de silence : même logique que
 * `{createur}` dans la notif de création de soirée, qui n'est jamais
 * masqué non plus (le sujet du message n'est pas "un rappel dont on peut
 * se couper", c'est l'identité de la personne dont on parle).
 */
export async function announceLevelUp(
  user: Pick<User, "discordId">,
  beforeLevel: number,
  afterLevel: number,
  communityId: string | null,
): Promise<PostToDiscordResult> {
  const beforeRank = rankForLevel(beforeLevel);
  const afterRank = rankForLevel(afterLevel);
  const rankChanged = beforeRank.name !== afterRank.name;

  const vars = {
    user: `<@${user.discordId}>`,
    ancien_niveau: String(beforeLevel),
    nouveau_niveau: String(afterLevel),
    titre: titleForLevel(afterLevel),
    rang: afterRank.name,
  };

  const message = await pickMessageTemplate("LEVEL_UP", vars);

  const embed: DiscordEmbed = {
    title: rankChanged ? "🎖️ Nouveau rang !" : "🎉 Level up !",
    description: `Niveau ${beforeLevel} → ${afterLevel}`,
    color: ACCENT_COLOR,
    fields: [
      { name: "Titre", value: vars.titre, inline: true },
      { name: "Rang", value: vars.rang, inline: true },
    ],
  };

  return postToCommunity(communityId, embed, message);
}
