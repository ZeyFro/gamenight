/**
 * Backfill isCoop/maxPlayers depuis IGDB — extrait de `npm run build`
 * (PR "Optimisation build" : le build a fini par prendre 14 min en prod à
 * cause du backfill Steam Store, voir `backfill-steam-coop.ts` ; celui-ci
 * était déjà là mais posait la même question de principe — un backfill
 * réseau ne devrait jamais bloquer un déploiement). Déclenché à la place
 * par `POST /api/backfill/igdb-coop`, protégé par `CRON_SECRET`, appelé
 * par un cron externe (voir docs/CRONS.md).
 *
 * Contrairement à `prisma/backfill-coop.mjs` (script Node/ESM autonome,
 * conservé pour un lancement local via `npm run backfill-coop`, pas
 * d'accès aux alias `@/...`), ce module tourne dans le runtime Next.js et
 * réutilise directement `fetchIgdbGameDetails` (`src/lib/igdb.ts`) —
 * aucune duplication de la logique IGDB ici, seule la boucle
 * "parcourir les jeux éligibles" est nouvelle.
 *
 * Deux phases, partageant le même budget de temps :
 *   1. REMPLISSAGE — jeux avec un `igdbId` mais SANS cache
 *      (`igdbDetails` null) OU sans date de récupération
 *      (`igdbDetailsFetchedAt` null, cache incohérent : rafraîchi pour être
 *      daté) : `getGameDetails` récupère et persiste
 *      `igdbDetails`/`igdbDetailsFetchedAt` (+ isCoop/maxPlayers sauf
 *      `playInfoManual`). Avant ce correctif, seule la phase 2 existait :
 *      un jeu jamais visité sur sa fiche n'était JAMAIS rempli par le cron
 *      (exclu par `igdbDetails != null`), et la phase 2 n'écrivait jamais
 *      `igdbDetailsFetchedAt`.
 *   2. RESYNCHRONISATION (portée inchangée depuis PR 32, 2.5/4, Bug 2A) :
 *      jeux avec un cache IGDB déjà en base ET jamais confirmés
 *      manuellement (`playInfoManual: false`).
 *
 * Ordre de traitement mélangé (`shuffle`, voir `src/lib/shuffle.ts`) et
 * arrêt anticipé au-delà de `TIME_BUDGET_MS` : sans marqueur de
 * progression persisté (pas de nouvelle migration pour ça), c'est ce qui
 * garantit qu'un appel qui n'a pas le temps de tout traiter finit par
 * couvrir toute la liste en se répétant (cron quotidien ou relance
 * manuelle), au lieu de retraiter indéfiniment les mêmes premiers jeux.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fetchIgdbGameDetails } from "@/lib/igdb";
import { getGameDetails } from "@/lib/game-details";
import { shuffle } from "@/lib/shuffle";
import { logger } from "@/lib/logger";

const REQUEST_DELAY_MS = 250;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Marge sous la limite d'exécution serverless (`maxDuration = 300` sur la
 * route, comme `seed-reconcile` et `steam-library-full-sync` : budget 240 s)
 * : on arrête volontairement la boucle avant l'échéance plutôt que de
 * risquer une coupure brutale par la plateforme en plein appel
 * réseau/écriture. Pire cas au-delà du budget : un seul appel IGDB en cours
 * (au plus `IGDB_CALL_TIMEOUT_MS`), donc bien sous les 300 s.
 *
 * Pourquoi 240 s et plus 50 s : chaque fiche coûte ≈ 1,5-2 s (IGDB +
 * traduction DeepL + pause anti-limite de débit), soit ~28 fiches par
 * passage de 50 s — 134 jeux sans fiche demandaient 5 passages. Avec 240 s,
 * un seul passage en remplit ~130.
 */
export const IGDB_COOP_TIME_BUDGET_MS = 240_000;

/**
 * Délai maximum d'UN appel IGDB (token Twitch compris). Sans lui, une
 * requête qui ne répond jamais bloquait le passage jusqu'à la coupure de la
 * plateforme, sans que le budget de temps — vérifié seulement entre deux
 * jeux — puisse l'empêcher. Le jeu concerné est compté en échec et repris au
 * passage suivant (aucune marque « introuvable »).
 */
export const IGDB_CALL_TIMEOUT_MS = 15_000;

export interface IgdbCoopBackfillOptions {
  timeBudgetMs?: number;
  requestDelayMs?: number;
  callTimeoutMs?: number;
}

/** Couverture du cache IGDB, journalisée à chaque passage (suivi sans accès base). */
export interface IgdbCoverage {
  /** Jeux ayant un `igdbId`. */
  withIgdbId: number;
  /** … dont la fiche est en cache ET datée (`igdbDetailsFetchedAt`). */
  withDetails: number;
  /** … sans fiche, marqués introuvables sur IGDB (retentés après `IGDB_NOT_FOUND_RETRY_MS`). */
  notFound: number;
  /** … sans fiche et non marqués : ce que les prochains passages doivent encore remplir. */
  remaining: number;
  /** Fiches en cache SANS date de récupération : incohérence que la phase 1 répare. */
  cachedWithoutDate: number;
}

