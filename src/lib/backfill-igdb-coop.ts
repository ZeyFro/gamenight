/**
 * Backfill isCoop/maxPlayers depuis IGDB — extrait de `npm run build`
 * (PR "Optimisation build" : le build a fini par prendre 14 min en prod à
 * cause du backfill Steam Store, voir `backfill-steam-coop.ts` ; celui-ci
 * était déjà là mais posait la même question de principe — un backfill
 * réseau ne devrait jamais bloquer un déploiement). Déclenché à la place
 * par `POST /api/backfill/igdb-coop`, protégé par `CRON_SECRET`, appelé
 * par un cron externe (voir README).
 *
 * Contrairement à `prisma/backfill-coop.mjs` (script Node/ESM autonome,
 * conservé pour un lancement local via `npm run backfill-coop`, pas
 * d'accès aux alias `@/...`), ce module tourne dans le runtime Next.js et
 * réutilise directement `fetchIgdbGameDetails` (`src/lib/igdb.ts`) —
 * aucune duplication de la logique IGDB ici, seule la boucle
 * "parcourir les jeux éligibles" est nouvelle.
 *
 * Portée inchangée depuis PR 32 (2.5/4, Bug 2A) : jeux avec un cache IGDB
 * déjà en base (`igdbDetails != null`, donc un `igdbId` connu) ET jamais
 * confirmés manuellement (`playInfoManual: false`).
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
import { shuffle } from "@/lib/shuffle";

const REQUEST_DELAY_MS = 250;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Marge sous la limite d'exécution serverless (`maxDuration = 60` sur la
 * route, plafond du plan Vercel Hobby) : on arrête volontairement la
 * boucle avant l'échéance plutôt que de risquer une coupure brutale par
 * la plateforme en plein appel réseau/écriture.
 */
const TIME_BUDGET_MS = 50_000;

export interface IgdbCoopBackfillSummary {
  eligible: number;
  processed: number;
  updated: number;
  unchanged: number;
  failed: number;
  stoppedEarly: boolean;
  skippedNoCredentials: boolean;
}

export async function runIgdbCoopBackfill(): Promise<IgdbCoopBackfillSummary> {
  const startedAt = Date.now();
  const hasCredentials = Boolean(
    process.env.IGDB_CLIENT_ID?.trim() && process.env.IGDB_CLIENT_SECRET?.trim()
  );
  if (!hasCredentials) {
    console.warn(
      "[igdb-coop] IGDB_CLIENT_ID/IGDB_CLIENT_SECRET non configurées — backfill sauté."
    );
    return {
      eligible: 0,
      processed: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
      stoppedEarly: false,
      skippedNoCredentials: true,
    };
  }

  const games = shuffle(
    await prisma.game.findMany({
      where: {
        igdbDetails: { not: Prisma.DbNull },
        playInfoManual: false,
        igdbId: { not: null },
      },
      select: { id: true, name: true, igdbId: true, isCoop: true, maxPlayers: true },
    })
  );

  if (games.length === 0) {
    console.log(
      "[igdb-coop] Aucun jeu éligible (cache IGDB + pas de correction manuelle)."
    );
    return {
      eligible: 0,
      processed: 0,
      updated: 0,
      unchanged: 0,
      failed: 0,
      stoppedEarly: false,
      skippedNoCredentials: false,
    };
  }

  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  let processed = 0;
  let stoppedEarly = false;

  for (const game of games) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      stoppedEarly = true;
      console.warn(
        `[igdb-coop] Arrêt anticipé après ${((Date.now() - startedAt) / 1000).toFixed(1)}s — ${processed}/${games.length} jeu(x) traité(s) dans cet appel, le reste sera couvert par un prochain appel (idempotent).`
      );
      break;
    }

    processed += 1;
    console.log(`[igdb-coop] Processing ${processed}/${games.length}: ${game.name}...`);

    try {
      // `igdbId` non-null garanti par le `where` ci-dessus.
      const details = await fetchIgdbGameDetails(game.igdbId!);
      const isCoop = details?.isCoop ?? false;
      const maxPlayers = game.maxPlayers ?? details?.maxPlayersFromModes ?? null;

      if (isCoop !== game.isCoop || maxPlayers !== game.maxPlayers) {
        await prisma.game.update({ where: { id: game.id }, data: { isCoop, maxPlayers } });
        updated += 1;
      } else {
        unchanged += 1;
      }
    } catch (error) {
      failed += 1;
      console.error(
        `[igdb-coop] Échec pour ${game.name} (igdbId=${game.igdbId})`,
        error
      );
    }

    await sleep(REQUEST_DELAY_MS);
  }

  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[igdb-coop] Terminé en ${elapsedSeconds}s — ${updated}/${processed} mis à jour, ${unchanged} déjà corrects, ${failed} échec(s) sur ${processed}/${games.length} jeu(x) traité(s)${stoppedEarly ? " (arrêt anticipé)" : ""}.`
  );

  return {
    eligible: games.length,
    processed,
    updated,
    unchanged,
    failed,
    stoppedEarly,
    skippedNoCredentials: false,
  };
}
