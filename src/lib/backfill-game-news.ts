/**
 * Backfill des news Steam pour la card "Actu gaming" (Sprint 3) — même
 * philosophie que `runSteamCoopBackfill` (jamais dans le chemin critique
 * d'un déploiement, jamais appelé à un chargement de page) : déclenché
 * par `POST /api/backfill/game-news`, protégé par `CRON_SECRET`, appelé
 * par le même cron externe quotidien que les autres backfills Steam (voir
 * README) — pas un cron dédié séparé, cf. énoncé "1 fois par jour max".
 *
 * Portée : les 10 jeux les plus joués du groupe (le plus de soirées
 * `DONE`, même `groupBy` que `getGroupStats` dans `src/lib/home.ts`)
 * parmi les jeux `source = STEAM` avec un `steamAppId` — les jeux
 * IGDB-only n'ont pas d'identifiant Steam, donc pas de news possibles
 * (skip silencieux, pas une erreur).
 *
 * Idempotent : `GameNews.@@unique([steamAppId, title])` fait qu'un même
 * article rejoué plusieurs fois ne crée jamais de doublon (`skipDuplicates`
 * sur `createMany`) — un article déjà en cache n'est jamais retouché,
 * `fetchedAt` ne reflète que la dernière fois où l'API a été interrogée,
 * pas la dernière fois où CET article précis a été vu.
 *
 * Résilience réseau (spec "si l'API est down → afficher les actus en
 * cache, pas d'erreur") : chaque jeu est traité indépendamment, une
 * erreur sur l'un n'empêche jamais les autres, et les lignes déjà en
 * cache restent inchangées si l'API échoue pour ce jeu précis.
 */

import { prisma } from "@/lib/prisma";
import { fetchGameNews } from "@/lib/steam-news";
import { logger } from "@/lib/logger";

const TOP_GAMES_COUNT = 10;
const REQUEST_DELAY_MS = 500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface GameNewsBackfillSummary {
  eligibleGames: number;
  processed: number;
  articlesUpserted: number;
  failed: number;
}

export async function runGameNewsBackfill(): Promise<GameNewsBackfillSummary> {
  const gameGroups = await prisma.session.groupBy({
    by: ["decidedGameId"],
    where: { status: "DONE", decidedGameId: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { decidedGameId: "desc" } },
    take: TOP_GAMES_COUNT,
  });

  const gameIds = gameGroups
    .map((g) => g.decidedGameId)
    .filter((id): id is string => id !== null);

  const games = await prisma.game.findMany({
    where: { id: { in: gameIds }, steamAppId: { not: null } },
    select: { id: true, name: true, steamAppId: true },
  });

  if (games.length === 0) {
    logger.info("game-news", "Aucun jeu Steam éligible parmi les plus joués.");
    return { eligibleGames: 0, processed: 0, articlesUpserted: 0, failed: 0 };
  }

  let processed = 0;
  let articlesUpserted = 0;
  let failed = 0;

  for (const game of games) {
    processed += 1;
    try {
      // `steamAppId` non-null garanti par le `where` ci-dessus.
      const items = await fetchGameNews(game.steamAppId!);
      if (items.length > 0) {
        const result = await prisma.gameNews.createMany({
          data: items.map((item) => ({
            gameId: game.id,
            steamAppId: game.steamAppId!,
            title: item.title,
            url: item.url,
            feedLabel: item.feedLabel,
            publishedAt: item.publishedAt,
          })),
          skipDuplicates: true,
        });
        articlesUpserted += result.count;
      }
    } catch (error) {
      failed += 1;
      logger.error("game-news", error, { gameId: game.id, gameName: game.name });
    }

    await sleep(REQUEST_DELAY_MS);
  }

  logger.info(
    "game-news",
    `Terminé — ${articlesUpserted} article(s) ajouté(s), ${failed} échec(s) sur ${processed}/${games.length} jeu(x).`
  );

  return { eligibleGames: games.length, processed, articlesUpserted, failed };
}
