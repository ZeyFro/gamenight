import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { verifyCronRequest } from "@/lib/cron-auth";
import { runRetentionCleanup } from "@/lib/retention-runner";

/**
 * Chantier nettoyage réel du stockage (V2) — route cron dédiée à la
 * politique de rétention (`src/lib/retention.ts`/`retention-runner.ts`) :
 * purge réelle des messages de chat d'événements terminés/annulés depuis
 * plus de 7 jours, programmation du nettoyage Discord définitif (fil +
 * annonce) des événements éligibles, purge des notifications LUES d'une
 * saison désormais close, purge des livraisons techniques terminales
 * retry-safe.
 *
 * DEUX VERROUS INDÉPENDANTS, dans cet ordre :
 *   1. `RETENTION_CLEANUP_ENABLED=true` (exactement cette valeur) — sans
 *      elle, cette route ne lit NI n'écrit RIEN au-delà de
 *      l'authentification, répond juste `{enabled:false}`. STRICTEMENT
 *      DÉSACTIVÉE PAR DÉFAUT.
 *   2. `RETENTION_CLEANUP_MODE` — `"dry_run"` (défaut, y compris quand le
 *      verrou 1 est activé) ou `"execute"` (exactement cette valeur, seule
 *      façon d'obtenir une mutation réelle/un appel Discord programmé).
 *      Activer le cron (1) sans jamais positionner ce second verrou sur
 *      `"execute"` permet d'observer indéfiniment le rapport dry-run en
 *      production SANS AUCUN RISQUE — c'est le chemin d'activation
 *      recommandé (voir le README, section "Activation du nettoyage").
 *
 * Authentification identique aux autres routes cron de ce dépôt
 * (`verifyCronRequest`). Aucun cron externe n'est configuré par cette PR,
 * aucune variable n'est définie sur Vercel — voir le README pour la
 * procédure de configuration (non exécutée par cette PR).
 *
 * Ne promet jamais une baisse immédiate de l'espace disque alloué :
 * supprimer des lignes libère de l'espace LOGIQUE côté Postgres (réutilisable
 * par de futures écritures), pas nécessairement l'espace PHYSIQUE alloué au
 * disque (`VACUUM`/`VACUUM FULL`, jamais déclenché automatiquement par cette
 * route — une opération de maintenance lourde, hors de portée d'un cron
 * applicatif, à la charge de l'opérateur Neon s'il le juge utile).
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  logger.info("cron:retention-cleanup", "Handler appelé.");

  const auth = verifyCronRequest(request);
  if (!auth.ok) {
    if (auth.status === 503) {
      logger.error("cron:retention-cleanup", "CRON_SECRET non configurée — route désactivée.");
    }
    return NextResponse.json(
      { error: auth.status === 503 ? "not_configured" : "unauthorized" },
      { status: auth.status }
    );
  }

  const enabled = process.env.RETENTION_CLEANUP_ENABLED === "true";
  if (!enabled) {
    return NextResponse.json({ enabled: false, dryRun: true, report: null });
  }

  const dryRun = process.env.RETENTION_CLEANUP_MODE !== "execute";
  const report = await runRetentionCleanup({ dryRun });

  logger.info("cron:retention-cleanup", "Passage terminé.", {
    dryRun,
    stoppedReason: report.stoppedReason,
    durationMs: report.durationMs,
    errorCount: report.errors.length,
  });

  return NextResponse.json({ enabled: true, dryRun, report });
}
