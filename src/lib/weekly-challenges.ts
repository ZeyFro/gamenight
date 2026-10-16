import { scopedPrisma, scopedPrismaForCommunityId } from "@/lib/community-scoped-client";
import { cronCommunityScope } from "@/lib/community-isolation";
import { statsCommunityIdForSession, writeCommunityIdForUser } from "@/lib/community-stats";
import { isUniqueConstraintViolation } from "@/lib/xp-actions";
import { wallClockNow } from "@/lib/wallclock";
import { addDays, getWeekStart } from "@/lib/calendar-dates";
import { getWinningProposalParticipants } from "@/lib/superlative-voting";
import { awardXp } from "@/lib/xp-actions";
import { XP_AMOUNTS } from "@/lib/xp";
import { checkChallengeBadges } from "@/lib/badges";
import { getDefaultCommunityId } from "@/lib/default-community";
import type { WeeklyChallenge } from "@prisma/client";

/**
 * Défi hebdomadaire évalué automatiquement à la clôture des soirées.
 */
const CHALLENGE_TEMPLATES: { type: string; description: string }[] = [
  { type: "T16", description: "Jouer à deux jeux différents pendant la semaine" },
  { type: "T17", description: "Accueillir un nouveau membre cette semaine" },
];

/**
 * Défi de la semaine en cours — génération paresseuse au premier appel
 * de la semaine (pas de cron dédié) : si aucune ligne n'existe pour le
 * `weekStart` courant, une est créée depuis le template automatique actif.
 * `catch` sur la contrainte unique `@@unique([communityId, weekStart])` plutôt qu'un
 * verrou explicite : sous accès concurrents (deux chargements de Home en
 * même temps un lundi matin), un seul `create` gagne, l'autre retombe
 * simplement sur un `findUnique` — même mécanique d'idempotence que
 * `unlockBadge`.
 */
export async function getCurrentWeeklyChallenge(communityId: string): Promise<WeeklyChallenge> {
  const weekStart = getWeekStart(wallClockNow());
  const scopedDb = await scopedPrismaForCommunityId(communityId);
  const key = { communityId_weekStart: { communityId, weekStart } };

  const existing = await scopedDb.weeklyChallenge.findUnique({ where: key });
  if (existing) {
    if (!existing.completedAt && !["T16", "T17"].includes(existing.type)) {
      await scopedDb.weeklyChallenge.updateMany({
        where: { id: existing.id, completedAt: null },
        data: { type: "T16", description: CHALLENGE_TEMPLATES[0].description },
      });
      return scopedDb.weeklyChallenge.findUniqueOrThrow({ where: key });
    }
    return existing;
  }

  const template = CHALLENGE_TEMPLATES[Math.floor(Math.random() * CHALLENGE_TEMPLATES.length)];

  try {
    return await scopedDb.weeklyChallenge.create({
      data: { communityId, weekStart, type: template.type, description: template.description },
    });
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
    // Course perdue contre un autre appel concurrent — la ligne existe
    // forcément maintenant.
    return await scopedDb.weeklyChallenge.findUniqueOrThrow({ where: key });
  }
}

/**
 * Valide automatiquement le défi selon son objectif : deux jeux distincts
 * joués cette semaine ou l'arrivée d'un nouveau membre actif.
 *
 * L'XP et le badge sont attribués une fois à chaque participant des soirées
 * retenues, après une réclamation atomique du défi.
 */
export async function completeWeeklyChallenge(
  sessionId: string
): Promise<{ completed: boolean; badgeUnlockedByUserId: Record<string, boolean> }> {
  const scopedDb = scopedPrisma(await cronCommunityScope());
  const session = await scopedDb.session.findUnique({
    where: { id: sessionId },
    select: { status: true, date: true, decidedGameId: true, communityId: true },
  });
  if (!session || session.status !== "DONE" || !session.decidedGameId) {
    return { completed: false, badgeUnlockedByUserId: {} };
  }

  const challenge = await getCurrentWeeklyChallenge(await statsCommunityIdForSession(session.communityId));
  const weekEnd = addDays(challenge.weekStart, 7);
  if (challenge.completedAt || session.date < challenge.weekStart || session.date >= weekEnd) {
    return { completed: false, badgeUnlockedByUserId: {} };
  }

  const defaultCommunityId = await getDefaultCommunityId();
  const sessions = await scopedDb.session.findMany({
    where: {
      status: "DONE",
      decidedGameId: { not: null },
      date: { gte: challenge.weekStart, lt: weekEnd },
      OR: [
        { communityId: challenge.communityId },
        ...(challenge.communityId === defaultCommunityId ? [{ communityId: null }] : []),
      ],
    },
    select: { id: true, decidedGameId: true },
  });
  const completed = challenge.type === "T17"
    ? await scopedDb.membership.count({
        where: {
          communityId: challenge.communityId,
          status: "ACTIVE",
          joinedAt: { gte: challenge.weekStart, lt: weekEnd },
        },
      }) > 0
    : new Set(sessions.map((item) => item.decidedGameId)).size >= 2;
  if (!completed) {
    return { completed: false, badgeUnlockedByUserId: {} };
  }

  const claimed = await scopedDb.weeklyChallenge.updateMany({
    where: { id: challenge.id, completedAt: null },
    data: { completedAt: wallClockNow(), completedBySessionId: sessionId },
  });
  if (claimed.count === 0) return { completed: false, badgeUnlockedByUserId: {} };

  const participants = new Map<string, Awaited<ReturnType<typeof getWinningProposalParticipants>>[number]>();
  for (const played of sessions) {
    if (!played.decidedGameId) continue;
    for (const participant of await getWinningProposalParticipants(played.id, played.decidedGameId)) {
      participants.set(participant.id, participant);
    }
  }

  const badgeUnlockedByUserId: Record<string, boolean> = {};
  for (const participant of participants.values()) {
    await awardXp(participant.id, challenge.communityId,
      "CHALLENGE_COMPLETE",
      challenge.id,
      XP_AMOUNTS.CHALLENGE_COMPLETE
    );
    badgeUnlockedByUserId[participant.id] = await checkChallengeBadges(participant.id, challenge.communityId);
  }

  return { completed: true, badgeUnlockedByUserId };
}

/** Défi du serveur actif ; aucun défi ni création sans appartenance active. */
export async function getCurrentWeeklyChallengeForViewer(viewerId: string): Promise<WeeklyChallenge | null> {
  const communityId = await writeCommunityIdForUser(viewerId);
  return communityId === null ? null : getCurrentWeeklyChallenge(communityId);
}
