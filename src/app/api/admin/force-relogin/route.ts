import { NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { triggerGlobalRelogin } from "@/lib/force-relogin";
import { logger } from "@/lib/logger";
import { recordSensitiveOperation } from "@/lib/sensitive-operation-log";

/**
 * Déclenchement manuel/scripté de la reconnexion forcée globale (voir
 * `src/lib/force-relogin.ts`), protégé par un secret DÉDIÉ, `FORCE_RELOGIN_SECRET`
 * (audit du 23/11/2026, constat OWASP A01 : avec `CRON_SECRET`, partagé avec tous les
 * crons, la fuite d'un seul de ces jobs permettait de déconnecter tout le monde).
 * `CRON_SECRET` n'ouvre PLUS cette route. Variable absente → 503 (route désactivée,
 * échec fermé) ; en-tête absent ou faux → 401. Ce n'est PAS la voie du bouton
 * `ForceReloginCard` sur `/admin?tab=reglages` : le bouton appelle directement
 * `forceReloginAction` (server action, côté serveur, sans secret exposé au navigateur).
 * Cette route sert à un déclenchement manuel via `curl`/script, sans passer par l'UI.
 */
export async function POST(request: Request) {
  const access = checkCronAuth(process.env.FORCE_RELOGIN_SECRET, request.headers.get("authorization"));
  if (!access.ok) {
    if (access.status === 503) {
      logger.error("admin:force-relogin", "FORCE_RELOGIN_SECRET non configurée — route désactivée.");
      return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }
    logger.warn("admin:force-relogin", "Authorization manquante/invalide — 401.");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Journal des opérations sensibles (cahier §19.1) : acteur inconnu (secret dédié, pas de session), cible « route ».
  let result;
  try {
    result = await triggerGlobalRelogin();
  } catch (error) {
    logger.error("admin:force-relogin", error);
    await recordSensitiveOperation({ actorId: null, action: "auth.force_relogin", target: "route", outcome: "server_error" });
    // Détail loggé côté serveur (logger.error ci-dessus), jamais renvoyé au client.
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  await recordSensitiveOperation({ actorId: null, action: "auth.force_relogin", target: "route", outcome: "ok" });
  return NextResponse.json(result);
}