/**
 * Délai avant de retenter un jeu qu'IGDB ne connaît pas (`igdbNotFoundAt`
 * posé) : sans lui, chaque passage réinterrogeait les mêmes jeux
 * introuvables pour rien.
 */
export const IGDB_NOT_FOUND_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

/** Pourquoi le passage s'est arrêté (distingue « rien à faire » de « plus le temps »). */
export type IgdbCoopStopReason =
  | "no_credentials"
  | "no_eligible"
  | "time_budget"
  | "completed";

export interface IgdbCoopBackfillSummary {
  stopReason: IgdbCoopStopReason;
  /** Jeux introuvables sur IGDB (marqués `igdbNotFoundAt`), non comptés dans `failed`. */
  notFound: number;
  eligible: number;
  processed: number;
  updated: number;
  unchanged: number;
  failed: number;
  stoppedEarly: boolean;
  skippedNoCredentials: boolean;
  /** Jeux dont le cache IGDB (igdbDetails/igdbDetailsFetchedAt) a été rempli par la phase 1. */
  detailsFilled: number;
  /** Couverture après le passage ; `null` sans identifiants IGDB (rien n'a été lu). */
  coverage: IgdbCoverage | null;
}

async function loadCoverage(): Promise<IgdbCoverage> {
  const [withIgdbId, withDetails, notFound, cachedWithoutDate] = await Promise.all([
    prisma.game.count({ where: { igdbId: { not: null } } }),
    prisma.game.count({ where: { igdbId: { not: null }, igdbDetailsFetchedAt: { not: null } } }),
    prisma.game.count({
      where: { igdbId: { not: null }, igdbDetailsFetchedAt: null, igdbNotFoundAt: { not: null } },
    }),
    prisma.game.count({
      where: { igdbId: { not: null }, igdbDetails: { not: Prisma.DbNull }, igdbDetailsFetchedAt: null },
    }),
  ]);
  return {
    withIgdbId,
    withDetails,
    notFound,
    remaining: Math.max(0, withIgdbId - withDetails - notFound),
    cachedWithoutDate,
  };
}

async function reportCoverage(): Promise<IgdbCoverage> {
  const coverage = await loadCoverage();
  logger.info(
    "igdb-coop",
    `Couverture IGDB : ${coverage.withDetails}/${coverage.withIgdbId} fiche(s) datée(s), ${coverage.remaining} restante(s), ${coverage.notFound} introuvable(s), ${coverage.cachedWithoutDate} en cache sans date.`
  );
  return coverage;
}

