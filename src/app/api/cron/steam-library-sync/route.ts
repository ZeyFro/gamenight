import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { refreshSteamActivity, type SteamActivityCategory } from "@/lib/steam";
import { logger } from "@/lib/logger";
import { verifyCronRequest } from "@/lib/cron-auth";
import { processInBatches } from "@/lib/cron-batch";

/**
 * Fix "cron Steam surdimensionné" (activité Steam absente chez les autres
 * potes malgré un cron actif) — cette route appelait `importSteamLibrary`
 * pour CHAQUE utilisateur lié, séquentiellement : upsert de chaque jeu en
 * base, badges, wishlist, à chaque passage de 2 min, rien que pour
 * rafraîchir un libellé d'activité. Un seul compte avec une grosse
 * bibliothèque ("Collectionneur, 100+ jeux") pouvait à lui seul consommer
 * tout le budget de temps de la route et priver tous les comptes suivants
 * de `prisma.user.findMany` (ordre non garanti) de toute mise à jour, à
 * chaque exécution, de façon déterministe.
 *
 * Cette route ne fait plus QUE l'activité (`refreshSteamActivity` — aucun
 * upsert `Game`/`UserGame`, aucun badge, aucune vérification wishlist, une
 * seule écriture par compte). L'import complet de bibliothèque est déplacé
 * vers `steam-library-full-sync` (cron séparé, cadence bien plus basse, un
 * compte à la fois en rotation).
 *
 * Concurrence bornée à `BATCH_SIZE` comptes simultanés via
 * `processInBatches` (jamais un `Promise.allSettled` non borné) + timeout
 * individuel par appel Steam (`STEAM_ACTIVITY_CALL_TIMEOUT_MS`, dans
 * `refreshSteamActivity`) : un compte qui bloque ne peut jamais affecter,
 * ralentir ou faire échouer les autres.
 *
 * `TIME_BUDGET_MS` : filet de sécurité supplémentaire (au-delà du timeout
 * par appel) qui arrête de démarrer de nouveaux lots au-delà du budget,
 * pour ne jamais risquer de dépasser le timeout 30s du déclencheur externe
 * (cron-job.org) ni `maxDuration` ci-dessous.
 *
 * Pire cas calculé (5 comptes, lots de 3) : 2 lots successifs (3 puis 2) ×
 * jusqu'à 2 appels Steam séquentiels (précis + repli) ×
 * `STEAM_ACTIVITY_CALL_TIMEOUT_MS` (6s) = 24s, sous les 30s du
 * déclencheur externe. `maxDuration` fixé à 45 (marge au-delà du pire cas
 * calculé pour absorber cold start + latence Prisma, toujours sous le
 * plafond dur de 60s du plan Vercel Hobby).
 */
export const maxDuration = 45;

const BATCH_SIZE = 3;
const TIME_BUDGET_MS = 25_000;

export async function GET(request: Request) {
  const auth = verifyCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 503 ? "not_configured" : "unauthorized" },
      { status: auth.status }
    );
  }

  const startedAt = Date.now();

  const users = await prisma.user.findMany({
    where: { steamId64: { not: null } },
    select: { id: true, steamId64: true },
    // Rotation : si `TIME_BUDGET_MS` est atteint avant la fin de la liste, ce
    // sont les comptes vérifiés le moins récemment (ou jamais) qui passent
    // en premier au tour suivant. Sans tri, les mêmes comptes en queue de
    // liste n'étaient jamais rafraîchis (famine déterministe).
    orderBy: { steamActivityCheckedAt: { sort: "asc", nulls: "first" } },
  });

  const { results, processedCount } = await processInBatches(
    users,
    BATCH_SIZE,
    (user) => refreshSteamActivity(user.id, user.steamId64!),
    { shouldContinue: () => Date.now() - startedAt < TIME_BUDGET_MS }
  );

  // Résumé PII-free (jamais de Steam ID / nom réel dans les logs) — compteurs
  // seulement, un par catégorie possible + erreurs non catégorisées (rejet
  // du worker lui-même, ne devrait jamais arriver puisque `refreshSteamActivity`
  // catch déjà tout en interne, mais couvert par défense en profondeur).
  const summary: Record<SteamActivityCategory | "rejected", number> = {
    precise: 0,
    approximate: 0,
    none: 0,
    private: 0,
    error: 0,
    rejected: 0,
  };

  for (const result of results) {
    if (result.status === "fulfilled") {
      summary[result.value.category] += 1;
    } else {
      summary.rejected += 1;
      logger.error("cron:steam-library-sync", result.reason);
    }
  }

  logger.info(
    "cron:steam-library-sync",
    `${processedCount}/${users.length} compte(s) traité(s) — ${JSON.stringify(summary)}`
  );

  return NextResponse.json({
    total: users.length,
    processed: processedCount,
    summary,
  });
}
