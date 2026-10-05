import { getActiveScopedPrisma, getScopedPrisma } from "@/lib/community-scoped-client";

/**
 * Sprint 5 (FEATURE 2, Chat in-app) — POLLING, pas de websockets (Vercel
 * Hobby ne supporte pas les connexions persistantes, cf. spec). Le
 * client relit `getChatMessagesAction` toutes les 10s
 * (src/components/chat/ChatMessages.tsx).
 */
export const CHAT_MAX_MESSAGES = 200;

export interface ChatMessageDTO {
  id: string;
  content: string;
  createdAtIso: string;
  userId: string;
  discordName: string;
  discordAvatar: string | null;
  color: string;
  reactions: { emoji: string; userId: string }[];
}

/**
 * Les 200 derniers messages du canal (`sessionId` null = canal global),
 * triés du plus ancien au plus récent pour un affichage direct — jamais
 * supprimés en base, juste plus chargés au-delà de cette limite (cf.
 * commentaire sur `ChatMessage`, prisma/schema.prisma).
 *
 * Multi-communautés (PR8) : le canal global ne montre que la communauté ACTIVE
 * de `viewerId` ; un canal de soirée (accès déjà contrôlé par l'appelant) est
 * lu dans le périmètre de toutes ses communautés, la soirée portant la sienne.
 */
export async function getChatMessages(sessionId: string | null, viewerId: string): Promise<ChatMessageDTO[]> {
  const scopedDb = sessionId ? await getScopedPrisma(viewerId) : await getActiveScopedPrisma(viewerId);
  const messages = await scopedDb.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "desc" },
    take: CHAT_MAX_MESSAGES,
    include: {
      user: { select: { discordName: true, discordAvatar: true, color: true } },
      reactions: { select: { emoji: true, userId: true } },
    },
  });

  return messages.reverse().map((m) => ({
    id: m.id,
    content: m.content,
    createdAtIso: m.createdAt.toISOString(),
    userId: m.userId,
    discordName: m.user.discordName,
    discordAvatar: m.user.discordAvatar,
    color: m.user.color,
    reactions: m.reactions,
  }));
}
