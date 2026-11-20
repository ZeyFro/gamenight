import { z } from "zod";

/**
 * Règles pures des projets à organisateur (flag `PROJECT_ORGANIZER_ENABLED`, OFF par défaut).
 * `endsAt` suit la convention « horloge murale » de `Session.date` (voir `wallclock.ts`) ;
 * `closedAt` / `archivedAt` sont de vrais instants.
 */
export const PROJECT_ARCHIVE_DELAY_MS = 7 * 24 * 3_600_000;
export const PROJECT_MIN_DURATION_MS = 3_600_000;
export const PROJECT_MAX_DURATION_MS = 365 * 24 * 3_600_000;
export const PROJECT_MAX_ENTRIES_LIMIT = 200;

export function projectOrganizerEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.PROJECT_ORGANIZER_ENABLED === "true";
}

export const projectInputSchema = z.object({
  name: z.string().trim().min(3).max(80),
  description: z.string().trim().min(10).max(1000),
  gameName: z.string().trim().max(80).optional().transform((value) => value || undefined),
  maxEntries: z.coerce.number().int().min(2).max(PROJECT_MAX_ENTRIES_LIMIT).optional(),
});

export const projectEntryMessageSchema = z.string().trim().max(300);

export type ProjectEntryStatusValue = "PENDING" | "ACCEPTED" | "DECLINED" | "WITHDRAWN";

/** La date de fin doit tomber entre 1 h et 365 jours dans le futur (horloge murale). */
export function validateEndsAt(endsAt: Date, now: Date): "ok" | "too_soon" | "too_far" | "invalid" {
  if (Number.isNaN(endsAt.getTime())) return "invalid";
  const delta = endsAt.getTime() - now.getTime();
  if (delta < PROJECT_MIN_DURATION_MS) return "too_soon";
  if (delta > PROJECT_MAX_DURATION_MS) return "too_far";
  return "ok";
}

export interface ProjectLike {
  status: "OPEN" | "CLOSED" | "ARCHIVED";
  endsAt: Date;
  organizerId: string;
  maxEntries: number | null;
}

/** Candidature possible : projet ouvert, avant la fin, jamais l'organisateur, pas de doublon actif ni de refus. */
export function entryDecision(
  project: ProjectLike,
  userId: string,
  existing: ProjectEntryStatusValue | null,
  now: Date,
): { ok: true; reuse: boolean } | { ok: false; reason: "closed" | "own" | "pending" | "member" | "declined" } {
  if (project.status !== "OPEN" || project.endsAt.getTime() <= now.getTime()) return { ok: false, reason: "closed" };
  if (project.organizerId === userId) return { ok: false, reason: "own" };
  if (existing === "PENDING") return { ok: false, reason: "pending" };
  if (existing === "ACCEPTED") return { ok: false, reason: "member" };
  // Un refus de l'organisateur est définitif ; seul un retrait volontaire peut être redéposé.
  if (existing === "DECLINED") return { ok: false, reason: "declined" };
  return { ok: true, reuse: existing === "WITHDRAWN" };
}

/** Acceptation : seule une candidature en attente, dans la limite de places (organisateur non compté). */
export function acceptDecision(
  project: ProjectLike,
  entryStatus: ProjectEntryStatusValue,
  acceptedCount: number,
): "ok" | "not_pending" | "closed" | "full" {
  if (entryStatus !== "PENDING") return "not_pending";
  if (project.status !== "OPEN") return "closed";
  if (project.maxEntries !== null && acceptedCount >= project.maxEntries) return "full";
  return "ok";
}

export function shouldClose(project: Pick<ProjectLike, "status" | "endsAt">, wallNow: Date): boolean {
  return project.status === "OPEN" && project.endsAt.getTime() <= wallNow.getTime();
}

/** Archivage 7 jours après la clôture, jamais avant, jamais deux fois. */
export function shouldArchive(project: { status: string; closedAt: Date | null }, now: Date): boolean {
  return project.status === "CLOSED" && project.closedAt !== null && now.getTime() - project.closedAt.getTime() >= PROJECT_ARCHIVE_DELAY_MS;
}
