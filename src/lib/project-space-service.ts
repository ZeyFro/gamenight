import { prisma } from "@/lib/prisma";
import { scopedPrisma } from "@/lib/community-scoped-client";
import { communityMemberUserWhere } from "@/lib/community-isolation";
import { resolveSessionAnnounceConfig } from "@/lib/community-channels";
import { logger } from "@/lib/logger";
import { projectOrganizerEnabled, shouldArchive } from "@/lib/projects-rules";

/**
 * Fils Discord d'un projet (flag `PROJECT_ORGANIZER_ENABLED`) : un fil PUBLIC d'annonce et un fil
 * PRIVÉ réservé à l'organisateur et aux participants validés, créés dans le salon des soirées de la
 * communauté. Archivés 7 jours après la clôture (archivage, jamais de suppression). Aucun appelant
 * n'écrit directement sur Discord : l'executor appelle ces fonctions (`project-space-queue.ts`).
 * Idempotent : chaque identifiant est persisté avant l'étape suivante.
 */
export interface ProjectSpaceApi {
  createPublicThread(parentChannelId: string, name: string, introduction: string): Promise<string>;
  createPrivateThread(parentChannelId: string, name: string): Promise<string>;
  addThreadMember(threadId: string, discordUserId: string): Promise<void>;
  removeThreadMember(threadId: string, discordUserId: string): Promise<void>;
  archiveThread(threadId: string): Promise<void>;
}

export interface ProjectSpaceProject {
  id: string;
  name: string;
  status: "OPEN" | "CLOSED" | "ARCHIVED";
  closedAt: Date | null;
  communityId: string;
  destination: { guildId: string; channelId: string } | null;
  /** Identifiants Discord de l'organisateur puis des participants validés. */
  roster: string[];
  publicThreadId: string | null;
  privateThreadId: string | null;
}

export interface ProjectSpacePatch {
  guildId?: string;
  parentChannelId?: string;
  publicThreadId?: string;
  privateThreadId?: string;
  status?: "ARCHIVED";
  archivedAt?: Date;
}

export interface ProjectSpacePort {
  load(projectId: string): Promise<ProjectSpaceProject | null>;
  save(projectId: string, patch: ProjectSpacePatch): Promise<void>;
}

export type ProjectSpaceStatus =
  | "created" | "reused" | "updated" | "archived" | "nothing_to_do"
  | "disabled" | "not_found" | "not_open" | "not_due" | "not_configured" | "failed";

export interface ProjectSpaceResult {
  status: ProjectSpaceStatus;
  publicThreadId?: string;
  privateThreadId?: string;
}

export function createPrismaProjectSpacePort(): ProjectSpacePort {
  const scopedDb = scopedPrisma(null);
  return {
    async load(projectId) {
      const project = await scopedDb.project.findUnique({
        where: { id: projectId },
        select: {
          id: true, name: true, status: true, closedAt: true, communityId: true, organizerId: true,
          publicThreadId: true, privateThreadId: true,
          entries: { where: { status: "ACCEPTED" }, orderBy: { createdAt: "asc" }, select: { userId: true } },
        },
      });
      if (!project) return null;
      const orderedIds = [project.organizerId, ...project.entries.map((entry) => entry.userId)];
      // Seuls les membres encore actifs de la communauté reçoivent un accès au fil privé.
      const users = await prisma.user.findMany({
        where: { id: { in: orderedIds }, ...(await communityMemberUserWhere(project.communityId)) },
        select: { id: true, discordId: true },
      });
      const discordById = new Map(users.map((user) => [user.id, user.discordId]));
      return {
        id: project.id,
        name: project.name,
        status: project.status,
        closedAt: project.closedAt,
        communityId: project.communityId,
        destination: await resolveSessionAnnounceConfig(project.communityId),
        roster: [...new Set(orderedIds.map((id) => discordById.get(id)).filter((id): id is string => !!id && /^[0-9]{16,20}$/.test(id)))],
        publicThreadId: project.publicThreadId,
        privateThreadId: project.privateThreadId,
      };
    },
    async save(projectId, patch) {
      await scopedDb.project.update({ where: { id: projectId }, data: patch });
    },
  };
}

