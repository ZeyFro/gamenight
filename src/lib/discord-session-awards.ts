import {
  ACCENT_COLOR,
  type DiscordEmbed,
  type PostToDiscordResult,
} from "@/lib/discord";
import { pickMessageTemplate } from "@/lib/message-templates";
import { postToCommunity } from "@/lib/community-announce";

export interface SessionAwardWinner {
  icon: string;
  categoryName: string;
  winnerDiscordId: string;
  winnerDiscordName: string;
  voteCount: number;
}

/**
 * Notifie Discord des superlatifs votés après une soirée (Axe 3 v2, PR
 * 5/9) — jamais appelée s'il n'y a aucun gagnant (0 vote au total sur la
 * session, cf. `finalizeSuperlativeVoting` dans
 * src/lib/superlative-voting.ts) : pas de notif "on n'a rien à annoncer",
 * silence assumé.
 *
 * Contrairement au résultat de vote F6 (embed structuré indépendant, pas
 * dans le système `MessageTemplate`), les awards passent par
 * `MessageTemplate` (catégorie `SESSION_AWARDS`) comme les autres notifs
 * du chantier XP, avec un embed structuré en complément.
 *
 * Pas d'avatar par superlatif dans l'embed : les champs d'un embed
 * Discord n'affichent que du texte (name/value), une image par champ
 * n'existe pas dans leur modèle — seul un `thumbnail` global serait
 * possible, pas exploité ici pour rester simple.
 */
export async function announceSessionAwards(
  gameName: string,
  winners: SessionAwardWinner[],
  communityId: string | null,
): Promise<PostToDiscordResult> {
  const gagnants = winners
    .map((w) => `${w.icon} ${w.categoryName} : <@${w.winnerDiscordId}>`)
    .join("\n");

  const message = await pickMessageTemplate("SESSION_AWARDS", { gagnants });

  const embed: DiscordEmbed = {
    title: `🏆 Awards de la soirée — ${gameName}`,
    color: ACCENT_COLOR,
    fields: winners.map((w) => ({
      name: `${w.icon} ${w.categoryName}`,
      value: `${w.winnerDiscordName} (${w.voteCount} voix)`,
      inline: true,
    })),
  };

  return postToCommunity(communityId, embed, message);
}
