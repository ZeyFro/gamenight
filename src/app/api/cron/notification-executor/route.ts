import { randomUUID } from "crypto";
import { NextResponse, after } from "next/server";
import { logger } from "@/lib/logger";
import { verifyCronRequest } from "@/lib/cron-auth";
import { runExecutorBatch } from "@/lib/notification-executor";
import { DISPATCH_RESOLVER } from "@/lib/notification-dispatch";

/**
 * `maxDuration` EXPLICITE de 60s, volontairement plus bas que le défaut
 * Vercel (300s sur Hobby avec Fluid compute, qui est aussi le maximum) —
 * même convention que les routes cron courtes de ce dépôt (voir
 * `src/app/api/cron/reminders/route.ts`). `runExecutorBatch` s'arrête
 * elle-même bien avant (`DEFAULT_BATCH_BUDGET_MS`, 50s), cette valeur est
 * le filet de sécurité de la route, pas le mécanisme d'arrêt normal.
 */
export const maxDuration = 60;

/**
 * Route cron dédiée à l'exécuteur de notifications (PR 3/N) — relie les
 * fondations de livraison (#95) au client Discord REST (#96). STRICTEMENT
 * DÉSACTIVÉE PAR DÉFAUT : sans `NOTIFICATION_EXECUTOR_ENABLED=true`, cette
 * route ne réclame AUCUNE livraison, ne consomme AUCUNE tentative et
 * n'effectue AUCUN appel Discord — elle répond juste `{enabled:false}`
 * après authentification. Depuis le chantier annonces Discord bot
 * (session-announce.ts), un vrai producteur métier EST branché (`DISPATCH_RESOLVER`
 * ci-dessus, catégorie SESSION) — mais reste sans AUCUN effet tant que
 * `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED`/`DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED`
 * n'est pas ÉGALEMENT activé pour sa catégorie (verrous indépendants PAR
 * CATÉGORIE) et tant qu'aucune livraison de cette catégorie n'existe
 * (rien ne les enqueue tant que le flag catégorie reste désactivé). Toute
 * autre catégorie continue de retomber sur `NOT_CONFIGURED_RESOLVER`, qui
 * refuse systématiquement.
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
 * définie sur Vercel — voir docs/COMMUNITY_ROLLOUT.md pour la procédure d'activation
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

  // cron-job.org coupe à 30 s : le lot (budget 50 s) tourne dans `after()`, la
  // route répond 202. Résultat dans les logs (`début` sans `fin` = coupure plateforme).
  const owner = `cron:${randomUUID()}`;
  after(async () => {
    const startedAt = Date.now();
    logger.info("cron:notification-executor", "Batch début.", { owner });
    try {
      const summary = await runExecutorBatch({ resolver: DISPATCH_RESOLVER, owner });
      logger.info("cron:notification-executor", "Batch fin.", {
        ...summary,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      logger.error("cron:notification-executor", error, { owner, durationMs: Date.now() - startedAt });
    }
  });

  return NextResponse.json({ enabled: true, status: "accepted" }, { status: 202 });
}
