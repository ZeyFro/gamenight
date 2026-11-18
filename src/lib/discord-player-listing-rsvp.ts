import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

/**
 * Réponse aux boutons d'une annonce de joueur.
 *
 * **Aucune écriture** : GameNight n'a pas de modèle de candidature
 * (`PlayerClassified` ne porte que jeu + message). L'intérêt n'est donc pas
 * enregistré, et le message le dit — plutôt que de simuler une candidature.
 * Le jour où un modèle approuvé existera, seule cette fonction changera : les
 * composants et le routage restent identiques.
 */
export interface ListingRsvpOrigin {
  interactionId: string;
  discordId: string;
  guildId: string;
  channelId: string;
}

const snowflake = z.string().regex(/^[0-9]{16,20}$/);
const listingIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);

export async function respondToListingInteraction(
  kind: "interest" | "contact",
  listingId: string,
  origin: ListingRsvpOrigin
): Promise<string> {
  if (!listingIdSchema.safeParse(listingId).success || !snowflake.safeParse(origin.discordId).success) {
    return "Cette annonce n’est plus accessible.";
  }
  const user = await prisma.user.findUnique({
    where: { discordId: origin.discordId },
    select: { id: true, discordId: true },
  });
  if (!user) return "Connecte-toi d’abord à GameNight avec ce compte Discord, puis réessaie.";
  if (!checkRateLimit(user.id, "discord-listing-rsvp", { limit: 12 })) return RATE_LIMIT_MESSAGE;

  const listing = await prisma.playerClassified.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      communityId: true,
      createdById: true,
      message: true,
      expiresAt: true,
      game: { select: { name: true } },
      createdBy: { select: { discordId: true, discordName: true } },
      community: { select: { discordGuildId: true, status: true } },
    },
  });
  if (!listing) return "Cette annonce a été retirée ou n’existe plus.";
  if (listing.community.status !== "ACTIVE" || listing.community.discordGuildId !== origin.guildId) {
    return "Cette annonce n’est plus accessible sur ce serveur.";
  }
  const membership = await prisma.membership.findUnique({
    where: { communityId_userId: { communityId: listing.communityId, userId: user.id } },
    select: { status: true },
  });
  if (membership?.status !== "ACTIVE") return "Rejoins d’abord cette communauté dans GameNight, puis réessaie.";

  const authorMention = `<@${listing.createdBy.discordId}>`;
  const expired = listing.expiresAt <= new Date();
  if (listing.createdById === user.id) {
    return `C’est ton annonce (**${listing.game.name}**). Retire-la avec \`/joueurs retirer\`.`;
  }
  if (expired) {
    return "Cette annonce a expiré : elle ne figure plus dans `/joueurs annonces`. Publie la tienne avec `/joueurs publier`.";
  }
  if (kind === "contact") {
    return [
      `Auteur de l’annonce : ${authorMention} (${listing.createdBy.discordName}).`,
      "Envoie-lui un message privé pour convenir d’une partie ; GameNight n’a pas encore de messagerie interne.",
    ].join("\n");
  }
  return [
    `Intérêt pour **${listing.game.name}** : ${authorMention} est l’auteur de l’annonce.`,
    "**Aucune candidature n’est enregistrée** : GameNight n’a pas de modèle pour les demandes de recrutement. Écris directement à l’auteur, ou ouvre `/joueurs` pour publier la tienne.",
  ].join("\n");
}