const cleanName = (name: string, prefix: string) => `${prefix} ${name}`.replace(/[\r\n#@:`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 90);

export async function provisionProjectSpace(input: {
  projectId: string;
  api: ProjectSpaceApi;
  port?: ProjectSpacePort;
  env?: Record<string, string | undefined>;
}): Promise<ProjectSpaceResult> {
  if (!projectOrganizerEnabled(input.env ?? process.env)) return { status: "disabled" };
  const port = input.port ?? createPrismaProjectSpacePort();
  try {
    const project = await port.load(input.projectId);
    if (!project) return { status: "not_found" };
    if (project.status !== "OPEN") return { status: "not_open" };
    if (!project.destination) return { status: "not_configured" };
    const { guildId, channelId } = project.destination;
    let publicThreadId = project.publicThreadId;
    let privateThreadId = project.privateThreadId;
    if (publicThreadId && privateThreadId) return { status: "reused", publicThreadId, privateThreadId };
    if (!publicThreadId) {
      publicThreadId = await input.api.createPublicThread(channelId, cleanName(project.name, "Projet"), `Projet « ${project.name} » : les entrées sont validées par l'organisateur sur GameNight.`);
      await port.save(project.id, { guildId, parentChannelId: channelId, publicThreadId });
    }
    if (!privateThreadId) {
      privateThreadId = await input.api.createPrivateThread(channelId, cleanName(project.name, "Projet (privé)"));
      await port.save(project.id, { guildId, parentChannelId: channelId, privateThreadId });
    }
    for (const discordId of project.roster) await input.api.addThreadMember(privateThreadId, discordId);
    return { status: project.publicThreadId || project.privateThreadId ? "reused" : "created", publicThreadId, privateThreadId };
  } catch (error) {
    logger.warn("project-space", "Création des fils du projet impossible.", { errorType: error instanceof Error ? error.name : "unknown", errorMessage: error instanceof Error ? error.message : "unknown" });
    return { status: "failed" };
  }
}

/** Ajout ou retrait d'un participant sur le fil privé, d'après l'état courant. */
export async function syncProjectSpaceMember(input: {
  projectId: string;
  discordId: string;
  api: ProjectSpaceApi;
  port?: ProjectSpacePort;
  env?: Record<string, string | undefined>;
}): Promise<ProjectSpaceResult> {
  if (!projectOrganizerEnabled(input.env ?? process.env)) return { status: "disabled" };
  const port = input.port ?? createPrismaProjectSpacePort();
  try {
    const project = await port.load(input.projectId);
    if (!project) return { status: "not_found" };
    if (!project.privateThreadId || project.status === "ARCHIVED") return { status: "nothing_to_do" };
    if (project.roster.includes(input.discordId)) await input.api.addThreadMember(project.privateThreadId, input.discordId);
    else await input.api.removeThreadMember(project.privateThreadId, input.discordId);
    return { status: "updated" };
  } catch (error) {
    logger.warn("project-space", "Synchronisation d'accès au projet impossible.", { errorType: error instanceof Error ? error.name : "unknown" });
    return { status: "failed" };
  }
}

/** Archive les deux fils 7 jours après la clôture ; marque le projet ARCHIVED. Jamais de suppression. */
export async function archiveProjectSpace(input: {
  projectId: string;
  api: ProjectSpaceApi;
  port?: ProjectSpacePort;
  env?: Record<string, string | undefined>;
  now?: Date;
}): Promise<ProjectSpaceResult> {
  if (!projectOrganizerEnabled(input.env ?? process.env)) return { status: "disabled" };
  const port = input.port ?? createPrismaProjectSpacePort();
  try {
    const project = await port.load(input.projectId);
    if (!project) return { status: "not_found" };
    if (project.status === "ARCHIVED") return { status: "nothing_to_do" };
    if (!shouldArchive(project, input.now ?? new Date())) return { status: "not_due" };
    if (project.privateThreadId) await input.api.archiveThread(project.privateThreadId);
    if (project.publicThreadId) await input.api.archiveThread(project.publicThreadId);
    await port.save(project.id, { status: "ARCHIVED", archivedAt: input.now ?? new Date() });
    return { status: "archived" };
  } catch (error) {
    logger.warn("project-space", "Archivage des fils du projet impossible.", { errorType: error instanceof Error ? error.name : "unknown", errorMessage: error instanceof Error ? error.message : "unknown" });
    return { status: "failed" };
  }
}
