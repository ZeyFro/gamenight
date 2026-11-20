import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { scopedPrisma } from "@/lib/community-scoped-client";
import { logger } from "@/lib/logger";
import { createNotificationEvent, enqueueDelivery } from "@/lib/notification-delivery";
import { resolveSessionAnnounceConfig } from "@/lib/community-channels";
import type { DeliveryResolver } from "@/lib/notification-executor";
import type { ProjectSpaceIntent } from "@/lib/project-space-runner";
import { PROJECT_ARCHIVE_DELAY_MS, projectOrganizerEnabled, shouldClose } from "@/lib/projects-rules";

/**
 * File des fils Discord de projet : AUCUNE écriture Discord directe. Une demande devient un
 * `NotificationEvent` (ADMIN / `PROJECT_SYNC`) + une `NotificationDelivery` (transport BOT) ;
 * l'executor la réclame, le résolveur revérifie l'état courant, `performDiscordAction` exécute
 * `project-space-runner`. Aucun MP, aucune mention.
 *
 * Verrous cumulés : `PROJECT_ORGANIZER_ENABLED`, `NOTIFICATION_EXECUTOR_ENABLED`, jeton du bot,
 * salon des soirées configuré pour la communauté (destination des fils).
 */
export const PROJECT_SYNC_EVENT = "PROJECT_SYNC";
const BUCKET_MS = 10 * 60_000;

const payloadSchema = z.object({
  intent: z.enum(["provision", "member", "archive"]),
  discordId: z.string().regex(/^[0-9]{16,20}$/).optional(),
});

export type ProjectEnqueueResult = "queued" | "disabled" | "unavailable";

export function projectQueueEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return projectOrganizerEnabled(env) && env.NOTIFICATION_EXECUTOR_ENABLED === "true" && Boolean(env.DISCORD_BOT_TOKEN?.trim());
}

const slotFor = (guildId: string, projectId: string, intent: ProjectSpaceIntent, discordId?: string) =>
  `${guildId}:ADMIN:${projectId}:project-${intent}${intent === "member" ? `-${discordId}` : ""}`;

export async function enqueueProjectSync(
  input: { projectId: string; communityId: string; intent: ProjectSpaceIntent; discordId?: string },
  nowMs: number = Date.now()
): Promise<ProjectEnqueueResult> {
  if (!projectQueueEnabled()) return "disabled";
  if (input.intent === "member" && !/^[0-9]{16,20}$/.test(input.discordId ?? "")) return "unavailable";
  try {
    const destination = await resolveSessionAnnounceConfig(input.communityId);
    if (!destination) return "unavailable";
    const event = await createNotificationEvent({
      communityId: input.communityId,
      category: "ADMIN",
      eventType: PROJECT_SYNC_EVENT,
      sourceId: input.projectId,
      occurrence: `${input.intent}:${input.discordId ?? "-"}:${Math.floor(nowMs / BUCKET_MS)}`,
      payload: { intent: input.intent, ...(input.discordId ? { discordId: input.discordId } : {}) },
    });
    await enqueueDelivery({
      eventId: event.id,
      channel: "DISCORD_CHANNEL",
      transport: "BOT",
      operation: "SEND",
      recipientKey: `project:${input.projectId}`,
      targetSlot: slotFor(destination.guildId, input.projectId, input.intent, input.discordId),
    });
    return "queued";
  } catch (error) {
    // Jamais bloquant pour l'action métier appelante.
    logger.warn("project-space", "Demande de fils de projet non enfilée.", { errorType: error instanceof Error ? error.name : "unknown" });
    return "unavailable";
  }
}

/** Accès d'un participant (acceptation, départ) : relu à l'exécution. */
export async function requestProjectMemberSync(input: { projectId: string; communityId: string; userId: string }): Promise<void> {
  if (!projectQueueEnabled()) return;
  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { discordId: true } });
  if (!user?.discordId) return;
  await enqueueProjectSync({ intent: "member", projectId: input.projectId, communityId: input.communityId, discordId: user.discordId });
}

