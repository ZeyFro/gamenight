import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { joinInstantSession, leaveInstantSession } from "@/lib/instant-sessions";
import { getScopedPrisma } from "@/lib/community-scoped-client";
import type { DiscordSeatOrigin } from "@/lib/session-seats";
import { isUniqueConstraintViolation } from "@/lib/xp-actions";

export async function respondToInstantSessionRsvp(sessionId: string, kind: "join" | "leave", origin: DiscordSeatOrigin): Promise<string> {
  const user = await prisma.user.findUnique({ where: { discordId: origin.discordId }, select: { id: true } });
  if (!user) return "Connecte-toi d’abord à GameNight avec ce compte Discord, puis réessaie.";
  if (!checkRateLimit(user.id, "discord-instant-session-rsvp", { limit: 12 })) return RATE_LIMIT_MESSAGE;

  const scopedDb = await getScopedPrisma(user.id);
  const session = await scopedDb.instantSession.findUnique({ where: { id: sessionId }, select: { id: true, communityId: true } });
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

  // Reçu durable par interaction Discord (contrainte unique existante, sans migration) : un rejeu du même clic ne réapplique jamais l'action.
  const receipt = { category: "INSTANT_SESSION" as const, eventType: "INSTANT_SESSION_RSVP", sourceId: sessionId, occurrence: origin.interactionId };
  try {
    await prisma.notificationEvent.create({ data: { ...receipt, communityId: community.id, payload: { userId: user.id, kind } } });
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
    const prior = await prisma.notificationEvent.findUnique({ where: { category_eventType_sourceId_occurrence: receipt }, select: { payload: true } });
    const payload = prior?.payload as { userId?: string; kind?: string } | null | undefined;
    return payload?.userId === user.id && payload.kind === kind ? "✅ Cette réponse a déjà été prise en compte." : "Cette annonce n’est plus accessible. Ouvre la partie dans GameNight pour vérifier.";
  }
  let result;
  try {
    result = kind === "join" ? await joinInstantSession(sessionId, user.id) : await leaveInstantSession(sessionId, user.id);
  } catch (error) {
    // Échec technique : libère le reçu pour qu'une relance légitime puisse aboutir.
    await prisma.notificationEvent.delete({ where: { category_eventType_sourceId_occurrence: receipt } });
    throw error;
  }
  revalidatePath(`/jouer-maintenant/${sessionId}`);
  revalidatePath("/jouer-maintenant");
  if (!result.ok) {
    if (result.reason === "already_in_another_session") return "Tu participes déjà à une autre partie immédiate.";
    if (result.reason === "ended") return "Cette partie est terminée.";
    return "Cette partie n’est plus accessible.";
  }
  return kind === "join" ? "✅ Tu as rejoint la partie !" : "✅ Tu as quitté la partie.";
}
