import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { verifyCronRequest } from "@/lib/cron-auth";
import { NOT_CONFIGURED_RESOLVER, runExecutorBatch, type DeliveryResolver } from "@/lib/notification-executor";
import { sessionAnnounceResolver } from "@/lib/session-announce";
import { tournamentAnnounceResolver } from "@/lib/tournament-announce";
import { instantSessionInviteResolver } from "@/lib/instant-session-announce";
import { rouletteDmResolver } from "@/lib/roulette-dm";
import { communitySystemAnnounceResolver } from "@/lib/community-announce";

/**
 * Dispatche par catégorie d'événement — SESSION vers le résolveur du
 * chantier annonces bot (`session-announce.ts`), TOURNAMENT vers celui du
 * chantier annonces tournois (`tournament-announce.ts`), INSTANT_SESSION
 * (V2, "Jouer maintenant") vers celui des invitations rapides par MP
 * (`instant-session-announce.ts`), tout le reste vers
 * `NOT_CONFIGURED_RESOLVER`, qui refuse systématiquement. Brancher ces
 * résolveurs ici n'a par lui-même AUCUN effet tant que
 * `NOTIFICATION_EXECUTOR_ENABLED` et le flag catégorie correspondant
 * (`DISCORD_BOT_SESSION_ANNOUNCE_ENABLED`/`DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED`/
 * `DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED`) ne sont pas TOUS LES DEUX
 * activés (verrous indépendants PAR CATÉGORIE, voir `discord-bot-config.ts`)
 * — et tant qu'aucune livraison de cette catégorie n'existe.
 */
const DISPATCH_RESOLVER: DeliveryResolver = {
  async resolve(input) {
    if (input.event.category === "SESSION") return sessionAnnounceResolver.resolve(input);
    if (input.event.category === "TOURNAMENT") return tournamentAnnounceResolver.resolve(input);
    if (input.event.category === "INSTANT_SESSION") return instantSessionInviteResolver.resolve(input);
    if (input.event.category === "ROULETTE") return rouletteDmResolver.resolve(input);
    if (input.event.category === "REWARD") return communitySystemAnnounceResolver.resolve(input);
    return NOT_CONFIGURED_RESOLVER.resolve(input);
  },
  // MP des soirées (V2) — sans ce relais, la mention de secours d'un MP
  // fermé ne serait jamais mise en file (le hook vit sur le résolveur SESSION).
  async onTerminalDiscordFailure(input) {
    if (input.event.category === "SESSION") await sessionAnnounceResolver.onTerminalDiscordFailure?.(input);
    // MP des tournois (V2) — mention de secours dans le fil. La roulette n'a
    // pas de fil : un MP fermé y est seulement tracé (aucun hook).
    if (input.event.category === "TOURNAMENT") await tournamentAnnounceResolver.onTerminalDiscordFailure?.(input);
  },
};

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
