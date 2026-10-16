import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { registerTournamentParticipant } from "@/lib/tournament-registration";
import type { DiscordSeatOrigin } from "@/lib/session-seats";

export async function respondToTournamentRsvp(tournamentId: string, origin: DiscordSeatOrigin): Promise<string> {
  const user = await prisma.user.findUnique({ where: { discordId: origin.discordId }, select: { id: true } });
  if (!user) return "Connecte-toi d’abord à GameNight avec ce compte Discord, puis réessaie.";
  if (!checkRateLimit(user.id, "discord-tournament-rsvp", { limit: 12 })) return RATE_LIMIT_MESSAGE;

  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId }, select: { id: true, status: true, communityId: true, discordGuildId: true, discordChannelId: true } });
  if (!tournament || tournament.status !== "REGISTRATION" || tournament.discordGuildId !== origin.guildId || tournament.discordChannelId !== origin.channelId) return "Les inscriptions à ce tournoi sont fermées ou cette annonce n’est plus accessible.";
  const community = await prisma.community.findUnique({ where: tournament.communityId ? { id: tournament.communityId } : { slug: "default" }, select: { id: true, slug: true, status: true } });
  if (!community || community.status !== "ACTIVE") return "Cette annonce n’est plus accessible.";
  const member = await prisma.membership.findUnique({ where: { communityId_userId: { communityId: community.id, userId: user.id } }, select: { status: true } });
  if (member?.status !== "ACTIVE") return "Rejoins d’abord ce serveur dans GameNight, puis réessaie.";
  const delivered = await prisma.notificationDelivery.findFirst({ where: {
    targetSlot: `default-guild:TOURNAMENT:${tournamentId}:announce`, status: "SENT", operation: "SEND", transport: "BOT", channel: "DISCORD_CHANNEL",
    discordMessageId: origin.messageId, discordChannelId: origin.channelId,
    event: { category: "TOURNAMENT", eventType: "TOURNAMENT_CREATED", sourceId: tournamentId, OR: community.slug === "default" ? [{ communityId: community.id }, { communityId: null }] : [{ communityId: community.id }] },
  }, select: { id: true } });
  if (!delivered) return "Cette annonce n’est plus accessible. Ouvre le tournoi dans GameNight pour vérifier.";

  const result = await registerTournamentParticipant(user.id, tournamentId);
  if (result === "unavailable") return "Ce tournoi n’accepte plus d’inscriptions ou il n’y a plus de place.";
  revalidatePath(`/tournois/${tournamentId}`);
  revalidatePath("/tournois");
  return result === "already" ? "Tu es déjà inscrit à ce tournoi." : "✅ Inscription confirmée. Bonne chance !";
}
