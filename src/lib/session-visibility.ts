import type { Prisma } from "@prisma/client";
import { communityIdFilter, type IsolationScope } from "@/lib/community-isolation";

/**
 * Visibilité des soirées (flag `SESSION_VISIBILITY_ENABLED`, éteint par défaut).
 *
 * Règle de sûreté centrale : la visibilité ne change JAMAIS l'accès au contenu d'une
 * soirée. L'accès (détail, votes, chat, annonces, API, calendrier) reste celui de
 * `src/lib/session-access.ts` : créateur ou invité ACTIF. Une soirée PUBLIC ou
 * APPLICATION est seulement « découvrable » : une liste distincte (`discoverableSessionWhere`)
 * l'expose avec des informations minimales, et la jointure/candidature crée une
 * invitation ; c'est l'invitation qui ouvre l'accès. Aucune liste ni API existante
 * n'est élargie, donc une soirée PRIVATE ne peut fuiter par aucune d'elles.
 *
 * Flag éteint : toute valeur stockée est traitée comme PRIVATE (`effectiveVisibility`).
 */
export const SESSION_VISIBILITIES = ["PRIVATE", "PUBLIC", "APPLICATION"] as const;
export type SessionVisibilityValue = (typeof SESSION_VISIBILITIES)[number];

/** Délai avant le début à partir duquel le fil privé et le vocal temporaire sont créés. */
export const SESSION_SPACE_LEAD_MS = 30 * 60_000;
/** La soirée n'a pas d'heure de fin : sans clôture explicite, fin présumée 6 h après le début. */
export const SESSION_ASSUMED_DURATION_MS = 6 * 60 * 60_000;
/** Au-delà, le nettoyage automatique cesse d'être retenté (le staff décide). */
export const SESSION_SPACE_CLEANUP_GIVE_UP_MS = 24 * 60 * 60_000;
/** Plafond d'overwrites par salon Discord = 100 ; marge pour @everyone et le bot. */
export const SESSION_SPACE_MAX_MEMBERS = 90;

export function sessionVisibilityEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.SESSION_VISIBILITY_ENABLED === "true";
}

/** Fail-closed : toute valeur inconnue devient PRIVATE. */
export function parseSessionVisibility(raw: unknown): SessionVisibilityValue {
  return typeof raw === "string" && (SESSION_VISIBILITIES as readonly string[]).includes(raw)
    ? (raw as SessionVisibilityValue)
    : "PRIVATE";
}

/** Flag éteint = PRIVATE, quelle que soit la valeur en base. */
export function effectiveVisibility(stored: unknown, enabled: boolean = sessionVisibilityEnabled()): SessionVisibilityValue {
  return enabled ? parseSessionVisibility(stored) : "PRIVATE";
}

export function isDiscoverableVisibility(visibility: SessionVisibilityValue): boolean {
  return visibility === "PUBLIC" || visibility === "APPLICATION";
}

/**
 * Créateur et coorganisateur gèrent invitations, candidatures et créneau. Le
 * coorganisateur n'est reconnu que flag allumé ; il ne supprime ni ne transmet jamais la soirée.
 */
export function canManageSession(
  userId: string,
  session: { createdById: string; coOrganizerId?: string | null },
  enabled: boolean = sessionVisibilityEnabled(),
): boolean {
  if (session.createdById === userId) return true;
  return enabled && !!session.coOrganizerId && session.coOrganizerId === userId;
}

/** Fin présumée d'une soirée : statut terminal, sinon début + durée présumée. */
export function sessionEndedAt(session: { status: string; date: Date }, now: Date): boolean {
  if (session.status === "DONE" || session.status === "CANCELLED") return true;
  return now.getTime() >= session.date.getTime() + SESSION_ASSUMED_DURATION_MS;
}

