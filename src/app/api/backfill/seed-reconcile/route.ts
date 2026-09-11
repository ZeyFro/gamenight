import { NextResponse } from "next/server";
import { runSeedReconciliation } from "@/lib/seed-reconciliation";
import { verifyCronRequest } from "@/lib/cron-auth";

/**
 * PR "build ne fait plus que compiler" — regroupe les 11 anciens scripts
 * `npm run build` (seeds de référentiel + backfills de réconciliation,
 * désormais `src/lib/seed-*.ts`/`backfill-*.ts`), extraits du build pour
 * que celui-ci ne fasse plus que `prisma migrate deploy && next build`
 * (aucune écriture de données métier à chaque déploiement).
 *
 * Contrairement à `/api/backfill/igdb-coop`/`steam-store` (qui appellent
 * des API externes lentes, d'où leur traitement en arrière-plan via
 * `after()` + réponse `202` immédiate) : les 11 tâches ici sont 100%
 * lecture/écriture base, aucun appel réseau — largement sous la seconde
 * pour la taille de ce groupe. Traitement SYNCHRONE à dessein : la
 * réponse contient le résultat réel par tâche, plus utile pour un `curl`
 * de vérification qu'un `202` suivi d'un coup d'œil aux logs Vercel.
 *
 * Best-effort strict : `runSeedReconciliation` encapsule chaque tâche
 * dans son propre try/catch (voir `src/lib/seed-reconciliation.ts`) — un
 * échec d'une tâche n'empêche jamais les autres, et ne fait jamais
 * planter cette route (toujours 200, `results` indique "error" pour la
 * tâche concernée).
 *
 * Déclenchement : cron externe quotidien (cron-job.org, voir README) +
 * curl manuel pour un re-seed à la demande — les deux réutilisent le même
 * `CRON_SECRET` que `/api/cron/*`/`/api/backfill/*`.
 */
export async function POST(request: Request) {
  const auth = verifyCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 503 ? "not_configured" : "unauthorized" },
      { status: auth.status }
    );
  }

  const results = await runSeedReconciliation();
  return NextResponse.json({ ok: true, results });
}
