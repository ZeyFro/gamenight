import { NextResponse } from "next/server";
import { after } from "next/server";
import { runSeedReconciliation } from "@/lib/seed-reconciliation";
import { logger } from "@/lib/logger";
import { verifyCronRequest } from "@/lib/cron-auth";

/**
 * Hobby + Fluid compute : durée par défaut ET maximale de 300 s. `after()`
 * vit au plus `maxDuration` de la route ; `runSeedReconciliation` s'arrête
 * volontairement avant (budget 240 s, entre deux tâches).
 */
export const maxDuration = 300;

/**
 * Regroupe les 11 anciens scripts `npm run build` (seeds de référentiel +
 * backfills de réconciliation, `src/lib/seed-*.ts`/`backfill-*.ts`).
 *
 * cron-job.org coupe à 30 s alors que le traitement peut les dépasser
 * (boucles N+1 vers Neon qui croissent avec les données) : même contrat
 * qu'`/api/backfill/igdb-coop` — réponse `202` immédiate, traitement dans
 * `after()`. Le résultat réel n'est donc PLUS dans la réponse : il est dans
 * les logs Vercel (`seed-reconcile : début` / `tâche X début|fin` / `fin
 * stopReason=completed|time_budget|error`). Un `début` sans `fin` = coupure
 * par la plateforme.
 *
 * Best-effort strict : chaque tâche a son propre try/catch
 * (`runSeedReconciliation`), un échec n'empêche jamais les autres.
 * Pas de verrou : toutes les tâches sont idempotentes (uniques `XpEvent`/
 * `UserBadge`/`Badge`/`Tag`…) ; deux passages simultanés ne créent pas de
 * doublon sauf `SuperlativeCategory`/`MessageTemplate` au tout premier seed.
 *
 * GET et POST équivalents (cron-job.org envoie un GET par défaut, `curl -X
 * POST` pour un lancement manuel), `Authorization: Bearer <CRON_SECRET>`.
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
    runSeedReconciliation().catch((error) => {
      logger.error("seed-reconcile", error);
    });
  });

  return NextResponse.json(
    { status: "accepted", message: "Réconciliation des seeds lancée en arrière-plan." },
    { status: 202 }
  );
}

export const GET = handle;
export const POST = handle;
