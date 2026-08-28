/**
 * Backfill isCoop depuis Steam Store API — extrait de `npm run build`
 * (PR "Optimisation build"). Root cause du build à 14 min en prod : Steam
 * Store API s'est révélée lente/rate-limitée depuis l'IP de build Vercel
 * — bien au-delà des ~75s estimés en PR 32.6 pour ~48 jeux. Un backfill
 * réseau ne devrait jamais faire partie du chemin critique d'un
 * déploiement : déclenché à la place par `POST /api/backfill/steam-store`,
 * protégé par `CRON_SECRET`, appelé par un cron externe (voir README).
 *
 * Contrairement à `prisma/backfill-steam-coop.mjs` (script Node/ESM
 * autonome, conservé pour un lancement local via `npm run
 * backfill-steam-coop`, pas d'accès aux alias `@/...`), ce module tourne
 * dans le runtime Next.js et réutilise directement `fetchSteamStoreDetails`
 * (`src/lib/steam-store.ts`) — aucune duplication de la logique Steam
 * Store ici, seule la boucle "parcourir les jeux éligibles" est nouvelle.
 *
 * Portée inchangée depuis PR 32.6 : `source = STEAM` et `playInfoManual =
 * false`. `minPlayers`/`maxPlayers` ne sont toujours pas touchés (Steam
 * Store n'expose que des tags booléens, pas de chiffres — même limite
 * assumée qu'en PR 32.6).
 *
 * Ordre de traitement mélangé (`shuffle`) et arrêt anticipé au-delà de
 * `TIME_BUDGET_MS` : c'est ce qui garantit qu'un appel qui n'a pas le
 * temps de tout traiter (le cas le plus probable pour Steam Store, plus
 * lente que IGDB) finit par couvrir toute la liste en se répétant (cron
 * quotidien ou relance manuelle), sans marqueur de progression persisté
 * (pas de nouvelle migration pour ça) et sans jamais rester bloqué sur
 * les mêmes premiers jeux à chaque appel.
 */

import { prisma } from "@/lib/prisma";
import { fetchSteamStoreDetails, SteamStoreHttpError } from "@/lib/steam-store";
import { shuffle } from "@/lib/shuffle";

const REQUEST_DELAY_MS = 1500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Marge sous la limite d'exécution serverless (`maxDuration = 60` sur la
 * route, plafond du plan Vercel Hobby). Avec un délai de 1,5s/requête,
 * une bibliothèque de plus d'une trentaine de jeux ne rentre
 * structurellement pas dans une seule invocation — c'est attendu et géré
 * par l'ordre mélangé + les appels répétés (cron quotidien), pas un bug.
 */
const TIME_BUDGET_MS = 50_000;

export interface SteamCoopBackfillSummary {
  eligible: number;
  processed: number;
  updated: number;
  unchanged: number;
  noData: number;
  failed: number;
  stoppedEarly: boolean;
  rateLimited: boolean;
}

export async function runSteamCoopBackfill(): Promise<SteamCoopBackfillSummary> {
  const startedAt = Date.now();

  const games = shuffle(
    await prisma.game.findMany({
      where: { source: "STEAM", playInfoManual: false, steamAppId: { not: null } },
      select: { id: true, name: true, steamAppId: true, isCoop: true },
    })
  );

  if (games.length === 0) {
    console.log("[steam-store] Aucun jeu Steam éligible.");
    return {
      eligible: 0,
      processed: 0,
      updated: 0,
      unchanged: 0,
      noData: 0,
      failed: 0,
      stoppedEarly: false,
      rateLimited: false,
    };
  }

  let updated = 0;
  let unchanged = 0;
  let noData = 0;
  let failed = 0;
  let processed = 0;
  let stoppedEarly = false;
  let rateLimited = false;

  for (const game of games) {
    if (rateLimited) break;

    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      stoppedEarly = true;
      console.warn(
        `[steam-store] Arrêt anticipé après ${((Date.now() - startedAt) / 1000).toFixed(1)}s — ${processed}/${games.length} jeu(x) traité(s) dans cet appel, le reste sera couvert par un prochain appel (idempotent).`
      );
      break;
    }

    processed += 1;
    console.log(`[steam-store] Processing ${processed}/${games.length}: ${game.name}...`);

    try {
      // `steamAppId` non-null garanti par le `where` ci-dessus.
      const details = await fetchSteamStoreDetails(game.steamAppId!);

      if (!details) {
        noData += 1;
        console.log(`[steam-store] ${game.name} → pas de fiche Steam Store exploitable.`);
      } else {
        const categoryNames = details.categories.map((c) => c.description).join(", ");
        console.log(
          `[steam-store] ${game.name} → categories: [${categoryNames}] → isCoop=${details.isCoop}`
        );

        if (details.isCoop !== game.isCoop) {
          await prisma.game.update({
            where: { id: game.id },
            data: { isCoop: details.isCoop },
          });
          updated += 1;
        } else {
          unchanged += 1;
        }
      }
    } catch (error) {
      if (error instanceof SteamStoreHttpError && error.status === 429) {
        rateLimited = true;
        console.warn(
          `[steam-store] Rate limit Steam Store atteint après ${processed}/${games.length} jeu(x) traité(s) — arrêt, le reste sera couvert par un prochain appel.`
        );
        break;
      }
      failed += 1;
      console.error(
        `[steam-store] Échec pour ${game.name} (appid=${game.steamAppId})`,
        error
      );
    }

    await sleep(REQUEST_DELAY_MS);
  }

  const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[steam-store] Terminé en ${elapsedSeconds}s — ${updated} mis à jour, ${unchanged} déjà corrects, ${noData} sans donnée exploitable, ${failed} échec(s) sur ${processed}/${games.length} jeu(x) traité(s)${stoppedEarly ? " (arrêt anticipé, fenêtre de temps)" : ""}${rateLimited ? " (arrêt anticipé, rate limit)" : ""}.`
  );

  return {
    eligible: games.length,
    processed,
    updated,
    unchanged,
    noData,
    failed,
    stoppedEarly,
    rateLimited,
  };
}
