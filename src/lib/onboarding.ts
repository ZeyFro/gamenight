import { prisma } from "@/lib/prisma";

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
 */
export async function shouldShowOnboarding(
  userId: string,
  onboardingCompleted: boolean
): Promise<boolean> {
  if (onboardingCompleted) return false;

  const [sessionsParticipated, weeklySlots, overrides] = await Promise.all([
    prisma.xpEvent.count({ where: { userId, reason: "PARTICIPATE" } }),
    prisma.weeklyAvailability.count({ where: { userId } }),
    prisma.availabilityOverride.count({ where: { userId } }),
  ]);

  return sessionsParticipated === 0 && weeklySlots === 0 && overrides === 0;
}
