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
  // Fix bug remonté (round 2) : premier log AVANT toute condition — si
  // cette ligne n'apparaît jamais dans les Vercel Logs pour un run donné,
  // la requête cron-job.org n'atteint pas ce handler du tout (mauvaise
  // URL/domaine de preview au lieu de prod, etc.) ; si elle apparaît mais
  // rien après, la cause est dans ce handler (auth ou `DISCORD_BOT_TOKEN`
  // absente, cf. `refreshAllDiscordProfilesViaBot`) — voir aussi le JSON
  // de réponse, qui porte maintenant la cause exacte (`botTokenConfigured`,
  // `error`) sans dépendre des logs Vercel.
  logger.info("cron:refresh-discord-profiles", "Handler appelé.");

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      logger.warn("cron:refresh-discord-profiles", "Authorization manquante/invalide — 401.");
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } else {
    logger.warn(
      "cron:refresh-discord-profiles",
      "CRON_SECRET non configurée — route accessible sans authentification."
    );
  }

  const result = await refreshAllDiscordProfilesViaBot();
  logger.info(
    "cron:refresh-discord-profiles",
    `${result.updated}/${result.checked} profil(s) Discord mis à jour (${result.failed} échec(s)).`,
    result
  );

  return NextResponse.json(result);
}
