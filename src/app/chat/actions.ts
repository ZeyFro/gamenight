"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendChatMessageSchema, toggleReactionSchema } from "@/lib/validations";
import { getChatMessages, type ChatMessageDTO } from "@/lib/chat";

/**
 * Appelée directement (pas via `<form action>`) par `ChatMessages`
 * (client component) toutes les 10s — même pattern que
 * `markAllNotificationsReadAction` appelée depuis `NotificationBell`.
 * Retourne `null` si non connecté plutôt que de lever : le polling ne
 * doit jamais planter le composant client.
 */
export async function getChatMessagesAction(
  sessionId: string | null
): Promise<ChatMessageDTO[] | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return getChatMessages(sessionId);
}

/**
 * Envoi d'un message — fenêtre plus large que le défaut (20/min plutôt
 * que 10/min) : un chat en direct implique naturellement plus d'envois
 * rapprochés qu'un formulaire classique.
 */
export async function sendChatMessageAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return;
  if (!checkRateLimit(user.id, "sendChatMessage", { limit: 20, windowMs: 60_000 })) return;

  const input = sendChatMessageSchema.safeParse({
    content: String(formData.get("content") ?? ""),
    sessionId: String(formData.get("sessionId") ?? ""),
  });
  if (!input.success) return;

  const sessionId = input.data.sessionId || null;
  if (sessionId) {
    const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true } });
    if (!session) return;
  }

  await prisma.chatMessage.create({
    data: { userId: user.id, sessionId, content: input.data.content },
  });
}

/**
 * Réaction longue-pression (👍😂🔥💀) — une par personne par message
 * (`@@unique([messageId, userId])`) : reproposer une réaction
 * DIFFÉRENTE la remplace (upsert), retaper la MÊME la retire (toggle).
 */
export async function toggleReactionAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) return;
  if (!checkRateLimit(user.id, "toggleChatReaction", { limit: 30, windowMs: 60_000 })) return;

  const input = toggleReactionSchema.safeParse({
    messageId: String(formData.get("messageId") ?? ""),
    emoji: String(formData.get("emoji") ?? ""),
  });
  if (!input.success) return;
  const { messageId, emoji } = input.data;

  const message = await prisma.chatMessage.findUnique({ where: { id: messageId }, select: { id: true } });
  if (!message) return;

  const existing = await prisma.chatReaction.findUnique({
    where: { messageId_userId: { messageId, userId: user.id } },
  });

  if (existing?.emoji === emoji) {
    await prisma.chatReaction.delete({ where: { messageId_userId: { messageId, userId: user.id } } });
    return;
  }

  await prisma.chatReaction.upsert({
    where: { messageId_userId: { messageId, userId: user.id } },
    create: { messageId, userId: user.id, emoji },
    update: { emoji },
  });
}
