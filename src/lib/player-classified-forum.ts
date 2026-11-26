import { z } from "zod";
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

export async function enqueuePlayerClassifiedForum(input: {
  listingId: string;
  communityId: string;
  intent: PlayerClassifiedForumIntent;
}): Promise<ForumEnqueueResult> {
  if (!playerClassifiedForumEnabled()) return "disabled";
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
      payload: { intent: input.intent },
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
    const payload = z.object({ intent: intentSchema }).safeParse(event.payload);
    if (!payload.success) return { eligible: false, reason: "unresolvable" };
    if (!process.env.DISCORD_BOT_TOKEN?.trim()) return { eligible: false, reason: "configuration_unavailable" };
    const listing = await scopedPrisma(null).playerClassified.findUnique({
      where: { id: event.sourceId },
      select: { communityId: true, forumThreadId: true, forumClosedAt: true },
    });
    if (!listing || listing.communityId !== event.communityId) return { eligible: false, reason: "expired" };
    if (payload.data.intent === "post" && listing.forumThreadId) return { eligible: false, reason: "expired" };
    if (payload.data.intent === "close" && (!listing.forumThreadId || listing.forumClosedAt)) {
      return { eligible: false, reason: "expired" };
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
      },
    };
  },
};

export interface PlayerClassifiedForumLifecycle {
  enabled: boolean;
  closeQueued: number;
}

/** Balayage (cron des rappels) : ferme les posts des annonces expirées. */
export async function runPlayerClassifiedForumLifecycle(now: Date = new Date()): Promise<PlayerClassifiedForumLifecycle> {
  if (!playerClassifiedForumEnabled()) return { enabled: false, closeQueued: 0 };
  const rows = await scopedPrisma(null).playerClassified.findMany({
    where: { expiresAt: { lte: now }, forumThreadId: { not: null }, forumClosedAt: null },
    orderBy: { expiresAt: "asc" },
    take: 25,
    select: { id: true, communityId: true },
  });
  let closeQueued = 0;
  for (const row of rows) {
    if ((await enqueuePlayerClassifiedForum({ listingId: row.id, communityId: row.communityId, intent: "close" })) === "queued") closeQueued++;
  }
  return { enabled: true, closeQueued };
}
