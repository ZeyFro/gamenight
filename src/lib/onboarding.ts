import { prisma } from "@/lib/prisma";
import { scopedPrismaForCommunityId } from "@/lib/community-scoped-client";
import { writeCommunityIdForUser } from "@/lib/community-stats";

/**
 * Déclenchement de l'onboarding premier login (Sprint 2 PR-B, U1) :
 * `onboardingCompleted` coupe court dès qu'il est passé à `true` (vu ou
 * skippé une fois, ne se réaffiche plus jamais). Tant qu'il est `false`
 * (comptes déjà existants avant cette PR inclus — migration additive), on
 * ne montre l'écran que si le compte n'a strictement rien fait encore :
 * aucune soirée jouée (même définition que `getProfileStats`, `XpEvent`
 * PARTICIPATE) et aucune dispo réglée (ni créneau récurrent, ni
 * exception ponctuelle) — un compte plus ancien qui a déjà de l'activité
 * ne se voit jamais imposer ce tutoriel après coup.
 *
 * PR B : « aucune soirée jouée » s'entend dans la communauté courante de
 * l'utilisateur (`XpEvent` est propre à chaque communauté).
 */
export async function shouldShowOnboarding(
  userId: string,
  onboardingCompleted: boolean
): Promise<boolean> {
  if (onboardingCompleted) return false;

  const communityId = await writeCommunityIdForUser(userId);
  const scopedDb = communityId === null ? null : await scopedPrismaForCommunityId(communityId);
  const [sessionsParticipated, weeklySlots, overrides] = await Promise.all([
    communityId === null || scopedDb === null
      ? 0
      : scopedDb.xpEvent.count({ where: { communityId, userId, reason: "PARTICIPATE" } }),
    prisma.weeklyAvailability.count({ where: { userId } }),
    prisma.availabilityOverride.count({ where: { userId } }),
  ]);

  return sessionsParticipated === 0 && weeklySlots === 0 && overrides === 0;
}
