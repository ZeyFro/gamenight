import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { joinInstantSession, leaveInstantSession } from "@/lib/instant-sessions";
import type { DiscordSeatOrigin } from "@/lib/session-seats";

export async function respondToInstantSessionRsvp(sessionId: string, kind: "join" | "leave", origin: DiscordSeatOrigin): Promise<string> {
  const user = await prisma.user.findUnique({ where: { discordId: origin.discordId }, select: { id: true } });
  if (!user) return "Connecte-toi d’abord à GameNight avec ce compte Discord, puis réessaie.";
  if (!checkRateLimit(user.id, "discord-instant-session-rsvp", { limit: 12 })) return RATE_LIMIT_MESSAGE;

  const session = await prisma.instantSession.findUnique({ where: { id: sessionId }, select: { id: true, communityId: true } });
  if (!session) return "Cette partie n’est plus disponible.";
  const community = await prisma.community.findUnique({
    where: session.communityId ? { id: session.communityId } : { slug: "default" },
    select: { id: true, slug: true, status: true, discordGuildId: true },
  });
  if (!community || community.status !== "ACTIVE" || community.discordGuildId !== origin.guildId) return "Cette annonce n’est plus accessible depuis ce serveur.";
  const member = await prisma.membership.findUnique({ where: { communityId_userId: { communityId: community.id, userId: user.id } }, select: { status: true } });
  if (member?.status !== "ACTIVE") return "Rejoins d’abord ce serveur dans GameNight, puis réessaie.";
  const delivered = await prisma.notificationDelivery.findFirst({ where: {
    targetSlot: `default-guild:INSTANT_SESSION:${sessionId}:announce`,
    status: "SENT", operation: "SEND", transport: "BOT", channel: "DISCORD_CHANNEL",
    discordMessageId: origin.messageId, discordChannelId: origin.channelId,
    event: { category: "INSTANT_SESSION", sourceId: sessionId, eventType: "INSTANT_SESSION_ANNOUNCE", OR: community.slug === "default" ? [{ communityId: community.id }, { communityId: null }] : [{ communityId: community.id }] },
  }, select: { id: true } });
  if (!delivered) return "Cette annonce n’est plus accessible. Ouvre la partie dans GameNight pour vérifier.";

  const result = kind === "join" ? await joinInstantSession(sessionId, user.id) : await leaveInstantSession(sessionId, user.id);
  revalidatePath(`/jouer-maintenant/${sessionId}`);
  revalidatePath("/jouer-maintenant");
  if (!result.ok) {
    if (result.reason === "already_in_another_session") return "Tu participes déjà à une autre partie immédiate.";
    if (result.reason === "ended") return "Cette partie est terminée.";
    return "Cette partie n’est plus accessible.";
  }
  return kind === "join" ? "✅ Tu as rejoint la partie !" : "✅ Tu as quitté la partie.";
}
