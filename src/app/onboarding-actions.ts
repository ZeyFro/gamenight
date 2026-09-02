"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Marque l'onboarding premier login comme vu — appelée directement depuis
 * `OnboardingFlow` (pas de `<form>`, juste un clic sur "Passer"/"Commencer"
 * ou une des CTA intermédiaires) plutôt que via FormData. Aucune entrée
 * utilisateur à valider (zod non nécessaire ici). Garde silencieuse comme
 * les autres actions "toggle" du profil : rien à afficher côté client si
 * elle échoue, le pire cas est de revoir l'écran à la prochaine visite.
 */
export async function completeOnboardingAction() {
  const user = await getCurrentUser();
  if (!user) return;
  if (!checkRateLimit(user.id, "completeOnboardingAction")) return;
  if (user.onboardingCompleted) return;

  await prisma.user.update({
    where: { id: user.id },
    data: { onboardingCompleted: true },
  });

  revalidatePath("/");
}
