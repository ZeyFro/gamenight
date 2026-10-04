import { NextResponse } from "next/server";
import { after } from "next/server";
import { runIgdbCoopBackfill } from "@/lib/backfill-igdb-coop";
import { logger } from "@/lib/logger";
import { verifyCronRequest } from "@/lib/cron-auth";

/**
 * `maxDuration` explicite de 300s, comme `seed-reconcile` et
 * `steam-library-full-sync` (défaut et maximum Vercel : 300s sur Hobby avec
 * Fluid compute, doc Vercel, « Duration limits »). Il était de 60s (budget
 * 50s, ~28 fiches par passage) : 134 jeux sans fiche demandaient 5 passages.
 * `runIgdbCoopBackfill` s'arrête volontairement avant cette échéance
 * (`IGDB_COOP_TIME_BUDGET_MS` = 240s, et chaque appel IGDB est borné à
 * `IGDB_CALL_TIMEOUT_MS`), donc cette route ne devrait jamais être coupée en
 * plein milieu d'une écriture. Le cron externe n'est pas modifié : la route
 * répond 202 immédiatement.
 */
export const maxDuration = 300;

/**
 * Backfill IGDB déclenché à la demande (extrait de `npm run build`, voir
 * `src/lib/backfill-igdb-coop.ts` pour le détail). Répond 202 immédiatement
 * et lance le backfill via `after()` (Next.js) : le traitement continue
 * après l'envoi de la réponse, sans faire attendre l'appelant (cron
 * externe ou `curl` manuel) — même mécanisme d'authentification que
 * `/api/cron/reminders` (`CRON_SECRET` optionnelle mais recommandée dès
 * que l'URL est publique).
 *
 * GET et POST font exactement la même chose : cron-job.org envoie un GET par
 * défaut, `curl -X POST` reste valable pour un lancement manuel. Dans les
 * deux cas : `Authorization: Bearer <CRON_SECRET>`.
 */
async function handle(request: Request) {
  const auth = verifyCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 503 ? "not_configured" : "unauthorized" },
      { status: auth.status }
    );
  }

  after(() => {
    runIgdbCoopBackfill().catch((error) => {
      logger.error("igdb-coop", error);
    });
  });

  return NextResponse.json(
    { status: "accepted", message: "Backfill IGDB Coop lancé en arrière-plan." },
    { status: 202 }
  );
}

export const GET = handle;
export const POST = handle;
