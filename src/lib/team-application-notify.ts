import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { scopedPrisma } from "@/lib/community-scoped-client";
import { createNotificationEvent, enqueueDelivery } from "@/lib/notification-delivery";
import { resolveAbsoluteUrl } from "@/lib/app-url";
import type { DeliveryResolver } from "@/lib/notification-executor";
import { teamApplicationNoticesEnabled } from "@/lib/team-recruiters-rules";

/**
 * MP de candidature d'équipe : UNIQUEMENT au responsable (capitaine) et aux recruteurs nommés (2 au plus),
 * jamais au candidat ni aux autres membres (décision du 18/11/2026 : « MP seulement à eux »). Aucun appel
 * Discord direct : `NotificationEvent` (ADMIN / `TEAM_APPLICATION_NOTIFY`) + une `NotificationDelivery` MP par
 * destinataire, exécutées par l'executor. Le résolveur revérifie à la livraison que la candidature est toujours
 * en attente et que le destinataire est toujours responsable ou recruteur. Aucune mention : `allowedMentions`
 * vide, le message du candidat n'est jamais interprété comme un ping.
 */
export const TEAM_APPLICATION_NOTIFY = "TEAM_APPLICATION_NOTIFY";

const payloadSchema = z.object({ kind: z.enum(["new", "reminder"]), teamId: z.string().min(1) });
export type TeamApplicationNoticeKind = z.infer<typeof payloadSchema>["kind"];

const slotFor = (recipientId: string, applicationId: string, kind: TeamApplicationNoticeKind, stamp: number) =>
  `account:${recipientId}:TEAM_APPLICATION:${applicationId}:${kind}:${stamp}`;

/**
 * Idempotent : l'événement est unique par (candidature, nature, date de dépôt) ; une nouvelle candidature
 * après refus ou expiration (même ligne, `createdAt` réinitialisé) produit donc de nouveaux MP.
 * Jamais bloquant pour l'action métier : un échec d'enfilage est journalisé.
 */
export async function enqueueTeamApplicationNotice(input: {
  communityId: string; teamId: string; applicationId: string; kind: TeamApplicationNoticeKind;
  createdAt: Date; recipientIds: readonly string[];
}): Promise<"queued" | "disabled" | "none"> {
  if (!teamApplicationNoticesEnabled()) return "disabled";
  if (!input.recipientIds.length) return "none";
  try {
    const stamp = input.createdAt.getTime();
    const event = await createNotificationEvent({
      communityId: input.communityId, category: "ADMIN", eventType: TEAM_APPLICATION_NOTIFY,
      sourceId: input.applicationId, occurrence: `${input.kind}:${stamp}`,
      payload: { kind: input.kind, teamId: input.teamId },
    });
    for (const recipientId of new Set(input.recipientIds)) {
      await enqueueDelivery({
        eventId: event.id, channel: "DISCORD_DM", transport: "BOT", operation: "SEND",
        recipientKey: `user:${recipientId}`, targetSlot: slotFor(recipientId, input.applicationId, input.kind, stamp),
      });
    }
    return "queued";
  } catch (error) {
    logger.warn("team-applications", "MP de candidature non enfilé.", { errorType: error instanceof Error ? error.name : "unknown" });
    return "none";
  }
}

export const teamApplicationNoticeResolver: DeliveryResolver = {
  async resolve({ event, delivery }) {
    if (event.category !== "ADMIN" || event.eventType !== TEAM_APPLICATION_NOTIFY || !event.communityId) return { eligible: false, reason: "unresolvable" };
    const payload = payloadSchema.safeParse(event.payload);
    if (!payload.success) return { eligible: false, reason: "unresolvable" };
    if (!teamApplicationNoticesEnabled()) return { eligible: false, reason: "not_configured" };
    const recipientId = delivery.recipientKey.startsWith("user:") ? delivery.recipientKey.slice(5) : "";
    if (delivery.operation !== "SEND" || delivery.channel !== "DISCORD_DM" || delivery.transport !== "BOT" || !recipientId) return { eligible: false, reason: "unresolvable" };
    const communityId = event.communityId;
    const scopedDb = scopedPrisma({ communityIds: [communityId], includesDefault: false });
    const application = await scopedDb.teamApplication.findFirst({
      where: { id: event.sourceId, communityId, teamId: payload.data.teamId, status: "PENDING" },
      select: {
        createdAt: true, message: true, applicant: { select: { discordName: true } },
        team: { select: { name: true, captainId: true, createdById: true, recruiters: { select: { userId: true } } } },
      },
    });
    if (!application) return { eligible: false, reason: "expired" };
    if (delivery.targetSlot !== slotFor(recipientId, event.sourceId, payload.data.kind, application.createdAt.getTime())) return { eligible: false, reason: "expired" };
    const approverIds = new Set<string>([application.team.captainId ?? application.team.createdById, ...application.team.recruiters.map((row) => row.userId)]);
    if (!approverIds.has(recipientId)) return { eligible: false, reason: "expired" };
    const user = await prisma.user.findUnique({
      where: { id: recipientId },
      select: { discordId: true, memberships: { where: { communityId, status: "ACTIVE", community: { status: "ACTIVE" } }, select: { id: true }, take: 1 } },
    });
    if (!user?.memberships.length) return { eligible: false, reason: "expired" };
    const origin = resolveAbsoluteUrl("/equipes/candidatures", {
      VERCEL_ENV: process.env.VERCEL_ENV, VERCEL_URL: process.env.VERCEL_URL, VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    });
    if (!origin || !process.env.DISCORD_BOT_TOKEN?.trim()) return { eligible: false, reason: "configuration_unavailable" };
    const reminder = payload.data.kind === "reminder";
    return {
      eligible: true,
      action: {
        kind: "send_direct_message", userId: user.discordId,
        message: {
          embeds: [{
            title: reminder ? `Rappel : candidature en attente pour ${application.team.name}` : `Nouvelle candidature pour ${application.team.name}`,
            description: `${application.applicant.discordName} souhaite rejoindre l’équipe.\n\n> ${application.message.slice(0, 500).replace(/\n/g, "\n> ")}\n\n${reminder ? "Sans réponse, la candidature expirera 7 jours après son dépôt.\n" : ""}Décider : ${origin}`,
            color: 0x8b5cf6,
          }],
          allowedMentions: { parse: [] },
        },
      },
    };
  },
};
