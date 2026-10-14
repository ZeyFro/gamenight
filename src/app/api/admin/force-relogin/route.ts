import { NextResponse } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { triggerGlobalRelogin } from "@/lib/force-relogin";
import { logger } from "@/lib/logger";

/**
 * Déclenchement manuel/scripté de la reconnexion forcée globale (voir
 * `src/lib/force-relogin.ts`), protégé par `CRON_SECRET` — même convention
 * que les routes `/api/cron/*` du projet (secret partagé, pas de session
 * utilisateur requise). Ce n'est PAS la voie utilisée par le bouton
 * `ForceReloginCard` sur `/admin?tab=reglages` : le bouton appelle
 * directement `forceReloginAction` (server action, exécutée côté serveur —
 * pas de round-trip HTTP, donc pas besoin d'exposer `CRON_SECRET` au
 * navigateur). Cette route reste utile pour un déclenchement manuel via
 * `curl`/script sans passer par l'UI, exactement comme les crons.
 */
export async function POST(request: Request) {
  const access = verifyCronRequest(request);
  if (!access.ok) {
    if (access.status === 503) {
      logger.error("admin:force-relogin", "CRON_SECRET non configurée — route désactivée.");
      return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }
    logger.warn("admin:force-relogin", "Authorization manquante/invalide — 401.");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await triggerGlobalRelogin();
    return NextResponse.json(result);
  } catch (error) {
    logger.error("admin:force-relogin", error);
    // Détail loggé côté serveur (logger.error ci-dessus), jamais renvoyé au client.
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
