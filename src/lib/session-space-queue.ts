import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { scopedPrisma } from "@/lib/community-scoped-client";
import { logger } from "@/lib/logger";
import { createNotificationEvent, enqueueDelivery } from "@/lib/notification-delivery";
import { resolveSessionAnnounceConfig } from "@/lib/community-channels";
import { wallClockNow } from "@/lib/wallclock";
import type { DeliveryResolver } from "@/lib/notification-executor";
import { SESSION_SPACE_EVENT, type SessionSpaceIntent } from "@/lib/session-space-plan";
import {
  SESSION_ASSUMED_DURATION_MS,
  SESSION_SPACE_CLEANUP_GIVE_UP_MS,
  SESSION_SPACE_LEAD_MS,
  sessionVisibilityEnabled,
} from "@/lib/session-visibility";

/**
 * File des espaces Discord de soirée : AUCUNE écriture Discord directe. Une demande
 * (création à T-30 min, accès d'un participant, nettoyage) devient un `NotificationEvent`
 * (ADMIN / `SESSION_SPACE_SYNC`) + une `NotificationDelivery` (transport BOT) ; l'executor
 * la réclame, le résolveur revérifie l'état courant, `performDiscordAction` exécute
 * `session-space-runner`. Aucun message, aucune mention, aucun MP.
 *
 * Verrous cumulés : `SESSION_VISIBILITY_ENABLED`, `NOTIFICATION_EXECUTOR_ENABLED`,
 * jeton du bot, serveur et salon des soirées configurés pour la communauté.
 */
const BUCKET_MS = 10 * 60_000;

const payloadSchema = z.object({
  intent: z.enum(["provision", "member", "cleanup"]),
  discordId: z.string().regex(/^[0-9]{16,20}$/).optional(),
});

export type SessionSpaceEnqueueResult = "queued" | "disabled" | "unavailable";

export function sessionSpaceQueueEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return sessionVisibilityEnabled(env) && env.NOTIFICATION_EXECUTOR_ENABLED === "true" && Boolean(env.DISCORD_BOT_TOKEN?.trim());
}

const slotFor = (guildId: string, sessionId: string, intent: SessionSpaceIntent, discordId?: string) =>
  `${guildId}:ADMIN:${sessionId}:session-space-${intent}${intent === "member" ? `-${discordId}` : ""}`;

/** Idempotent par fenêtre de 10 min (mêmes intention, soirée et membre). */
export async function enqueueSessionSpaceSync(
  input: { sessionId: string; communityId: string | null; intent: SessionSpaceIntent; discordId?: string },
  nowMs: number = Date.now()
): Promise<SessionSpaceEnqueueResult> {
  if (!sessionSpaceQueueEnabled()) return "disabled";
  if (input.intent === "member" && !/^[0-9]{16,20}$/.test(input.discordId ?? "")) return "unavailable";
  try {
    const destination = await resolveSessionAnnounceConfig(input.communityId);
    if (!destination) return "unavailable";
    const event = await createNotificationEvent({
      communityId: input.communityId,
      category: "ADMIN",
      eventType: SESSION_SPACE_EVENT,
      sourceId: input.sessionId,
      occurrence: `${input.intent}:${input.discordId ?? "-"}:${Math.floor(nowMs / BUCKET_MS)}`,
      payload: { intent: input.intent, ...(input.discordId ? { discordId: input.discordId } : {}) },
    });
    await enqueueDelivery({
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: `session:${input.sessionId}`,
      targetSlot: slotFor(destination.guildId, input.sessionId, input.intent, input.discordId),
    });
    return "queued";
  } catch (error) {
    // Jamais bloquant pour l'action métier appelante.
    logger.warn("session-space", "Demande d'espace de soirée non enfilée.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return "unavailable";
  }
}

/** Accès d'un participant (rejoindre, acceptation, retrait) : relu à l'exécution. */
export async function requestSessionSpaceMemberSync(input: {
  sessionId: string;
  communityId: string | null;
  discordId: string | null | undefined;
}): Promise<void> {
  if (!input.discordId || !sessionSpaceQueueEnabled()) return;
  await enqueueSessionSpaceSync({ intent: "member", sessionId: input.sessionId, communityId: input.communityId, discordId: input.discordId });
}

/** Variante par compte GameNight : no-op sans lecture en base si la file est éteinte. */
export async function requestSessionSpaceMemberSyncForUser(input: {
  sessionId: string;
  communityId: string | null;
  userId: string;
}): Promise<void> {
  if (!sessionSpaceQueueEnabled()) return;
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { discordId: true } });
  await requestSessionSpaceMemberSync({ sessionId: input.sessionId, communityId: input.communityId, discordId: user?.discordId });
}

