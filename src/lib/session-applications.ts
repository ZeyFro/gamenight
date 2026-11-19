import { prisma } from "@/lib/prisma";
import { getScopedPrisma, scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { getIsolationScope, isMemberOfCommunity } from "@/lib/community-isolation";
import { accessibleSessionWhereFor, inviteToSession } from "@/lib/session-access";
import { enqueueSessionInviteSync } from "@/lib/session-announce";
import { changeSessionSeat } from "@/lib/session-seats";
import { requestSessionSpaceMemberSyncForUser } from "@/lib/session-space-queue";
import { createNotification } from "@/lib/notifications";
import { wallClockNow } from "@/lib/wallclock";
import {
  applyDecision,
  canManageSession,
  discoverableSessionWhere,
  joinDecision,
  parseSessionVisibility,
  sessionVisibilityEnabled,
  type ApplyRefusal,
  type JoinRefusal,
} from "@/lib/session-visibility";

/**
 * Jointure, candidature, coorganisateur (flag `SESSION_VISIBILITY_ENABLED`).
 * Tout passe par une `SessionInvite` ACTIVE : c'est elle, jamais la visibilité,
 * qui ouvre l'accès au contenu d'une soirée (voir `session-visibility.ts`).
 * Aucun appel Discord direct : la synchronisation du fil privé passe par la file
 * (`enqueueSessionInviteSync`), la liste d'attente par les places existantes
 * (`changeSessionSeat`, FIFO).
 */

export type JoinResult = { ok: true; seat?: "CONFIRMED" | "WAITLIST" | "DECLINED" } | { ok: false; reason: JoinRefusal };
export type ApplyResult = { ok: true } | { ok: false; reason: ApplyRefusal };
export type DecideResult = { ok: true } | { ok: false; reason: "disabled" | "not_found" | "forbidden" | "not_pending" | "member_required" };
export type CoOrganizerResult = { ok: true } | { ok: false; reason: "disabled" | "not_found" | "forbidden" | "invalid" };

const SESSION_SELECT = {
  id: true, visibility: true, status: true, date: true, createdById: true, coOrganizerId: true,
  communityId: true, announceViaBot: true, attendanceCapacity: true,
} as const;

async function joinSeat(userId: string, session: { id: string; attendanceCapacity: number | null; status: string }) {
  // Place numérotée : la file d'attente FIFO existante décide CONFIRMED / WAITLIST.
  if (session.attendanceCapacity === null || session.status !== "SCHEDULED") return undefined;
  const seat = await changeSessionSeat(userId, session.id, { kind: "join" });
  return seat.ok ? seat.status : undefined;
}

/** « Rejoindre » une soirée PUBLIC : crée l'invitation ACTIVE du demandeur. */
export async function joinPublicSession(userId: string, sessionId: string, now: Date = wallClockNow()): Promise<JoinResult> {
  const enabled = sessionVisibilityEnabled();
  if (!enabled) return { ok: false, reason: "disabled" };
  const scopedDb = await getScopedPrisma(userId);
  // Le client scopé filtre sur les communautés ACTIVES du demandeur : hors périmètre = introuvable.
  const session = await scopedDb.session.findFirst({ where: { id: sessionId }, select: SESSION_SELECT });
  const existing = session
    ? await scopedDb.sessionInvite.findUnique({ where: { sessionId_userId: { sessionId, userId } }, select: { status: true } })
    : null;
  const decision = joinDecision(session, userId, existing?.status ?? null, now, enabled);
  if (!decision.ok) return decision;
  if (!decision.alreadyIn) {
    const invite = await inviteToSession(sessionId, userId, userId);
    if (!invite) return { ok: false, reason: "member_required" };
    if (session!.announceViaBot) await enqueueSessionInviteSync(invite.id);
    await requestSessionSpaceMemberSyncForUser({ sessionId, communityId: session!.communityId, userId });
  }
  return { ok: true, seat: await joinSeat(userId, session!) };
}

/** « Candidater » à une soirée APPLICATION : une ligne PENDING, rien d'accessible avant acceptation. */
export async function applyToSession(userId: string, sessionId: string, message: string, now: Date = wallClockNow()): Promise<ApplyResult> {
  const enabled = sessionVisibilityEnabled();
  if (!enabled) return { ok: false, reason: "disabled" };
  const scopedDb = await getScopedPrisma(userId);
  const session = await scopedDb.session.findFirst({ where: { id: sessionId }, select: SESSION_SELECT });
  const [invite, application] = session
    ? await Promise.all([
        scopedDb.sessionInvite.findUnique({ where: { sessionId_userId: { sessionId, userId } }, select: { status: true } }),
        scopedDb.sessionApplication.findUnique({ where: { sessionId_applicantId: { sessionId, applicantId: userId } }, select: { status: true } }),
      ])
    : [null, null];
  const decision = applyDecision(session, userId, invite?.status ?? null, application?.status ?? null, now, enabled);
  if (!decision.ok) return decision;
  if (!(await isMemberOfCommunity(userId, session!.communityId))) return { ok: false, reason: "member_required" };
  const text = message.trim().slice(0, 300) || null;
  if (application?.status === "PENDING") return { ok: true };
  await scopedDb.sessionApplication.upsert({
    where: { sessionId_applicantId: { sessionId, applicantId: userId } },
    create: { sessionId, applicantId: userId, message: text, status: "PENDING" },
    update: { status: "PENDING", message: text, decidedAt: null, decidedById: null },
  });
  await notifyOrganizers(session!, "Nouvelle candidature", "Un membre souhaite rejoindre ta soirée.");
  return { ok: true };
}

export async function withdrawApplication(userId: string, sessionId: string): Promise<boolean> {
  if (!sessionVisibilityEnabled()) return false;
  const scopedDb = await getScopedPrisma(userId);
  const result = await scopedDb.sessionApplication.updateMany({
    where: { sessionId, applicantId: userId, status: "PENDING" },
    data: { status: "WITHDRAWN", decidedAt: new Date() },
  });
  return result.count === 1;
}

async function notifyOrganizers(
  session: { id: string; communityId: string | null; createdById: string; coOrganizerId: string | null },
  title: string,
  message: string,
): Promise<void> {
  const targets = new Set([session.createdById, ...(session.coOrganizerId ? [session.coOrganizerId] : [])]);
  for (const userId of targets) {
    await createNotification({ communityId: session.communityId, userId, type: "REMINDER", title, message, relatedSessionId: session.id });
  }
}

/** Accepte ou refuse une candidature : créateur ou coorganisateur ayant accès à la communauté. */
export async function decideSessionApplication(
  actorId: string,
  applicationId: string,
  decision: "ACCEPT" | "DECLINE",
): Promise<DecideResult> {
  const enabled = sessionVisibilityEnabled();
  if (!enabled) return { ok: false, reason: "disabled" };
  const scopedDb = await getScopedPrisma(actorId);
  const application = await scopedDb.sessionApplication.findUnique({
    where: { id: applicationId },
    select: { id: true, sessionId: true, applicantId: true, status: true, session: { select: SESSION_SELECT } },
  });
  // Un acteur hors de la communauté de la soirée ne voit même pas la candidature.
  const scope = await getIsolationScope(actorId);
  const visible = application && (application.session.communityId === null ? scope.includesDefault : scope.communityIds.includes(application.session.communityId));
  if (!application || !visible) return { ok: false, reason: "not_found" };
  if (!canManageSession(actorId, application.session, enabled)) return { ok: false, reason: "forbidden" };
  if (application.status !== "PENDING") return { ok: false, reason: "not_pending" };

  let inviteId: string | null = null;
  const outcome = await prisma.$transaction(async (tx) => {
    const scopedDb = scopedTransactionPrisma(tx, scope);
    const updated = await scopedDb.sessionApplication.updateMany({
      where: { id: application.id, status: "PENDING" },
      data: { status: decision === "ACCEPT" ? "ACCEPTED" : "DECLINED", decidedAt: new Date(), decidedById: actorId },
    });
    if (updated.count !== 1) return "not_pending" as const;
    if (decision === "ACCEPT") {
      const invite = await inviteToSession(application.sessionId, actorId, application.applicantId, tx);
      // Le candidat n'est plus membre actif : on annule toute la décision.
      if (!invite) throw new ApplicantNotMemberError();
      inviteId = invite.id;
    }
    return "done" as const;
  }).catch((error: unknown) => {
    if (error instanceof ApplicantNotMemberError) return "member_required" as const;
    throw error;
  });
  if (outcome === "not_pending") return { ok: false, reason: "not_pending" };
  if (outcome === "member_required") return { ok: false, reason: "member_required" };

  if (decision === "ACCEPT") {
    if (inviteId && application.session.announceViaBot) await enqueueSessionInviteSync(inviteId);
    await requestSessionSpaceMemberSyncForUser({
      sessionId: application.sessionId,
      communityId: application.session.communityId,
      userId: application.applicantId,
    });
    await joinSeat(application.applicantId, application.session);
  }
  await createNotification({
    communityId: application.session.communityId,
    userId: application.applicantId,
    type: "REMINDER",
    title: decision === "ACCEPT" ? "Candidature acceptée" : "Candidature refusée",
    message: decision === "ACCEPT" ? "Tu as été accepté·e à la soirée." : "Ta candidature à la soirée n'a pas été retenue.",
    relatedSessionId: application.sessionId,
  });
  return { ok: true };
}

class ApplicantNotMemberError extends Error {}

/** Coorganisateur : désigné par le seul créateur, parmi les invités actifs (accès déjà ouvert). */
export async function setSessionCoOrganizer(actorId: string, sessionId: string, coOrganizerId: string | null): Promise<CoOrganizerResult> {
  const enabled = sessionVisibilityEnabled();
  if (!enabled) return { ok: false, reason: "disabled" };
  const scopedDb = await getScopedPrisma(actorId);
  // Accès d'abord : une soirée hors de portée du demandeur reste « introuvable », jamais « interdite » (aucune fuite d'existence).
  const session = await scopedDb.session.findFirst({ where: { id: sessionId, ...(await accessibleSessionWhereFor(actorId)) }, select: SESSION_SELECT });
  if (!session) return { ok: false, reason: "not_found" };
  if (session.createdById !== actorId) return { ok: false, reason: "forbidden" };
  if (coOrganizerId !== null) {
    if (coOrganizerId === actorId) return { ok: false, reason: "invalid" };
    const invite = await scopedDb.sessionInvite.findUnique({
      where: { sessionId_userId: { sessionId, userId: coOrganizerId } },
      select: { status: true },
    });
    if (invite?.status !== "ACTIVE" || !(await isMemberOfCommunity(coOrganizerId, session.communityId))) {
      return { ok: false, reason: "invalid" };
    }
  }
  await scopedDb.session.update({ where: { id: sessionId }, data: { coOrganizerId } });
  return { ok: true };
}

/** Changement de visibilité : créateur seul, soirée encore ouverte. Les invitations existantes ne sont jamais retirées. */
export async function setSessionVisibility(actorId: string, sessionId: string, raw: unknown): Promise<CoOrganizerResult> {
  const enabled = sessionVisibilityEnabled();
  if (!enabled) return { ok: false, reason: "disabled" };
  const visibility = parseSessionVisibility(raw);
  const scopedDb = await getScopedPrisma(actorId);
  // Accès d'abord : une soirée hors de portée du demandeur reste « introuvable », jamais « interdite » (aucune fuite d'existence).
  const session = await scopedDb.session.findFirst({ where: { id: sessionId, ...(await accessibleSessionWhereFor(actorId)) }, select: SESSION_SELECT });
  if (!session) return { ok: false, reason: "not_found" };
  if (session.createdById !== actorId) return { ok: false, reason: "forbidden" };
  if (session.status === "DONE" || session.status === "CANCELLED") return { ok: false, reason: "invalid" };
  await scopedDb.session.update({ where: { id: sessionId }, data: { visibility } });
  return { ok: true };
}

export interface DiscoverableSession {
  id: string;
  date: Date;
  status: string;
  visibility: "PUBLIC" | "APPLICATION";
  attendanceCapacity: number | null;
  organizerName: string;
  decidedGameName: string | null;
  confirmedCount: number;
  waitlistCount: number;
  applicationStatus: string | null;
}

/**
 * Soirées découvrables du demandeur (jamais une soirée PRIVATE). Informations minimales :
 * date, jeu retenu, organisateur, places ; aucun invité, aucun contenu.
 */
export async function listDiscoverableSessions(userId: string, now: Date = wallClockNow(), limit = 20): Promise<DiscoverableSession[]> {
  if (!sessionVisibilityEnabled()) return [];
  const scope = await getIsolationScope(userId);
  const scopedDb = await getScopedPrisma(userId);
  const rows = await scopedDb.session.findMany({
    where: discoverableSessionWhere(userId, scope, now),
    orderBy: { date: "asc" },
    take: limit,
    select: {
      id: true, date: true, status: true, visibility: true, attendanceCapacity: true,
      createdBy: { select: { discordName: true } },
      decidedGame: { select: { name: true } },
      seats: { select: { status: true } },
      applications: { where: { applicantId: userId }, select: { status: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    date: row.date,
    status: row.status,
    visibility: row.visibility === "APPLICATION" ? "APPLICATION" : "PUBLIC",
    attendanceCapacity: row.attendanceCapacity,
    organizerName: row.createdBy.discordName,
    decidedGameName: row.decidedGame?.name ?? null,
    confirmedCount: row.seats.filter((seat) => seat.status === "CONFIRMED").length,
    waitlistCount: row.seats.filter((seat) => seat.status === "WAITLIST").length,
    applicationStatus: row.applications[0]?.status ?? null,
  }));
}

export async function listPendingSessionApplications(actorId: string, sessionId: string) {
  if (!sessionVisibilityEnabled()) return [];
  const scopedDb = await getScopedPrisma(actorId);
  const session = await scopedDb.session.findFirst({ where: { id: sessionId }, select: SESSION_SELECT });
  if (!session || !canManageSession(actorId, session, true)) return [];
  return scopedDb.sessionApplication.findMany({
    where: { sessionId, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: { id: true, message: true, createdAt: true, applicant: { select: { id: true, discordName: true } } },
  });
}
