import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { createNotificationEvent, enqueueDelivery } from "@/lib/notification-delivery";
import { teamSpacesEnabled } from "@/lib/discord-team-spaces";
import type { DeliveryResolver } from "@/lib/notification-executor";
import type { TeamSpaceIntent } from "@/lib/discord-team-space-runner";

/**
 * File des espaces Discord d'équipe : AUCUNE écriture Discord directe. Une
 * demande (création, accès d'un membre, réconciliation) devient un
 * `NotificationEvent` (ADMIN / `TEAM_SPACE_SYNC`) + une `NotificationDelivery`
 * (transport BOT) ; l'executor la réclame (bail), le résolveur ci-dessous
 * revérifie l'état courant, puis `performDiscordAction` exécute
 * `discord-team-space-runner`.
 *
 * Verrous cumulés (tous requis, sinon rien n'est enfilé ni exécuté) :
 * `DISCORD_TEAM_SPACES_ENABLED`, `NOTIFICATION_EXECUTOR_ENABLED`, jeton du bot,
 * `communityTeamsEnabled` et serveur Discord relié de la communauté.
 * Aucun message, aucune mention, aucun MP.
 */
export const TEAM_SPACE_EVENT = "TEAM_SPACE_SYNC";
const BUCKET_MS = 10 * 60_000;

const payloadSchema = z.object({
  intent: z.enum(["provision", "member", "reconcile", "delete"]),
  discordId: z.string().regex(/^[0-9]{16,20}$/).optional(),
});

export type TeamSpaceEnqueueResult = "queued" | "disabled" | "unavailable";

export function teamSpaceQueueEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return teamSpacesEnabled(env) && env.NOTIFICATION_EXECUTOR_ENABLED === "true" && Boolean(env.DISCORD_BOT_TOKEN?.trim());
}

const slotFor = (guildId: string, teamId: string, intent: TeamSpaceIntent, discordId?: string) =>
  `${guildId}:ADMIN:${teamId}:team-space-${intent}${intent === "member" ? `-${discordId}` : ""}`;

/**
 * Idempotent par fenêtre de 10 minutes pour `provision` et `reconcile`. Une demande
 * `member` (accès d'un membre) est distincte à chaque appel : « rejoint puis quitte »
 * en moins de 10 minutes doit encore produire le retrait du rôle, même si la livraison
 * d'ajout est déjà envoyée. Une demande plus récente sur le même créneau remplace une
 * demande encore en attente (`supersedeStaleDeliveries`) ; l'état final est relu à l'exécution.
 */
export async function enqueueTeamSpaceSync(
  input: { teamId: string; communityId: string; intent: TeamSpaceIntent; discordId?: string },
  now: Date = new Date()
): Promise<TeamSpaceEnqueueResult> {
  if (!teamSpaceQueueEnabled()) return "disabled";
  if (input.intent === "member" && !/^[0-9]{16,20}$/.test(input.discordId ?? "")) return "unavailable";
  try {
    const community = await prisma.community.findUnique({
      where: { id: input.communityId },
      select: { status: true, communityTeamsEnabled: true, discordGuildId: true },
    });
    if (community?.status !== "ACTIVE" || !community.communityTeamsEnabled || !community.discordGuildId) return "unavailable";
    const event = await createNotificationEvent({
      communityId: input.communityId,
      category: "ADMIN",
      eventType: TEAM_SPACE_EVENT,
      sourceId: input.teamId,
      occurrence: input.intent === "member"
        ? `member:${input.discordId}:${now.getTime()}`
        : `${input.intent}:${input.discordId ?? "-"}:${Math.floor(now.getTime() / BUCKET_MS)}`,
      payload: { intent: input.intent, ...(input.discordId ? { discordId: input.discordId } : {}) },
    });
    await enqueueDelivery({
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: `team:${input.teamId}`,
      targetSlot: slotFor(community.discordGuildId, input.teamId, input.intent, input.discordId),
    });
    return "queued";
  } catch (error) {
    // Jamais bloquant pour l'action métier appelante : l'équipe reste intacte.
    logger.warn("discord-team-space", "Demande d'espace d'équipe non enfilée.", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    return "unavailable";
  }
}

export const teamSpaceSyncResolver: DeliveryResolver = {
  async resolve({ event, delivery }) {
    if (event.category !== "ADMIN" || event.eventType !== TEAM_SPACE_EVENT || !event.communityId) {
      return { eligible: false, reason: "unresolvable" };
    }
    const payload = payloadSchema.safeParse(event.payload);
    if (!payload.success) return { eligible: false, reason: "unresolvable" };
    const { intent, discordId } = payload.data;
    if (!teamSpacesEnabled()) return { eligible: false, reason: "not_configured" };
    if (!process.env.DISCORD_BOT_TOKEN?.trim()) return { eligible: false, reason: "configuration_unavailable" };
    const community = await prisma.community.findUnique({
      where: { id: event.communityId },
      select: { status: true, communityTeamsEnabled: true, discordGuildId: true },
    });
    if (community?.status !== "ACTIVE" || !community.communityTeamsEnabled || !community.discordGuildId) {
      return { eligible: false, reason: "expired" };
    }
    if (delivery.operation !== "SEND" || delivery.channel !== "DISCORD_CHANNEL" || delivery.transport !== "BOT" ||
      delivery.recipientKey !== `team:${event.sourceId}` ||
      delivery.targetSlot !== slotFor(community.discordGuildId, event.sourceId, intent, discordId)) {
      return { eligible: false, reason: "unresolvable" };
    }
    return { eligible: true, action: { kind: "sync_team_space", intent, teamId: event.sourceId, communityId: event.communityId, discordId } };
  },
};
