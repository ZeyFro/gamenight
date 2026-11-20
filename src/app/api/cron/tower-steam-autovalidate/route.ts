import { NextResponse } from "next/server";
import { after } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { logger } from "@/lib/logger";
import { runTowerSteamAutovalidation } from "@/lib/tower-steam-measure";
import { isTowerSteamAutovalidateEnabled } from "@/lib/tower-steam-measure-rules";

/**
 * Validation automatique des défis Tower « mesurables Steam » (temps de jeu depuis l'attribution, succès Steam).
 * Fail-closed : 503 sans `CRON_SECRET`, 401 sans le bon en-tête. Éteint (`TOWER_STEAM_AUTOVALIDATE_ENABLED` différent de
 * `true`) : `{enabled:false}` en 200, aucun appel Steam. Allumé : répond 202 puis travaille dans `after()` (budget de
 * 50 s, au plus 25 lectures Steam par passage). Aucun déclencheur n'est créé par le dépôt ; la cadence est externe.
 */
export const maxDuration = 60;

const BUDGET_MS = 50_000;

async function handle(request: Request) {
  const auth = verifyCronRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.status === 503 ? "not_configured" : "unauthorized" },
      { status: auth.status },
    );
  }
  if (!isTowerSteamAutovalidateEnabled()) return NextResponse.json({ enabled: false });

  after(async () => {
    const startedAt = Date.now();
    logger.info("cron:tower-steam-autovalidate", "début");
    try {
      const summary = await runTowerSteamAutovalidation(new Date(startedAt + BUDGET_MS));
      logger.info("cron:tower-steam-autovalidate", "fin " + JSON.stringify(summary) + " durée=" + (Date.now() - startedAt) + " ms");
    } catch (error) {
      logger.error("cron:tower-steam-autovalidate", error, { stopReason: "error", durationMs: Date.now() - startedAt });
    }
  });
  return NextResponse.json({ enabled: true, status: "accepted" }, { status: 202 });
}

export const GET = handle;
export const POST = handle;
