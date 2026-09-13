"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { checkRateLimit, RATE_LIMIT_ERROR_KEY } from "@/lib/rate-limit";
import { triggerGlobalRelogin } from "@/lib/force-relogin";
import { logger } from "@/lib/logger";
import type { ActionFormResult } from "@/components/ActionForm";

/**
 * Reconnexion forcée globale (voir `src/lib/force-relogin.ts`) — action très
 * peu fréquente et à fort impact (déconnecte tout le monde + notif Discord
 * publique), donc rate limit nettement plus strict que la limite par défaut
 * (10/60s) : la confirmation dans `ForceReloginCard` protège déjà des clics
 * accidentels, cette limite protège d'un spam volontaire du bouton.
 *
 * Bug remonté ("rien ne semble se passer" après le clic) : cette action est
 * invoquée via `ActionForm`, qui n'a pas de try/catch autour de l'appel —
 * une exception Prisma non catchée ici deviendrait un rejet de promesse
 * silencieux dans la transition React (aucun toast, aucun message). D'où
 * le try/catch explicite ci-dessous, qui renvoie un échec normal au lieu
 * de laisser fuiter l'exception. Pas de `redirect()` ici : `ActionForm`
 * n'est volontairement pas prévu pour des actions qui redirigent (voir son
 * commentaire) — l'éjection immédiate de l'admin qui clique est gérée
 * côté client par `ForceReloginCard` (`router.push` dans `onSuccess`),
 * indépendante de `revalidatePath` ci-dessous (qui ne sert qu'à rafraîchir
 * l'affichage "dernier déclenchement" pour les autres admins).
 */
export async function forceReloginAction(): Promise<ActionFormResult> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: "unauthorized" };
  if (!checkRateLimit(user.id, "forceRelogin", { limit: 1, windowMs: 10 * 60_000 })) {
    return { ok: false, error: RATE_LIMIT_ERROR_KEY };
  }

  try {
    await triggerGlobalRelogin();
  } catch (error) {
    logger.error("force-relogin", error, { userId: user.id });
    return { ok: false, error: "server_error" };
  }

  revalidatePath("/admin");
  return { ok: true };
}
