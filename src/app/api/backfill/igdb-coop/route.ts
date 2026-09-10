import { NextResponse } from "next/server";
import { after } from "next/server";
import { runIgdbCoopBackfill } from "@/lib/backfill-igdb-coop";
import { logger } from "@/lib/logger";
import { verifyCronRequest } from "@/lib/cron-auth";

/**
 * Plafond du plan Vercel Hobby (voir README, § "Rappels drôles avant
 * session" pour le précédent avec `/api/cron/reminders`) — inutile de
 * demander plus, ce serait ignoré/rejeté au déploiement de toute façon.
 * `runIgdbCoopBackfill` s'arrête volontairement avant cette échéance
 * (`TIME_BUDGET_MS`), donc cette route ne devrait jamais être coupée en
 * plein milieu d'une écriture.
 */
export const maxDuration = 60;

/**
 * Backfill IGDB déclenché à la demande (extrait de `npm run build`, voir
 * `src/lib/backfill-igdb-coop.ts` pour le détail). Répond 202 immédiatement
 * et lance le backfill via `after()` (Next.js) : le traitement continue
 * après l'envoi de la réponse, sans faire attendre l'appelant (cron
 * externe ou `curl` manuel) — même mécanisme d'authentification que
 * `/api/cron/reminders` (`CRON_SECRET` optionnelle mais recommandée dès
 * que l'URL est publique).
 */
export async function POST(request: Request) {
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