export const projectSyncResolver: DeliveryResolver = {
  async resolve({ event, delivery }) {
    if (event.category !== "ADMIN" || event.eventType !== PROJECT_SYNC_EVENT || !event.communityId) return { eligible: false, reason: "unresolvable" };
    const payload = payloadSchema.safeParse(event.payload);
    if (!payload.success) return { eligible: false, reason: "unresolvable" };
    const { intent, discordId } = payload.data;
    if (!projectOrganizerEnabled()) return { eligible: false, reason: "not_configured" };
    if (!process.env.DISCORD_BOT_TOKEN?.trim()) return { eligible: false, reason: "configuration_unavailable" };
    const scopedDb = scopedPrisma(null);
    const project = await scopedDb.project.findUnique({ where: { id: event.sourceId }, select: { communityId: true } });
    if (!project || project.communityId !== event.communityId) return { eligible: false, reason: "expired" };
    const destination = await resolveSessionAnnounceConfig(project.communityId);
    if (!destination) return { eligible: false, reason: "expired" };
    if (delivery.operation !== "SEND" || delivery.channel !== "DISCORD_CHANNEL" || delivery.transport !== "BOT" ||
      delivery.recipientKey !== `project:${event.sourceId}` ||
      delivery.targetSlot !== slotFor(destination.guildId, event.sourceId, intent, discordId)) {
      return { eligible: false, reason: "unresolvable" };
    }
    return { eligible: true, action: { kind: "sync_project_space", intent, projectId: event.sourceId, communityId: event.communityId, discordId } };
  },
};

export interface ProjectLifecycleResult {
  enabled: boolean;
  closed: number;
  archiveQueued: number;
  archivedWithoutDiscord: number;
}

/**
 * Balayage (cron des rappels) : clôture les projets dont la date de fin est passée (`wallNow` =
 * horloge murale, comme `endsAt`), met en file l'archivage des fils 7 jours après la clôture, et
 * marque ARCHIVED directement un projet sans aucun fil. Écritures en base seulement ; 25 par passage.
 */
export async function runProjectLifecycle(wallNow: Date, now: Date = new Date()): Promise<ProjectLifecycleResult> {
  if (!projectOrganizerEnabled()) return { enabled: false, closed: 0, archiveQueued: 0, archivedWithoutDiscord: 0 };
  const scopedDb = scopedPrisma(null);
  const toClose = await scopedDb.project.findMany({ where: { status: "OPEN", endsAt: { lte: wallNow } }, take: 25, select: { id: true, status: true, endsAt: true } });
  let closed = 0;
  for (const project of toClose.filter((candidate) => shouldClose(candidate, wallNow))) {
    const result = await scopedDb.project.updateMany({ where: { id: project.id, status: "OPEN" }, data: { status: "CLOSED", closedAt: now } });
    closed += result.count;
  }
  const due = await scopedDb.project.findMany({
    where: { status: "CLOSED", closedAt: { lte: new Date(now.getTime() - PROJECT_ARCHIVE_DELAY_MS) } },
    orderBy: { closedAt: "asc" },
    take: 25,
    select: { id: true, communityId: true, publicThreadId: true, privateThreadId: true },
  });
  let archiveQueued = 0;
  let archivedWithoutDiscord = 0;
  for (const project of due) {
    if (!project.publicThreadId && !project.privateThreadId) {
      const result = await scopedDb.project.updateMany({ where: { id: project.id, status: "CLOSED" }, data: { status: "ARCHIVED", archivedAt: now } });
      archivedWithoutDiscord += result.count;
    } else if ((await enqueueProjectSync({ intent: "archive", projectId: project.id, communityId: project.communityId }, now.getTime())) === "queued") {
      archiveQueued++;
    }
  }
  return { enabled: true, closed, archiveQueued, archivedWithoutDiscord };
}
