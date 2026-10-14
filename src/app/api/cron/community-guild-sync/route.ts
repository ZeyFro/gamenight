import { NextResponse } from "next/server";
import { syncCommunitiesWithBotGuilds } from "@/lib/community-guild-sync";
import { logger } from "@/lib/logger";
import { verifyCronRequest } from "@/lib/cron-auth";

// Budget des appels Discord (2 pages au plus en pratique) : sous les 30 s de
// cron-job.org.
const DISCORD_BUDGET_MS = 20_000;

/**
 * Rattrapage des communautés (multi-communautés, PR2) : crée en PENDING les
 * serveurs du bot que le webhook a manqués, marque LEFT ceux que le bot a
 * quittés. Éteint par défaut : sans `COMMUNITY_AUTO_CREATE_ENABLED=true`
 * exactement, la route répond `{ enabled: false }` sans rien lire ni écrire.
 */
export async function GET(request: Request) {
  const auth = verifyCronRequest(request);
  if (!auth.ok) {
    if (auth.status === 503) {
      logger.error("cron:community-guild-sync", "CRON_SECRET non configurée — route désactivée.");
      return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }
    logger.warn("cron:community-guild-sync", "Authorization manquante/invalide — 401.");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (process.env.COMMUNITY_AUTO_CREATE_ENABLED !== "true") {
    return NextResponse.json({ enabled: false });
  }

  try {
    const result = await syncCommunitiesWithBotGuilds({
      deadline: new Date(Date.now() + DISCORD_BUDGET_MS),
    });
    if (result.ok) logger.info("cron:community-guild-sync", "Passage terminé.", { ...result });
    else logger.error("cron:community-guild-sync", new Error(result.reason));
    return NextResponse.json(result);
  } catch (error) {
    // Même garde-fou que les autres crons : jamais de 500 non capturé
    // (cron-job.org désactiverait le job après des échecs consécutifs).
    logger.error("cron:community-guild-sync", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 200 });
  }
}
