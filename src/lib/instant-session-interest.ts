import { getScopedPrisma } from "@/lib/community-scoped-client";
import { teamRivalriesEnabled } from "@/lib/team-rivalries-rules";
import { createNotification } from "@/lib/notifications";
import { wallClockNow } from "@/lib/wallclock";

/**
 * « Intéressé » sur « Jouer maintenant » (flag `TEAM_RIVALRIES_ENABLED`). Signal léger : ne remplace pas
 * « Rejoindre » (la présence reste la seule source des récompenses) et n'a aucune valeur de présence.
 * Valable tant que la session est ACTIVE : avec le flag, elle expire 2 h après sa création, et l'intérêt
 * avec elle. Rejoindre efface l'intérêt. Aucun Discord, aucune mention.
 */
export const INSTANT_SESSION_MAX_DURATION_WITH_INTEREST_MS = 2 * 60 * 60 * 1000;
export const INSTANT_SESSION_DEFAULT_MAX_DURATION_MS = 3 * 60 * 60 * 1000;

/** Durée d'une nouvelle session : 2 h flag allumé, 3 h sinon (les sessions existantes gardent leur échéance). */
export function instantSessionDurationMs(env: Record<string, string | undefined> = process.env): number {
  return teamRivalriesEnabled(env) ? INSTANT_SESSION_MAX_DURATION_WITH_INTEREST_MS : INSTANT_SESSION_DEFAULT_MAX_DURATION_MS;
}

export type InterestResult = { ok: true } | { ok: false; reason: "disabled" | "not_found" | "ended" | "participant" | "creator" };

export async function markInstantSessionInterest(instantSessionId: string, userId: string, now: Date = wallClockNow()): Promise<InterestResult> {
  if (!teamRivalriesEnabled()) return { ok: false, reason: "disabled" };
  const scopedDb = await getScopedPrisma(userId);
  const session = await scopedDb.instantSession.findUnique({
    where: { id: instantSessionId },
    select: {
      id: true, status: true, expiresAt: true, createdById: true, communityId: true,
      presence: { where: { userId, endedAt: null }, select: { userId: true } },
    },
  });
  if (!session) return { ok: false, reason: "not_found" };
  if (session.status !== "ACTIVE" || session.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "ended" };
  if (session.createdById === userId) return { ok: false, reason: "creator" };
  if (session.presence.length > 0) return { ok: false, reason: "participant" };
  const existing = await scopedDb.instantSessionInterest.findUnique({ where: { instantSessionId_userId: { instantSessionId, userId } }, select: { id: true } });
  if (existing) return { ok: true };
  await scopedDb.instantSessionInterest.create({ data: { instantSessionId, userId } });
  await createNotification({ communityId: session.communityId, userId: session.createdById, type: "REMINDER", title: "Quelqu'un est intéressé", message: "Un joueur est intéressé par ta session « Jouer maintenant »." });
  return { ok: true };
}

/** Dans la transaction de « Rejoindre » : l'intérêt est remplacé par la présence. No-op flag éteint (table possiblement absente). */
export async function dropInterestOnJoin(
  scopedDb: { instantSessionInterest: { deleteMany(args: { where: { instantSessionId: string; userId: string } }): PromiseLike<unknown> } },
  instantSessionId: string,
  userId: string,
): Promise<void> {
  if (!teamRivalriesEnabled()) return;
  await scopedDb.instantSessionInterest.deleteMany({ where: { instantSessionId, userId } });
}

export async function clearInstantSessionInterest(instantSessionId: string, userId: string): Promise<boolean> {
  if (!teamRivalriesEnabled()) return false;
  const scopedDb = await getScopedPrisma(userId);
  if (!(await scopedDb.instantSession.findUnique({ where: { id: instantSessionId }, select: { id: true } }))) return false;
  const result = await scopedDb.instantSessionInterest.deleteMany({ where: { instantSessionId, userId } });
  return result.count > 0;
}

/** Intéressés d'une session ACTIVE visible du lecteur (liste vide flag éteint ou session terminée). */
export async function listInstantSessionInterest(instantSessionId: string, viewerId: string) {
  if (!teamRivalriesEnabled()) return { interested: [] as Array<{ userId: string; discordName: string }>, viewerIsInterested: false };
  const scopedDb = await getScopedPrisma(viewerId);
  const session = await scopedDb.instantSession.findUnique({
    where: { id: instantSessionId },
    select: { status: true, interests: { orderBy: { createdAt: "asc" }, take: 50, select: { userId: true, user: { select: { discordName: true } } } } },
  });
  if (!session || session.status !== "ACTIVE") return { interested: [], viewerIsInterested: false };
  return {
    interested: session.interests.map((row) => ({ userId: row.userId, discordName: row.user.discordName })),
    viewerIsInterested: session.interests.some((row) => row.userId === viewerId),
  };
}
