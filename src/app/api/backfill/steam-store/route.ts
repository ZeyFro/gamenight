import { NextResponse } from "next/server";
import { after } from "next/server";
import { runSteamCoopBackfill } from "@/lib/backfill-steam-coop";
import { logger } from "@/lib/logger";

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
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
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
