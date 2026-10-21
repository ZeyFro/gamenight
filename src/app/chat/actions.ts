"use server";

import { prisma } from "@/lib/prisma";
import { getActiveScopedPrisma, getScopedPrisma, withCommunity } from "@/lib/community-scoped-client";
import { isCommunityIsolationEnabled, isMemberOfCommunity, resolveActiveCommunityId } from "@/lib/community-isolation";
import { getDefaultCommunityId } from "@/lib/default-community";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit, RATE_LIMIT_ERROR_KEY } from "@/lib/rate-limit";
import { sendChatMessageSchema, toggleReactionSchema } from "@/lib/validations";
import { getChatMessages, type ChatMessageDTO } from "@/lib/chat";
import { canAccessSession } from "@/lib/session-access";
import { withCommunityReadContext } from "@/lib/community-read-context";

/** Même contrat que `ToggleVoteResult` — la bulle affichée en optimiste (ChatMessages) doit pouvoir se retirer si l'envoi échoue. */
export interface SendChatMessageResult {
  ok: boolean;
  error?: string;
}

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
  return withCommunityReadContext(async () => {
    const user = await getCurrentUser({ recordActivity: false });
    if (!user) return null;
    // Confidentialité des soirées — canal `sessionId` non nul : réservé au
    // créateur et aux invités actifs. Vérifié à CHAQUE polling : une
    // révocation coupe l'accès dès le prochain appel, sans rechargement.
    if (sessionId && !(await canAccessSession(user.id, sessionId))) return null;
    return getChatMessages(sessionId, user.id);
  });
}

/**
 * Envoi d'un message — fenêtre plus large que le défaut (20/min plutôt
 * que 10/min) : un chat en direct implique naturellement plus d'envois
 * rapprochés qu'un formulaire classique.
 */
export async function sendChatMessageAction(formData: FormData): Promise<SendChatMessageResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  if (!checkRateLimit(user.id, "sendChatMessage", { limit: 20, windowMs: 60_000 })) {
    return { ok: false, error: RATE_LIMIT_ERROR_KEY };
  }

  const input = sendChatMessageSchema.safeParse({
    content: String(formData.get("content") ?? ""),
    sessionId: String(formData.get("sessionId") ?? ""),
  });
  if (!input.success) return { ok: false };

  const sessionId = input.data.sessionId || null;
  if (sessionId && !(await canAccessSession(user.id, sessionId))) return { ok: false };

  // Multi-communautés (PR8) : un message de soirée appartient à la communauté de
  // la soirée ; un message du canal global, à la communauté active. Les membres
  // B-only gardent donc un scope B explicite même en mode historique.
  const scopedDb = sessionId ? await getScopedPrisma(user.id) : await getActiveScopedPrisma(user.id);
  let community: ReturnType<typeof withCommunity>;
  if (sessionId) {
    const session = await scopedDb.session.findUnique({ where: { id: sessionId }, select: { communityId: true } });
    if (!session) return { ok: false };
    community = withCommunity(session.communityId);
  } else {
    const activeId = await resolveActiveCommunityId(user.id);
    if (activeId === null) return { ok: false };
    const legacyDefault = !isCommunityIsolationEnabled()
      && await isMemberOfCommunity(user.id, null)
      && activeId === await getDefaultCommunityId();
    community = withCommunity(legacyDefault ? null : activeId);
  }
  await scopedDb.chatMessage.create({
    data: { userId: user.id, sessionId, content: input.data.content, ...community },
  });
  return { ok: true };
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

  // Hors du périmètre de l'utilisateur, le message est introuvable (aucune réaction).
  const scopedDb = await getScopedPrisma(user.id);
  const message = await scopedDb.chatMessage.findUnique({ where: { id: messageId }, select: { id: true, sessionId: true } });
  if (!message) return;
  if (message.sessionId && !(await canAccessSession(user.id, message.sessionId))) return;

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
