import { NextResponse } from "next/server";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { importSteamLibrary } from "@/lib/steam";
import { logger } from "@/lib/logger";
import { verifyCronRequest } from "@/lib/cron-auth";
import { wallClockNow } from "@/lib/wallclock";

/**
 * Budget interne de l'import (`maxDuration` 300 s, Hobby + Fluid compute) :
 * au-delà, `importSteamLibrary` s'arrête (`partial`, sans `steamLastSyncAt`).
 */
const FULL_SYNC_TIME_BUDGET_MS = 240_000;

/**
 * Fix "cron Steam surdimensionné" — import complet de bibliothèque
 * (upserts `Game`/`UserGame`, badges, wishlist via `importSteamLibrary`,
 * strictement inchangée) déplacé ici, à une cadence bien plus basse que
 * l'ancien cron toutes les 2 min (recommandé : toutes les ~2h). Le
 * rafraîchissement fréquent de l'activité affichée se fait désormais
 * ailleurs, via `steam-library-sync` (`refreshSteamActivity`, léger, aucun
 * upsert).
 *
 * Rotation round-robin : UN SEUL compte traité par passage
 * (`steamFullSyncAttemptedAt` ASC, `nulls: "first"` pour prioriser les
 * comptes jamais encore traités), pour ne jamais risquer d'agréger le
 * temps de plusieurs bibliothèques volumineuses dans une seule invocation.
 * `steamFullSyncAttemptedAt` est posé ICI (pas dans `importSteamLibrary`,
 * qui reste décorrélée de toute notion de rotation cron) INCONDITIONNELLEMENT
 * avant la tentative — un compte qui échoue systématiquement (bibliothèque
 * trop volumineuse, panne persistante) avance quand même en fin de file à
 * chaque tentative plutôt que de monopoliser indéfiniment la première
 * place.
 *
 * `steamLastSyncAt` (posée par `importSteamLibrary` elle-même, seulement
 * après succès complet — upserts + badges + wishlist) n'est délibérément
 * PAS utilisée pour la rotation : elle ne doit refléter qu'un succès réel,
 * jamais une tentative, donc un compte en échec répété resterait
 * indéfiniment "le plus ancien" si on s'y fiait pour l'ordre — d'où le
 * champ dédié `steamFullSyncAttemptedAt`.
 *
 * cron-job.org coupe à 30 s : sélection du compte et pose de
 * `steamFullSyncAttemptedAt` restent synchrones (rapides), puis l'import
 * tourne dans `after()` et la route répond `202` (même contrat
 * qu'`/api/backfill/igdb-coop`). Résultat dans les logs Vercel
 * (`cron:steam-library-full-sync` : `début` / `fin stopReason=completed|
 * time_budget|error jeux=n/total durée=ms`) ; un `début` sans `fin` =
 * coupure plateforme. Pas de verrou : l'import est idempotent (uniques
 * `Game.steamAppId`, `UserGame[userId,gameId]`, `UserBadge`).
 */
export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = verifyCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 503 ? "not_configured" : "unauthorized" },
      { status: auth.status }
    );
  }

  const nextUser = await prisma.user.findFirst({
    where: { steamId64: { not: null } },
    orderBy: [{ steamFullSyncAttemptedAt: { sort: "asc", nulls: "first" } }],
    select: { id: true, steamId64: true },
  });

  if (!nextUser) {
    return NextResponse.json({ attempted: false });
  }

  // Posé inconditionnellement avant la tentative — voir docstring ci-dessus
  // (jamais `steamLastSyncAt`, réservée au succès réel).
  await prisma.user.update({
    where: { id: nextUser.id },
    data: { steamFullSyncAttemptedAt: wallClockNow() },
  });

  const userId = nextUser.id;
  const steamId64 = nextUser.steamId64!;
  after(async () => {
    const startedAt = Date.now();
    logger.info("cron:steam-library-full-sync", `début userId=${userId}`);
    try {
      const result = await importSteamLibrary(userId, steamId64, {
        deadlineMs: startedAt + FULL_SYNC_TIME_BUDGET_MS,
      });
      const durationMs = Date.now() - startedAt;
      if (result.status === "partial") {
        logger.warn(
          "cron:steam-library-full-sync",
          `fin stopReason=time_budget userId=${userId} jeux=${result.processed}/${result.total} durée=${durationMs} ms`
        );
      } else if (result.status === "imported") {
        logger.info(
          "cron:steam-library-full-sync",
          `fin stopReason=completed userId=${userId} jeux=${result.count}/${result.count} nouveaux=${result.newCount} durée=${durationMs} ms`
        );
      } else {
        logger.info(
          "cron:steam-library-full-sync",
          `fin stopReason=completed userId=${userId} profil privé durée=${durationMs} ms`
        );
      }
    } catch (error) {
      logger.error("cron:steam-library-full-sync", error, {
        userId,
        stopReason: "error",
        durationMs: Date.now() - startedAt,
      });
    }
  });

  return NextResponse.json({ attempted: true, status: "accepted" }, { status: 202 });
}
