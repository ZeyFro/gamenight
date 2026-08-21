import type { Game, Proposal, Session, User, Vote } from "@prisma/client";
import {
  ACCENT_COLOR,
  DESTRUCTIVE_COLOR,
  postToDiscord,
  type DiscordEmbed,
  type DiscordEmbedField,
  type PostToDiscordResult,
} from "@/lib/discord";
import { formatDateTimeFr } from "@/lib/wallclock";

export type ProposalWithVotesAndGame = Proposal & {
  game: Game;
  votes: (Vote & { user: User })[];
};

/**
 * Poste le résultat de clôture d'une session dans Discord (F6). `winner`
 * nul → embed rouge "annulée" (aucune proposition, ou aucune jouable).
 * Les mentions `<@discordId>` des votants du jeu gagnant sont mises à la
 * fois dans le champ "Qui vient" de l'embed (lisible) et dans le
 * `content` brut du message (Discord ne déclenche une vraie notification
 * push que pour des mentions en dehors d'un embed).
 */
export async function announceSessionResult(
  session: Pick<Session, "date">,
  winner: ProposalWithVotesAndGame | null,
  tie: boolean
): Promise<PostToDiscordResult> {
  if (!winner) {
    const embed: DiscordEmbed = {
      title: "❌ Soirée annulée",
      description: `Soirée annulée, pas assez de joueurs pour ${formatDateTimeFr(session.date)}.`,
      color: DESTRUCTIVE_COLOR,
    };
    return postToDiscord(embed);
  }

  const mentions = winner.votes.map((v) => `<@${v.user.discordId}>`);
  const fields: DiscordEmbedField[] = [
    { name: "Joueurs", value: String(winner.votes.length), inline: true },
    {
      name: "Qui vient",
      value:
        mentions.length > 0
          ? mentions.join(" ")
          : "Personne n'a voté (clôture automatique)",
      inline: false,
    },
  ];
  if (tie) {
    fields.push({
      name: "Note",
      value: "Égalité de votes — choisi par ancienneté de proposition.",
      inline: false,
    });
  }

  const embed: DiscordEmbed = {
    title: `🎮 Soirée validée : ${winner.game.name}`,
    description: formatDateTimeFr(session.date),
    color: ACCENT_COLOR,
    thumbnail: winner.game.coverUrl ? { url: winner.game.coverUrl } : undefined,
    fields,
  };

  return postToDiscord(embed, mentions.length > 0 ? mentions.join(" ") : undefined);
}
