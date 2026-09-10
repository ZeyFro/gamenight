"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { checkRateLimit, RATE_LIMIT_ERROR_KEY } from "@/lib/rate-limit";
import { triggerGlobalRelogin } from "@/lib/force-relogin";
import type { ActionFormResult } from "@/components/ActionForm";

/**
 * Reconnexion forcée globale (voir `src/lib/force-relogin.ts`) — action très
 * peu fréquente et à fort impact (déconnecte tout le monde + notif Discord
 * publique), donc rate limit nettement plus strict que la limite par défaut
 * (10/60s) : la confirmation dans `ForceReloginCard` protège déjà des clics
 * accidentels, cette limite protège d'un spam volontaire du bouton.
 */
export async function forceReloginAction(): Promise<ActionFormResult> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: "unauthorized" };
  if (!checkRateLimit(user.id, "forceRelogin", { limit: 1, windowMs: 10 * 60_000 })) {
    return { ok: false, error: RATE_LIMIT_ERROR_KEY };
  }

  await triggerGlobalRelogin();
  revalidatePath("/admin");
  return { ok: true };
}
