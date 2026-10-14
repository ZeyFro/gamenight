"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { getOnboardingProgress, missingOnboardingSteps, onboardingEventKey, ONBOARDING_CHOICE } from "@/lib/onboarding";

export async function completeOnboardingAction(): Promise<boolean> {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user || !checkRateLimit(user.id, "completeOnboardingAction")) return false;
  const progress = await getOnboardingProgress(user.id);
  if (!progress || missingOnboardingSteps(progress).length) return false;
  await prisma.user.update({ where: { id: user.id }, data: { onboardingCompleted: true } });
  revalidatePath("/", "layout");
  return true;
}

/** Le client ne peut changer que le choix du compte réellement connecté. */
export async function skipSteamOnboardingAction(): Promise<boolean> {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user || !checkRateLimit(user.id, "skipSteamOnboardingAction")) return false;
  const key = onboardingEventKey(user.id, ONBOARDING_CHOICE);
  await prisma.notificationEvent.upsert({ where: key,
    create: { ...key.category_eventType_sourceId_occurrence, communityId: null, payload: { skipped: true } },
    update: { payload: { skipped: true } },
  });
  revalidatePath("/", "layout");
  return true;
}
