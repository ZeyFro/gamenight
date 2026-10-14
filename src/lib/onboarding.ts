import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { todayDateOnly } from "@/lib/wallclock";

// Réglage de compte commun à ses serveurs. Le journal ADMIN conserve ce
// choix explicite ; occurrence vide = reçu durable, conservé par rétention.
export const ONBOARDING_CHOICE = "ONBOARDING_STEAM_CHOICE";
export const ONBOARDING_REMINDER = "ONBOARDING_REMINDER";
export const onboardingEventKey = (userId: string, eventType: string) => ({
  category_eventType_sourceId_occurrence: { category: "ADMIN" as const, eventType, sourceId: userId, occurrence: "" },
});

export interface OnboardingProgress {
  steamLinked: boolean;
  steamSkipped: boolean;
  planningReady: boolean;
  guideCompleted: boolean;
}

export function missingOnboardingSteps(progress: OnboardingProgress): Array<"steam" | "planning"> {
  return [
    ...(!progress.steamLinked && !progress.steamSkipped ? ["steam" as const] : []),
    ...(!progress.planningReady ? ["planning" as const] : []),
  ];
}

/** Au plus deux lectures ciblées, mémoïsées par rendu ; aucun comptage XP/badge. */
export const getOnboardingProgress = cache(async (userId: string): Promise<OnboardingProgress | null> => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: {
      steamId64: true, onboardingCompleted: true,
      _count: { select: { weeklyAvailability: true, availabilityOverrides: { where: { date: { gte: todayDateOnly() } } } } },
    } });
  if (!user) return null;
  const choice = user.steamId64 ? null : await prisma.notificationEvent.findUnique({ where: onboardingEventKey(userId, ONBOARDING_CHOICE), select: { payload: true } });
  return {
    steamLinked: Boolean(user.steamId64),
    steamSkipped: (choice?.payload as { skipped?: boolean } | null)?.skipped === true,
    planningReady: user._count.weeklyAvailability > 0 || user._count.availabilityOverrides > 0,
    guideCompleted: user.onboardingCompleted,
  };
});
