import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { verifyCronRequest } from "@/lib/cron-auth";
import { NOT_CONFIGURED_RESOLVER, runExecutorBatch, type DeliveryResolver } from "@/lib/notification-executor";
import { sessionAnnounceResolver } from "@/lib/session-announce";

/**
 * Dispatche par catégorie d'événement — SESSION vers le résolveur du
 * chantier annonces bot (`session-announce.ts`), tout le reste (dont
 * TOURNAMENT, explicitement différé) vers `NOT_CONFIGURED_RESOLVER`, qui
 * refuse systématiquement. Brancher `sessionAnnounceResolver` ici n'a par
 * lui-même AUCUN effet tant que `NOTIFICATION_EXECUTOR_ENABLED` et
 * `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED` ne sont pas TOUS LES DEUX
 * activés (deux verrous indépendants, voir `discord-bot-config.ts`) — et
 * tant qu'aucune livraison SESSION n'existe (rien ne les enqueue encore
 * dans cette PR).
 */
const DISPATCH_RESOLVER: DeliveryResolver = {
  async resolve(input) {
    if (input.event.category === "SESSION") return sessionAnnounceResolver.resolve(input);
    return NOT_CONFIGURED_RESOLVER.resolve(input);
  },
};

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
 * après authentification. Depuis le chantier annonces Discord bot
 * (session-announce.ts), un vrai producteur métier EST branché (`DISPATCH_RESOLVER`
 * ci-dessus, catégorie SESSION) — mais reste sans AUCUN effet tant que
 * `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED` n'est pas ÉGALEMENT activé (deux
 * verrous indépendants) et tant qu'aucune livraison SESSION n'existe
 * (rien ne les enqueue tant que ce même flag reste désactivé). Toute
 * autre catégorie (dont TOURNAMENT, différé) continue de retomber sur
 * `NOT_CONFIGURED_RESOLVER`, qui refuse systématiquement.
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
  const summary = await runExecutorBatch({ resolver: DISPATCH_RESOLVER, owner });

  logger.info("cron:notification-executor", "Batch terminé.", { ...summary });
  return NextResponse.json({ enabled: true, ...summary });
}
