import { NextResponse } from "next/server";
import { refreshAllDiscordProfiles } from "@/lib/discord-profile";
import { logger } from "@/lib/logger";
import { verifyCronRequest } from "@/lib/cron-auth";

/**
 * Fix bug remonté : les avatars/pseudos Discord ne se mettaient à jour
 * qu'à une reconnexion complète — le rafraîchissement passif dans
 * `src/auth.ts` (callback `jwt`, toutes les 12h) dépend du jeton OAuth
 * individuel de chaque user, qui expire au bout de ~1h sans jamais se
 * renouveler tout seul côté client. Cette route, appelée par un cron
 * externe toutes les heures, rafraîchit TOUT LE MONDE indépendamment de
 * toute session active — même mécanisme de protection (`CRON_SECRET`)
 * que les autres crons du projet.
 *
 * Fix bug remonté (round 3) : l'approche "jeton du bot" seule ne
 * fonctionnait pas de façon fiable — `refreshAllDiscordProfiles`
 * (`src/lib/discord-profile.ts`) privilégie désormais les VRAIS jetons
 * OAuth de chaque user (persistés en base à chaque vraie reconnexion,
 * voir `auth.ts`), avec le bot en repli uniquement pour les users pas
 * encore reconnectés depuis ce déploiement. Voir le README pour le détail
 * du diagnostic et le rollout progressif (les jetons OAuth ne se peuplent
 * qu'à la prochaine vraie reconnexion de chaque utilisateur).
 */
export async function GET(request: Request) {
  // Premier log AVANT toute condition — si cette ligne n'apparaît jamais
  // dans les Vercel Logs pour un run donné, la requête cron-job.org
  // n'atteint pas ce handler du tout (mauvaise URL/domaine de preview au
  // lieu de prod, etc.) ; si elle apparaît mais rien après, la cause est
  // dans ce handler — voir aussi le JSON de réponse, qui porte la cause
  // exacte (`bot.botTokenConfigured`, `bot.error`) sans dépendre des
  // Vercel Logs.
  logger.info("cron:refresh-discord-profiles", "Handler appelé.");

  const auth = verifyCronRequest(request);
  if (!auth.ok) {
    if (auth.status === 503) {
      logger.error(
        "cron:refresh-discord-profiles",
        "CRON_SECRET non configurée — route désactivée."
      );
      return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }
    logger.warn("cron:refresh-discord-profiles", "Authorization manquante/invalide — 401.");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await refreshAllDiscordProfiles();
    logger.info(
      "cron:refresh-discord-profiles",
      `OAuth : ${result.oauth.updated}/${result.oauth.checked} mis à jour (${result.oauth.skipped} sans jeton, ${result.oauth.failed} échec(s)). Bot (repli) : ${result.bot.updated}/${result.bot.checked} mis à jour.`,
      result
    );
    return NextResponse.json(result);
  } catch (error) {
    // Même garde-fou que `cron:reminders` (bug remonté similaire) — ne
    // jamais laisser une erreur inattendue remonter en 500 non capturé,
    // cron-job.org compte ça comme un échec et peut finir par désactiver
    // le job après plusieurs échecs consécutifs.
    logger.error("cron:refresh-discord-profiles", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 200 }
    );
  }
}
