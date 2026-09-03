import { NextResponse } from "next/server";
import { refreshAllDiscordProfilesViaBot } from "@/lib/discord-profile";
import { logger } from "@/lib/logger";

/**
 * Fix bug remonté : les avatars/pseudos Discord ne se mettaient à jour
 * qu'à une reconnexion complète — le rafraîchissement passif dans
 * `src/auth.ts` (callback `jwt`, toutes les 12h) dépend du jeton OAuth
 * individuel de chaque user, qui expire au bout de ~7 jours sans jamais
 * se renouveler tout seul (pas de refresh token géré) ; passé ce délai il
 * échoue silencieusement en boucle jusqu'à la prochaine vraie
 * reconnexion. Cette route, appelée par un cron externe toutes les
 * heures, rafraîchit TOUT LE MONDE via le bot Discord de l'application
 * (`refreshAllDiscordProfilesViaBot`), indépendamment de toute session
 * active — même mécanisme de protection (`CRON_SECRET`) que les autres
 * crons du projet.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const result = await refreshAllDiscordProfilesViaBot();
  if (result.updated > 0) {
    logger.info(
      "cron:refresh-discord-profiles",
      `${result.updated}/${result.checked} profil(s) Discord mis à jour.`
    );
  }

  return NextResponse.json(result);
}