export const sessionSpaceSyncResolver: DeliveryResolver = {
  async resolve({ event, delivery }) {
    if (event.category !== "ADMIN" || event.eventType !== SESSION_SPACE_EVENT) return { eligible: false, reason: "unresolvable" };
    const payload = payloadSchema.safeParse(event.payload);
    if (!payload.success) return { eligible: false, reason: "unresolvable" };
    const { intent, discordId } = payload.data;
    if (!sessionVisibilityEnabled()) return { eligible: false, reason: "not_configured" };
    if (!process.env.DISCORD_BOT_TOKEN?.trim()) return { eligible: false, reason: "configuration_unavailable" };
    const scopedDb = scopedPrisma(null);
    const session = await scopedDb.session.findUnique({ where: { id: event.sourceId }, select: { communityId: true, status: true } });
    if (!session) return { eligible: false, reason: "expired" };
    const destination = await resolveSessionAnnounceConfig(session.communityId);
    if (!destination) return { eligible: false, reason: "expired" };
    if (delivery.operation !== "SEND" || delivery.channel !== "DISCORD_CHANNEL" || delivery.transport !== "BOT" ||
      delivery.recipientKey !== `session:${event.sourceId}` ||
      delivery.targetSlot !== slotFor(destination.guildId, event.sourceId, intent, discordId)) {
      return { eligible: false, reason: "unresolvable" };
    }
    // Espace déjà complet : rien à refaire (évite des appels Discord à chaque passage du balayage).
    if (intent === "provision") {
      const link = await scopedDb.sessionDiscordSpace.findUnique({ where: { sessionId: event.sourceId }, select: { threadId: true, voiceChannelId: true, cleanedAt: true } });
      if (link?.cleanedAt || (link?.threadId && link.voiceChannelId)) return { eligible: false, reason: "expired" };
    }
    return {
      eligible: true,
      action: { kind: "sync_session_space", intent, sessionId: event.sourceId, communityId: event.communityId ?? "", discordId },
    };
  },
};

export interface SessionSpaceScanResult {
  enabled: boolean;
  provisionQueued: number;
  cleanupQueued: number;
}

/**
 * Balayage appelé par le cron des rappels : met en file la création (T-30 min) des espaces
 * manquants et le nettoyage des espaces de soirées terminées (jusqu'à 24 h après la fin).
 * Des écritures en base uniquement ; au plus 25 soirées par passage et par catégorie.
 */
export async function scheduleSessionSpaces(now: Date = wallClockNow(), nowMs: number = Date.now()): Promise<SessionSpaceScanResult> {
  if (!sessionSpaceQueueEnabled()) return { enabled: false, provisionQueued: 0, cleanupQueued: 0 };
  const scopedDb = scopedPrisma(null);
  const dueSoon = await scopedDb.session.findMany({
    where: {
      status: "SCHEDULED",
      // Une soirée sans aucun invité actif n'a pas besoin d'espace : pas d'événement inutile.
      invites: { some: { status: "ACTIVE" } },
      date: { gt: new Date(now.getTime() - SESSION_ASSUMED_DURATION_MS), lte: new Date(now.getTime() + SESSION_SPACE_LEAD_MS) },
      OR: [{ discordSpace: null }, { discordSpace: { cleanedAt: null, OR: [{ threadId: null }, { voiceChannelId: null }] } }],
    },
    orderBy: { date: "asc" },
    take: 25,
    select: { id: true, communityId: true },
  });
  let provisionQueued = 0;
  for (const session of dueSoon) {
    if ((await enqueueSessionSpaceSync({ intent: "provision", sessionId: session.id, communityId: session.communityId }, nowMs)) === "queued") provisionQueued++;
  }

  const ended = await scopedDb.sessionDiscordSpace.findMany({
    where: {
      cleanedAt: null,
      session: {
        OR: [
          { status: { in: ["DONE", "CANCELLED"] } },
          { date: { lte: new Date(now.getTime() - SESSION_ASSUMED_DURATION_MS) } },
        ],
        // Au-delà de 24 h après la fin, on n'insiste plus : le staff nettoie à la main.
        date: { gt: new Date(now.getTime() - SESSION_ASSUMED_DURATION_MS - SESSION_SPACE_CLEANUP_GIVE_UP_MS) },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 25,
    select: { sessionId: true, session: { select: { communityId: true } } },
  });
  let cleanupQueued = 0;
  for (const space of ended) {
    if ((await enqueueSessionSpaceSync({ intent: "cleanup", sessionId: space.sessionId, communityId: space.session.communityId }, nowMs)) === "queued") cleanupQueued++;
  }
  return { enabled: true, provisionQueued, cleanupQueued };
}
