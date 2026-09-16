import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { verifyCronRequest } from "@/lib/cron-auth";
import { NOT_CONFIGURED_RESOLVER, runExecutorBatch } from "@/lib/notification-executor";

/**
 * Borne dure de durée d'exécution du plan Vercel Hobby (60s) — même
 * convention que les autres routes cron de ce dépôt (voir
 * `src/app/api/cron/reminders/route.ts`). `runExecutorBatch` s'arrête
 * elle-même bien avant (`DEFAULT_BATCH_BUDGET_MS`, 50s), cette valeur est
 * le filet de sécurité de la plateforme, pas le mécanisme d'arrêt normal.
 */
export const maxDuration = 60;

/**
 * Route cron dédiée à l'exécuteur de notifications (PR 3/N) — relie les
 * fondations de livraison (#95) au client Discord REST (#96). STRICTEMENT
 * DÉSACTIVÉE PAR DÉFAUT : sans `NOTIFICATION_EXECUTOR_ENABLED=true`, cette
 * route ne réclame AUCUNE livraison, ne consomme AUCUNE tentative et
 * n'effectue AUCUN appel Discord — elle répond juste `{enabled:false}`
 * après authentification. Même quand activée, AUCUN producteur métier réel
 * n'est branché dans cette PR : le résolveur utilisé
 * (`NOT_CONFIGURED_RESOLVER`) refuse systématiquement d'envoyer quoi que
 * ce soit (voir `src/lib/notification-executor.ts`) — activer cette
 * variable aujourd'hui ne fait donc rien de plus que déclencher le
 * balayage de récupération des réservations expirées, en pratique sans
 * effet tant qu'aucune livraison n'existe (rien ne les enqueue encore).
 *
 * Authentification identique aux autres routes cron de ce dépôt
 * (`verifyCronRequest` — `CRON_SECRET` absente → 503 route désactivée,
 * en-tête absent/incorrect → 401). Cette route ne fournit AUCUN moyen
 * d'envoyer un message arbitraire ou de choisir librement un
 * destinataire : elle ne fait que réclamer/traiter les livraisons déjà
 * persistées par un futur code métier, jamais un paramètre venant de la
 * requête.
 *
 * Ne modifie pas `/api/cron/close-sessions` ni aucune route existante.
 * Aucun cron externe n'est configuré par cette PR, aucune variable n'est
 * définie sur Vercel — voir le README pour la procédure d'activation
 * future (documentée, pas exécutée).
 */
export async function GET(request: Request) {
  logger.info("cron:notification-executor", "Handler appelé.");

  const auth = verifyCronRequest(request);
  if (!auth.ok) {
    if (auth.status === 503) {
      logger.error("cron:notification-executor", "CRON_SECRET non configurée — route désactivée.");
    }
    return NextResponse.json(
      { error: auth.status === 503 ? "not_configured" : "unauthorized" },
      { status: auth.status }
    );
  }

  const enabled = process.env.NOTIFICATION_EXECUTOR_ENABLED === "true";
  if (!enabled) {
    // Aucun claim, aucune consommation de tentative, aucun appel Discord —
    // on s'arrête ici, avant même `runExecutorBatch`.
    return NextResponse.json({ enabled: false, processed: 0 });
  }

  const owner = `cron:${randomUUID()}`;
  const summary = await runExecutorBatch({ resolver: NOT_CONFIGURED_RESOLVER, owner });

  logger.info("cron:notification-executor", "Batch terminé.", { ...summary });
  return NextResponse.json({ enabled: true, ...summary });
}