/** Moment de création de l'espace Discord : de 30 min avant le début jusqu'à la fin présumée. */
export function sessionSpaceDue(session: { status: string; date: Date }, now: Date): boolean {
  if (session.status !== "SCHEDULED") return false;
  const start = session.date.getTime();
  return now.getTime() >= start - SESSION_SPACE_LEAD_MS && now.getTime() < start + SESSION_ASSUMED_DURATION_MS;
}

/**
 * Soirées découvrables par `userId` : PUBLIC ou APPLICATION, à venir, de sa communauté
 * active, dont il n'est ni créateur ni déjà invité ACTIF. `now` est l'horloge murale
 * (voir `wallclock.ts`), comme `Session.date`. Les soirées PRIVATE n'y figurent jamais.
 */
export function discoverableSessionWhere(
  userId: string,
  scope: IsolationScope | null,
  now: Date,
): Prisma.SessionWhereInput {
  return {
    AND: [
      { visibility: { in: ["PUBLIC", "APPLICATION"] } },
      { status: { in: ["VOTING", "SCHEDULED"] } },
      { date: { gt: now } },
      { createdById: { not: userId } },
      { invites: { none: { userId, status: "ACTIVE" } } },
      communityIdFilter(scope),
    ],
  };
}

export type JoinRefusal = "disabled" | "not_found" | "closed" | "own" | "removed" | "not_public" | "member_required";
export type ApplyRefusal = "disabled" | "not_found" | "closed" | "own" | "invited" | "not_application" | "declined" | "member_required";

export interface JoinableSession {
  visibility: unknown;
  status: string;
  date: Date;
  createdById: string;
}

/** Décision pure de « Rejoindre » ; l'appartenance à la communauté est vérifiée par l'appelant. */
export function joinDecision(
  session: JoinableSession | null,
  userId: string,
  existingInviteStatus: "ACTIVE" | "REVOKED" | null,
  now: Date,
  enabled: boolean = sessionVisibilityEnabled(),
): { ok: true; alreadyIn: boolean } | { ok: false; reason: JoinRefusal } {
  if (!enabled) return { ok: false, reason: "disabled" };
  if (!session) return { ok: false, reason: "not_found" };
  if (session.createdById === userId) return { ok: false, reason: "own" };
  if (effectiveVisibility(session.visibility, enabled) !== "PUBLIC") return { ok: false, reason: "not_public" };
  if (!["VOTING", "SCHEDULED"].includes(session.status) || session.date.getTime() <= now.getTime()) {
    return { ok: false, reason: "closed" };
  }
  // Un retrait décidé par l'organisateur est définitif : on ne revient pas seul.
  if (existingInviteStatus === "REVOKED") return { ok: false, reason: "removed" };
  return { ok: true, alreadyIn: existingInviteStatus === "ACTIVE" };
}

/** Décision pure de « Candidater ». */
export function applyDecision(
  session: JoinableSession | null,
  userId: string,
  existingInviteStatus: "ACTIVE" | "REVOKED" | null,
  existingApplication: "PENDING" | "ACCEPTED" | "DECLINED" | "WITHDRAWN" | null,
  now: Date,
  enabled: boolean = sessionVisibilityEnabled(),
): { ok: true; reuse: boolean } | { ok: false; reason: ApplyRefusal } {
  if (!enabled) return { ok: false, reason: "disabled" };
  if (!session) return { ok: false, reason: "not_found" };
  if (session.createdById === userId) return { ok: false, reason: "own" };
  if (effectiveVisibility(session.visibility, enabled) !== "APPLICATION") return { ok: false, reason: "not_application" };
  if (!["VOTING", "SCHEDULED"].includes(session.status) || session.date.getTime() <= now.getTime()) {
    return { ok: false, reason: "closed" };
  }
  if (existingInviteStatus === "ACTIVE") return { ok: false, reason: "invited" };
  // Refus et retrait par l'organisateur : une candidature refusée ou un invité retiré ne se rouvre pas seul.
  if (existingApplication === "DECLINED" || existingInviteStatus === "REVOKED") return { ok: false, reason: "declined" };
  return { ok: true, reuse: existingApplication !== null };
}
