import { NextResponse } from "next/server";
import { after } from "next/server";
import { runSteamCoopBackfill } from "@/lib/backfill-steam-coop";
import { logger } from "@/lib/logger";
import { verifyCronRequest } from "@/lib/cron-auth";

/**
 * Plafond du plan Vercel Hobby — voir la même note dans
 * `/api/backfill/igdb-coop/route.ts`. `runSteamCoopBackfill` s'arrête
 * volontairement avant cette échéance (`TIME_BUDGET_MS`).
 */
export const maxDuration = 60;

/**
 * Backfill Steam Store déclenché à la demande (extrait de `npm run
 * build` — root cause du build à 14 min en prod, voir
 * `src/lib/backfill-steam-coop.ts`). Répond 202 immédiatement et lance le
 * backfill via `after()` (Next.js), même mécanisme d'authentification que
 * `/api/cron/reminders` (`CRON_SECRET`).
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
    runSteamCoopBackfill().catch((error) => {
      logger.error("steam-store", error);
    });
  });

  return NextResponse.json(
    { status: "accepted", message: "Backfill Steam Store lancé en arrière-plan." },
    { status: 202 }
  );
}
