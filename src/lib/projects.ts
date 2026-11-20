import { getScopedPrisma } from "@/lib/community-scoped-client";
import { isMemberOfCommunity } from "@/lib/community-isolation";
import { pickCreationCommunityId } from "@/lib/community-channels";
import { getDefaultCommunityId } from "@/lib/default-community";
import { createNotification } from "@/lib/notifications";
import { wallClockNow } from "@/lib/wallclock";
import { enqueueProjectSync, requestProjectMemberSync } from "@/lib/project-space-queue";
import {
  acceptDecision,
  entryDecision,
  projectEntryMessageSchema,
  projectInputSchema,
  projectOrganizerEnabled,
  validateEndsAt,
} from "@/lib/projects-rules";

/**
 * Projets à organisateur (flag `PROJECT_ORGANIZER_ENABLED`). Distincts des équipes : un joueur participe à
 * autant de projets qu'il veut. L'organisateur valide chaque entrée ; le projet se clôture à sa date de
 * fin ou par l'organisateur ; les fils Discord passent par la file (`project-space-queue.ts`).
 * Aucun XP, aucun étage, aucun appel Discord direct.
 */
export type ProjectResult<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

/** Communauté de travail du demandeur, seulement s'il en est membre actif et que le flag est allumé. */
export async function getProjectsCommunityId(userId: string): Promise<string | null> {
  if (!projectOrganizerEnabled()) return null;
  const communityId = (await pickCreationCommunityId(userId)) ?? (await getDefaultCommunityId());
  return (await isMemberOfCommunity(userId, communityId)) ? communityId : null;
}

export async function createProject(
  userId: string,
  communityId: string,
  raw: { name: unknown; description: unknown; gameName?: unknown; maxEntries?: unknown },
  endsAt: Date,
  wallNow: Date = wallClockNow(),
): Promise<ProjectResult<{ projectId: string }>> {
  if (!projectOrganizerEnabled()) return { ok: false, reason: "disabled" };
  const parsed = projectInputSchema.safeParse({ ...raw, maxEntries: raw.maxEntries === "" || raw.maxEntries == null ? undefined : raw.maxEntries });
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const ends = validateEndsAt(endsAt, wallNow);
  if (ends !== "ok") return { ok: false, reason: ends };
  if (!(await isMemberOfCommunity(userId, communityId))) return { ok: false, reason: "member_required" };
  const scopedDb = await getScopedPrisma(userId);
  const project = await scopedDb.project.create({
    data: {
      communityId,
      organizerId: userId,
      name: parsed.data.name,
      description: parsed.data.description,
      gameName: parsed.data.gameName ?? null,
      maxEntries: parsed.data.maxEntries ?? null,
      endsAt,
    },
    select: { id: true },
  });
  // Fils Discord : demande en file seulement (no-op si les verrous ne sont pas tous allumés).
  await enqueueProjectSync({ intent: "provision", projectId: project.id, communityId });
  return { ok: true, projectId: project.id };
}

const LIST_SELECT = (userId: string) => ({
  id: true, name: true, description: true, gameName: true, maxEntries: true, endsAt: true, status: true, organizerId: true,
  organizer: { select: { discordName: true } },
  entries: { where: { OR: [{ status: "ACCEPTED" as const }, { userId }] }, select: { userId: true, status: true } },
});

export async function listProjects(userId: string, communityId: string) {
  if (!projectOrganizerEnabled()) return [];
  const scopedDb = await getScopedPrisma(userId);
  const rows = await scopedDb.project.findMany({
    where: { communityId, status: { in: ["OPEN", "CLOSED"] } },
    orderBy: [{ status: "asc" }, { endsAt: "asc" }],
    take: 50,
    select: LIST_SELECT(userId),
  });
  return rows.map((row) => ({
    id: row.id, name: row.name, description: row.description, gameName: row.gameName, maxEntries: row.maxEntries,
    endsAt: row.endsAt, status: row.status, organizerName: row.organizer.discordName, isOrganizer: row.organizerId === userId,
    acceptedCount: row.entries.filter((entry) => entry.status === "ACCEPTED").length,
    myEntry: row.entries.find((entry) => entry.userId === userId)?.status ?? null,
  }));
}

/** Détail : l'organisateur voit les candidatures en attente, les autres seulement les participants validés. */
export async function getProject(userId: string, communityId: string, projectId: string) {
  if (!projectOrganizerEnabled()) return null;
  const scopedDb = await getScopedPrisma(userId);
  const project = await scopedDb.project.findFirst({
    where: { id: projectId, communityId },
    select: {
      id: true, name: true, description: true, gameName: true, maxEntries: true, endsAt: true, status: true, closedAt: true, organizerId: true,
      organizer: { select: { discordName: true } },
      entries: {
        where: { status: { in: ["PENDING", "ACCEPTED"] } },
        orderBy: { createdAt: "asc" },
        select: { id: true, userId: true, status: true, message: true, createdAt: true, user: { select: { discordName: true } } },
      },
    },
  });
  if (!project) return null;
  const isOrganizer = project.organizerId === userId;
  return {
    id: project.id, name: project.name, description: project.description, gameName: project.gameName, maxEntries: project.maxEntries,
    endsAt: project.endsAt, status: project.status, closedAt: project.closedAt, organizerName: project.organizer.discordName, isOrganizer,
    participants: project.entries.filter((entry) => entry.status === "ACCEPTED").map((entry) => ({ userId: entry.userId, name: entry.user.discordName })),
    pending: isOrganizer
      ? project.entries.filter((entry) => entry.status === "PENDING").map((entry) => ({ id: entry.id, name: entry.user.discordName, message: entry.message, createdAt: entry.createdAt }))
      : [],
    myEntry: project.entries.find((entry) => entry.userId === userId)?.status ?? null,
  };
}

