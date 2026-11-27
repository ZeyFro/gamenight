import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { scopedPrisma } from "@/lib/community-scoped-client";
import { logger } from "@/lib/logger";
import { createNotificationEvent, enqueueDelivery } from "@/lib/notification-delivery";
import type { DeliveryResolver } from "@/lib/notification-executor";

/**
 * Relais forum des annonces de joueurs (D3) : AUCUNE écriture Discord directe
 * depuis le web ou Discord. Une annonce produit un `NotificationEvent`
 * (ADMIN / `PLAYER_CLASSIFIED_FORUM`) + une livraison BOT ; l'executor crée le
 * post forum, puis un balayage planifié met en file sa fermeture à l'expiration.
 *
 * Idempotence : un seul événement par annonce et par intention (`occurrence`),
 * et le runner ne crée jamais un second fil si `forumThreadId` est déjà écrit.
 *
 * Règles de sécurité (D3, corrections de revue du 27/11/2026) :
 * - un profil masqué (`UserProfileVisibility = HIDDEN`) n'est JAMAIS relayé, que `PROFILE_VISIBILITY_ENABLED` soit allumé ou non (règle la
 *   plus prudente : une personne qui a masqué son profil le reste) ; un post déjà créé dont l'auteur masque ensuite son profil est fermé par
 *   le balayage du cron des rappels ;
 * - la FERMETURE d'un fil ne dépend jamais de l'interrupteur de relais (il gouverne la création, pas le retrait) et son événement porte
 *   toujours `threadId` : la ligne de l'annonce peut avoir disparu (suppression, suppression de compte).
 */
export const PLAYER_CLASSIFIED_FORUM_EVENT = "PLAYER_CLASSIFIED_FORUM";
export const PLAYER_CLASSIFIED_FORUM_NAME = "🔎・recherche-de-joueurs";

const intentSchema = z.enum(["post", "close"]);
export type PlayerClassifiedForumIntent = z.infer<typeof intentSchema>;

export type ForumEnqueueResult = "queued" | "disabled" | "unavailable";

export function playerClassifiedForumEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PLAYER_CLASSIFIED_FORUM_RELAY_ENABLED === "true"
    && env.NOTIFICATION_EXECUTOR_ENABLED === "true"
    && Boolean(env.DISCORD_BOT_TOKEN?.trim());
}

const slotFor = (guildId: string, listingId: string, intent: PlayerClassifiedForumIntent) =>
  `${guildId}:ADMIN:${listingId}:player-classified-${intent}`;

/** Profil masqué par son auteur : l'annonce ne doit jamais apparaître dans le forum public. */
export async function isForumAuthorHidden(userId: string): Promise<boolean> {
  const row = await prisma.userProfileVisibility.findUnique({ where: { userId }, select: { visibility: true } });
  return row?.visibility === "HIDDEN";
}