export async function runIgdbCoopBackfill(
  options: IgdbCoopBackfillOptions = {}
): Promise<IgdbCoopBackfillSummary> {
  const timeBudgetMs = options.timeBudgetMs ?? IGDB_COOP_TIME_BUDGET_MS;
  const requestDelayMs = options.requestDelayMs ?? REQUEST_DELAY_MS;
  const callTimeoutMs = options.callTimeoutMs ?? IGDB_CALL_TIMEOUT_MS;
  const startedAt = Date.now();
  const hasCredentials = Boolean(
    process.env.IGDB_CLIENT_ID?.trim() && process.env.IGDB_CLIENT_SECRET?.trim()
  );
  if (!hasCredentials) {
    logger.warn("igdb-coop", "IGDB_CLIENT_ID/IGDB_CLIENT_SECRET non configurées — backfill sauté.");
    return {
      stopReason: "no_credentials",
      notFound: 0,
      eligible: 0,
      processed: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
      stoppedEarly: false,
      skippedNoCredentials: true,
      detailsFilled: 0,
      coverage: null,
    };
  }

  let detailsFilled = 0;
  let detailsFailed = 0;
  let detailsNotFound = 0;
  let detailsStoppedEarly = false;
  // Jeux dont la fiche vient d'être remplie : exclus de la phase 2 du même
  // passage (leur isCoop/maxPlayers viennent d'être synchronisés).
  const filledIds: string[] = [];
  const uncached = shuffle(
    await prisma.game.findMany({
      where: {
        igdbId: { not: null },
        // Sans fiche en cache, OU fiche en cache sans date de récupération
        // (incohérent : jamais corrigé par la phase 2, qui ne date rien).
        AND: [
          { OR: [{ igdbDetails: { equals: Prisma.DbNull } }, { igdbDetailsFetchedAt: null }] },
          {
            OR: [
              { igdbNotFoundAt: null },
              { igdbNotFoundAt: { lt: new Date(startedAt - IGDB_NOT_FOUND_RETRY_MS) } },
            ],
          },
        ],
      },
    })
  );
  for (const game of uncached) {
    if (Date.now() - startedAt > timeBudgetMs) {
      detailsStoppedEarly = true;
      logger.warn(
        "igdb-coop",
        `Budget de temps épuisé pendant le remplissage — ${detailsFilled + detailsFailed + detailsNotFound}/${uncached.length} jeu(x) sans cache traité(s), le reste au prochain appel.`
      );
      break;
    }
    logger.info("igdb-coop", `Remplissage fiche IGDB: ${game.name}...`);
    // `getGameDetails` journalise lui-même ses erreurs (logger.error) et les
    // renvoie dans `error` — comptées ici, jamais ignorées.
    // Fiche déjà en cache mais sans date : `forceRefresh` (sinon le cache
    // serait renvoyé tel quel, sans jamais être daté).
    const result = await getGameDetails(game, {
      forceRefresh: game.igdbDetails !== null,
      signal: AbortSignal.timeout(callTimeoutMs),
    });
    if (result.error === "not_found") detailsNotFound += 1;
    else if (result.error) detailsFailed += 1;
    else {
      detailsFilled += 1;
      filledIds.push(game.id);
    }
    await sleep(requestDelayMs);
  }
  if (uncached.length > 0) {
    logger.info(
      "igdb-coop",
      `Remplissage terminé — ${detailsFilled} fiche(s) remplie(s), ${detailsNotFound} introuvable(s) sur IGDB (retentés dans ${IGDB_NOT_FOUND_RETRY_MS / 86_400_000} j), ${detailsFailed} échec(s) sur ${uncached.length} jeu(x) sans cache.`
    );
  }

  const games = shuffle(
    await prisma.game.findMany({
      where: {
        igdbDetails: { not: Prisma.DbNull },
        playInfoManual: false,
        igdbId: { not: null },
        id: { notIn: filledIds },
        OR: [
          { igdbNotFoundAt: null },
          { igdbNotFoundAt: { lt: new Date(startedAt - IGDB_NOT_FOUND_RETRY_MS) } },
        ],
      },
      select: { id: true, name: true, igdbId: true, isCoop: true, maxPlayers: true },
    })
  );

  if (games.length === 0 || detailsStoppedEarly) {
    // Le message d'arrêt du budget a déjà été journalisé (warn) dans la
    // boucle de remplissage : ici seul « rien à resynchroniser » est loggé.
    if (!detailsStoppedEarly) {
      logger.info(
        "igdb-coop",
        "Aucun jeu éligible à la resynchronisation (cache IGDB + pas de correction manuelle, hors fiches remplies à l'instant)."
      );
    }
    return {
      stopReason: detailsStoppedEarly ? "time_budget" : "no_eligible",
      notFound: detailsNotFound,
      eligible: uncached.length,
      processed: detailsFilled + detailsFailed + detailsNotFound,
      updated: 0,
      unchanged: 0,
      failed: detailsFailed,
      stoppedEarly: detailsStoppedEarly,
      skippedNoCredentials: false,
      detailsFilled,
      coverage: await reportCoverage(),
    };
  }

  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  let notFound = 0;
  let processed = 0;
  let stoppedEarly = false;

  for (const game of games) {
    if (Date.now() - startedAt > timeBudgetMs) {
      stoppedEarly = true;
      logger.warn(
        "igdb-coop",
        `Budget de temps épuisé après ${((Date.now() - startedAt) / 1000).toFixed(1)}s — ${processed}/${games.length} jeu(x) traité(s) dans cet appel, le reste sera couvert par un prochain appel (idempotent).`
      );
      break;
    }

    processed += 1;
    logger.info("igdb-coop", `Processing ${processed}/${games.length}: ${game.name}...`);

    try {
      // `igdbId` non-null garanti par le `where` ci-dessus.
      const details = await fetchIgdbGameDetails(game.igdbId!, { signal: AbortSignal.timeout(callTimeoutMs) });
      if (!details) {
        // IGDB ne connaît plus ce jeu : on garde les valeurs actuelles (ne
        // surtout pas écraser isCoop par `false`) et on le marque.
        await prisma.game.update({
          where: { id: game.id },
          data: { igdbNotFoundAt: new Date() },
        });
        notFound += 1;
        await sleep(requestDelayMs);
        continue;
      }
      const isCoop = details.isCoop;
      const maxPlayers = game.maxPlayers ?? details.maxPlayersFromModes ?? null;

      if (isCoop !== game.isCoop || maxPlayers !== game.maxPlayers) {
        await prisma.game.update({ where: { id: game.id }, data: { isCoop, maxPlayers } });
        updated += 1;
      } else {
        unchanged += 1;
      }
    } catch (error) {
      failed += 1;
      logger.error("igdb-coop", error, { gameId: game.id, gameName: game.name, igdbId: game.igdbId });
    }

    await sleep(requestDelayMs);
  }

  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  logger.info(
    "igdb-coop",
    `Terminé en ${elapsedSeconds}s — ${updated}/${processed} mis à jour, ${unchanged} déjà corrects, ${notFound} introuvable(s) sur IGDB, ${failed} échec(s) sur ${processed}/${games.length} jeu(x) traité(s)${stoppedEarly ? " (budget de temps épuisé)" : ""}.`
  );

  return {
    stopReason: stoppedEarly ? "time_budget" : "completed",
    notFound: notFound + detailsNotFound,
    eligible: games.length + uncached.length,
    processed: processed + detailsFilled + detailsFailed + detailsNotFound,
    updated,
    unchanged,
    failed: failed + detailsFailed,
    stoppedEarly,
    skippedNoCredentials: false,
    detailsFilled,
    coverage: await reportCoverage(),
  };
}