async function loadForActor(userId: string, communityId: string, projectId: string) {
  const scopedDb = await getScopedPrisma(userId);
  const project = await scopedDb.project.findFirst({
    where: { id: projectId, communityId },
    select: { id: true, name: true, status: true, endsAt: true, organizerId: true, maxEntries: true, communityId: true },
  });
  return { scopedDb, project };
}

/** Candidature d'un membre : PENDING jusqu'à la décision de l'organisateur. */
export async function applyToProject(userId: string, communityId: string, projectId: string, message: string, wallNow: Date = wallClockNow()): Promise<ProjectResult> {
  if (!projectOrganizerEnabled()) return { ok: false, reason: "disabled" };
  const text = projectEntryMessageSchema.safeParse(message);
  if (!text.success) return { ok: false, reason: "invalid" };
  const { scopedDb, project } = await loadForActor(userId, communityId, projectId);
  if (!project) return { ok: false, reason: "missing" };
  const existing = await scopedDb.projectEntry.findUnique({ where: { projectId_userId: { projectId, userId } }, select: { status: true } });
  const decision = entryDecision({ ...project, status: project.status }, userId, existing?.status ?? null, wallNow);
  if (!decision.ok) return decision;
  if (!(await isMemberOfCommunity(userId, communityId))) return { ok: false, reason: "member_required" };
  await scopedDb.projectEntry.upsert({
    where: { projectId_userId: { projectId, userId } },
    create: { projectId, userId, message: text.data || null, status: "PENDING" },
    update: { status: "PENDING", message: text.data || null, decidedAt: null, decidedById: null },
  });
  await createNotification({ communityId, userId: project.organizerId, type: "REMINDER", title: "Nouvelle entrée dans ton projet", message: `Une candidature attend ta validation pour « ${project.name} ».` });
  return { ok: true };
}

/** Retrait volontaire (candidature en attente ou participation) ; l'accès au fil privé est retiré. */
export async function withdrawFromProject(userId: string, communityId: string, projectId: string): Promise<ProjectResult> {
  if (!projectOrganizerEnabled()) return { ok: false, reason: "disabled" };
  const { scopedDb, project } = await loadForActor(userId, communityId, projectId);
  if (!project) return { ok: false, reason: "missing" };
  const result = await scopedDb.projectEntry.updateMany({
    where: { projectId, userId, status: { in: ["PENDING", "ACCEPTED"] } },
    data: { status: "WITHDRAWN", decidedAt: new Date() },
  });
  if (result.count !== 1) return { ok: false, reason: "no_entry" };
  await requestProjectMemberSync({ projectId, communityId, userId });
  return { ok: true };
}

/** Décision de l'organisateur sur une entrée : seul lui valide ; places comptées hors organisateur. */
export async function decideProjectEntry(actorId: string, communityId: string, entryId: string, decision: "ACCEPT" | "DECLINE"): Promise<ProjectResult> {
  if (!projectOrganizerEnabled()) return { ok: false, reason: "disabled" };
  const scopedDb = await getScopedPrisma(actorId);
  const entry = await scopedDb.projectEntry.findUnique({
    where: { id: entryId },
    select: { id: true, userId: true, status: true, project: { select: { id: true, name: true, status: true, endsAt: true, organizerId: true, maxEntries: true, communityId: true } } },
  });
  if (!entry || entry.project.communityId !== communityId) return { ok: false, reason: "missing" };
  if (entry.project.organizerId !== actorId) return { ok: false, reason: "forbidden" };
  if (decision === "ACCEPT") {
    const accepted = await scopedDb.projectEntry.count({ where: { projectId: entry.project.id, status: "ACCEPTED" } });
    const verdict = acceptDecision(entry.project, entry.status, accepted);
    if (verdict !== "ok") return { ok: false, reason: verdict };
  } else if (entry.status !== "PENDING") {
    return { ok: false, reason: "not_pending" };
  }
  const updated = await scopedDb.projectEntry.updateMany({
    where: { id: entry.id, status: "PENDING" },
    data: { status: decision === "ACCEPT" ? "ACCEPTED" : "DECLINED", decidedAt: new Date(), decidedById: actorId },
  });
  if (updated.count !== 1) return { ok: false, reason: "not_pending" };
  if (decision === "ACCEPT") await requestProjectMemberSync({ projectId: entry.project.id, communityId, userId: entry.userId });
  await createNotification({
    communityId, userId: entry.userId, type: "REMINDER",
    title: decision === "ACCEPT" ? "Entrée validée" : "Entrée refusée",
    message: decision === "ACCEPT" ? `Tu participes au projet « ${entry.project.name} ».` : `Ta candidature au projet « ${entry.project.name} » n'a pas été retenue.`,
  });
  return { ok: true };
}

/** Clôture anticipée par l'organisateur ; l'archivage des fils suit 7 jours plus tard. */
export async function closeProject(actorId: string, communityId: string, projectId: string): Promise<ProjectResult> {
  if (!projectOrganizerEnabled()) return { ok: false, reason: "disabled" };
  const { scopedDb, project } = await loadForActor(actorId, communityId, projectId);
  if (!project) return { ok: false, reason: "missing" };
  if (project.organizerId !== actorId) return { ok: false, reason: "forbidden" };
  const result = await scopedDb.project.updateMany({ where: { id: projectId, status: "OPEN" }, data: { status: "CLOSED", closedAt: new Date() } });
  return result.count === 1 ? { ok: true } : { ok: false, reason: "closed" };
}