export async function enqueuePlayerClassifiedForum(input: {
  listingId: string;
  communityId: string;
  intent: PlayerClassifiedForumIntent;
  /** Obligatoire pour une fermeture : la ligne peut déjà être supprimée à l'exécution. */
  threadId?: string;
}): Promise<ForumEnqueueResult> {
  // L'interrupteur gouverne la CRÉATION des posts ; fermer un fil existant reste toujours possible.
  if (input.intent === "post" && !playerClassifiedForumEnabled()) return "disabled";
  if (input.intent === "close" && !input.threadId) return "unavailable";
  try {
    const community = await scopedPrisma(null).community.findUnique({
      where: { id: input.communityId },
      select: { discordGuildId: true },
    });
    if (!community?.discordGuildId) return "unavailable";
    const event = await createNotificationEvent({
      communityId: input.communityId,
      category: "ADMIN",
      eventType: PLAYER_CLASSIFIED_FORUM_EVENT,
      sourceId: input.listingId,
      occurrence: input.intent,
      payload: { intent: input.intent, ...(input.threadId ? { threadId: input.threadId } : {}) },
    });
    await enqueueDelivery({
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: `player-classified:${input.listingId}`,
      targetSlot: slotFor(community.discordGuildId, input.listingId, input.intent),
    });
    return "queued";
  } catch (error) {
    // Jamais bloquant pour la création/retrait de l'annonce.
    logger.warn("player-classified-forum", "Relais forum non enfilé.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return "unavailable";
  }
}

export const playerClassifiedForumResolver: DeliveryResolver = {
  async resolve({ event, delivery }) {
    if (event.category !== "ADMIN" || event.eventType !== PLAYER_CLASSIFIED_FORUM_EVENT || !event.communityId) {
      return { eligible: false, reason: "unresolvable" };
    }
    const payload = z.object({ intent: intentSchema, threadId: z.string().min(1).max(32).optional() }).safeParse(event.payload);
    if (!payload.success) return { eligible: false, reason: "unresolvable" };
    if (!process.env.DISCORD_BOT_TOKEN?.trim()) return { eligible: false, reason: "configuration_unavailable" };
    const listing = await scopedPrisma(null).playerClassified.findUnique({
      where: { id: event.sourceId },
      select: { communityId: true, forumThreadId: true, forumClosedAt: true,
        createdBy: { select: { profileVisibility: { select: { visibility: true } } } } },
    });
    const closeThreadId = payload.data.threadId;
    if (!listing) {
      if (payload.data.intent !== "close" || !closeThreadId) return { eligible: false, reason: "expired" };
    } else {
      if (listing.communityId !== event.communityId) return { eligible: false, reason: "expired" };
      if (payload.data.intent === "post" && listing.forumThreadId) return { eligible: false, reason: "expired" };
      if (payload.data.intent === "post" && listing.createdBy.profileVisibility?.visibility === "HIDDEN") {
        return { eligible: false, reason: "expired" };
      }
      if (payload.data.intent === "close" && (!listing.forumThreadId || listing.forumClosedAt)) {
        return { eligible: false, reason: "expired" };
      }
    }
    const community = await scopedPrisma(null).community.findUnique({
      where: { id: event.communityId },
      select: { discordGuildId: true },
    });
    if (!community?.discordGuildId) return { eligible: false, reason: "not_configured" };
    if (delivery.operation !== "SEND" || delivery.channel !== "DISCORD_CHANNEL" || delivery.transport !== "BOT"
      || delivery.recipientKey !== `player-classified:${event.sourceId}`
      || delivery.targetSlot !== slotFor(community.discordGuildId, event.sourceId, payload.data.intent)) {
      return { eligible: false, reason: "unresolvable" };
    }
    return {
      eligible: true,
      action: {
        kind: "relay_player_classified_forum",
        intent: payload.data.intent,
        listingId: event.sourceId,
        communityId: event.communityId,
        ...(closeThreadId ? { threadId: closeThreadId } : {}),
      },
    };
  },
};

/**
 * Met en file la fermeture des fils de ces annonces AVANT qu'elles ne soient supprimées. Renvoie le nombre de fermetures qui n'ont pas pu être
 * mises en file (0 = tout est parti) : l'appelant décide de refuser le retrait pour que le fil ne reste pas ouvert sans annonce.
 */
export async function enqueueForumClosures(rows: Array<{ id: string; communityId: string; forumThreadId: string | null }>): Promise<number> {
  let failed = 0;
  for (const row of rows) {
    if (!row.forumThreadId) continue;
    const result = await enqueuePlayerClassifiedForum({ listingId: row.id, communityId: row.communityId, intent: "close", threadId: row.forumThreadId });
    if (result !== "queued") failed++;
  }
  return failed;
}

/** Suppression de compte : ferme tous les fils encore ouverts des annonces de la personne (la ligne sera supprimée ensuite). */
export async function enqueueForumClosuresForUser(userId: string): Promise<number> {
  const rows = await scopedPrisma(null).playerClassified.findMany({
    where: { createdById: userId, forumThreadId: { not: null }, forumClosedAt: null },
    select: { id: true, communityId: true, forumThreadId: true },
  });
  return enqueueForumClosures(rows);
}

export interface PlayerClassifiedForumLifecycle {
  enabled: boolean;
  closeQueued: number;
}

/**
 * Balayage (cron des rappels) : ferme les posts des annonces expirées ET ceux dont l'auteur a masqué son profil depuis. Il tourne même
 * relais éteint : il ne fait que fermer des fils qui existent déjà.
 */
export async function runPlayerClassifiedForumLifecycle(now: Date = new Date()): Promise<PlayerClassifiedForumLifecycle> {
  const rows = await scopedPrisma(null).playerClassified.findMany({
    where: {
      forumThreadId: { not: null },
      forumClosedAt: null,
      OR: [{ expiresAt: { lte: now } }, { createdBy: { profileVisibility: { is: { visibility: "HIDDEN" } } } }],
    },
    orderBy: { expiresAt: "asc" },
    take: 25,
    select: { id: true, communityId: true, forumThreadId: true },
  });
  const failed = await enqueueForumClosures(rows);
  return { enabled: playerClassifiedForumEnabled() || rows.length > 0, closeQueued: rows.length - failed };
}
