import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendSessionReminder } from "@/lib/discord-reminder";
import { logger } from "@/lib/logger";
import { verifyCronRequest } from "@/lib/cron-auth";
import { wallClockNow } from "@/lib/wallclock";
import {
  applyReminderResults,
  computeTimingsDue,
  parseRemindersSent,
  type ReminderSendOutcome,
} from "@/lib/reminders";

/**
 * Route destinée à être appelée toutes les 15 min par un cron externe
 * (ex. cron-job.org — voir README, section F7). Pas de Vercel Cron ici :
 * le plan Hobby impose un minimum d'une exécution par jour, incompatible
 * avec le pas de 15 min dont F7 a besoin. Un seul appel gère tous les
 * timings de rappel de chaque session (`Session.reminderTimings`,
 * configurable par le créateur depuis PR 31/2·4 — remplace les deux
 * fenêtres fixes 24h/2h). Si `CRON_SECRET` est configurée, on exige
 * l'en-tête `Authorization: Bearer <CRON_SECRET>` (à renseigner
 * manuellement dans la config du cron externe), pour éviter qu'un tiers
 * déclenche des rappels en tapant l'URL. Sans cron externe configuré,
 * personne n'appelle jamais cette route : aucun rappel ne part, mais rien
 * ne plante ailleurs dans l'app — dégradation silencieuse, comme pour
 * DISCORD_WEBHOOK_URL non configurée (F6).
 *
 * Fix bug remonté (cron "Rappels" en Échec + Inactif sur cron-job.org
 * depuis le 21/08 — date de la migration Vercel Cron → cron externe,
 * `git log`, aucun renommage de route depuis) — cette route n'avait ni
 * log en tout premier ni `try/catch` : une seule erreur non prévue (ex.
 * base de données momentanément injoignable) faisait planter tout le
 * handler avec un 500 non capturé, jamais visible dans le corps de la
 * réponse. cron-job.org désactive automatiquement un job après plusieurs
 * échecs consécutifs — un job resté "Inactif" depuis reste inactif tant
 * que personne ne le réactive manuellement dans son tableau de bord, un
 * changement de code ne peut pas le faire à sa place (voir README).
 * Même remède que `refresh-discord-profiles` (PR précédente) : log
 * "Handler appelé." avant toute condition, et la cause exacte remonte
 * maintenant dans le JSON de réponse (`error`) plutôt que de dépendre
 * uniquement des Vercel Logs.
 *
 * Fix bugs remontés (round 2) — deux problèmes distincts corrigés
 * ensemble :
 * 1. Un rappel était ajouté à `remindersSent` MÊME quand l'envoi Discord
 *    échouait (l'ancien code ne testait `result.ok` que pour un log) : un
 *    échec restait marqué "envoyé" pour toujours, sans jamais pouvoir être
 *    réessayé. La logique de décision (`computeTimingsDue`/
 *    `applyReminderResults`, `src/lib/reminders.ts`) n'ajoute désormais un
 *    timing à `remindersSent` qu'après un succès Discord confirmé — un
 *    échec (y compris une exception inattendue, voir plus bas) reste
 *    absent, donc automatiquement réessayable au prochain passage.
 * 2. `new Date()` (heure réelle du serveur Vercel, UTC) était utilisé
 *    à la place de `wallClockNow()` (heure murale de Paris — convention
 *    de tout le projet pour comparer aux dates de session, voir
 *    `wallclock.ts`) : décalage de 1-2h (CET/CEST) sur le calcul du temps
 *    restant ET sur le filtre Prisma. Une seule référence `wallClockNow()`
 *    par exécution, réutilisée pour les deux.
 */
export async function GET(request: Request) {
  logger.info("cron:reminders", "Handler appelé.");

  const auth = verifyCronRequest(request);
  if (!auth.ok) {
    if (auth.status === 503) {
      logger.error("cron:reminders", "CRON_SECRET non configurée — route désactivée.");
      return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }
    logger.warn("cron:reminders", "Authorization manquante/invalide — 401.");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const now = wallClockNow();
    const sessions = await prisma.session.findMany({
      where: { status: "SCHEDULED", decidedGameId: { not: null }, date: { gt: now } },
      include: { decidedGame: true },
    });

    const sent: string[] = [];
    const failed: string[] = [];

    for (const session of sessions) {
      const timingsDue = computeTimingsDue(session, now);
      if (timingsDue.length === 0) continue;

      const outcomes: ReminderSendOutcome[] = [];

      for (const minutes of timingsDue) {
        try {
          const result = await sendSessionReminder(session, minutes);
          outcomes.push({ minutes, ok: result.ok });
          if (result.ok) {
            sent.push(`${session.id}:${minutes}min`);
          } else {
            failed.push(`${session.id}:${minutes}min`);
            logger.error(
              "cron:reminders",
              `Échec rappel ${minutes}min pour la session ${session.id}: ${result.error}`,
              { sessionId: session.id, minutes }
            );
          }
        } catch (error) {
          // Une exception inattendue sur UN rappel (ex. base de données
          // momentanément injoignable pendant l'envoi) ne doit abattre ni
          // les autres timings de cette session ni les sessions
          // suivantes — classé en échec (donc réessayable), la vraie
          // cause reste dans les Vercel Logs, jamais dans la réponse JSON
          // (pas de détail d'erreur potentiellement sensible exposé).
          outcomes.push({ minutes, ok: false });
          failed.push(`${session.id}:${minutes}min`);
          logger.error("cron:reminders", error, { sessionId: session.id, minutes });
        }
      }

      const hasNewSuccess = outcomes.some((outcome) => outcome.ok);
      if (hasNewSuccess) {
        const remindersSent = applyReminderResults(
          parseRemindersSent(session.remindersSent),
          outcomes
        );
        await prisma.session.update({
          where: { id: session.id },
          data: { remindersSent },
        });
      }
    }

    logger.info(
      "cron:reminders",
      `${sent.length} rappel(s) envoyé(s), ${failed.length} échec(s) sur ${sessions.length} session(s) vérifiée(s).`
    );
    return NextResponse.json({ checked: sessions.length, sent, failed });
  } catch (error) {
    // Ne jamais laisser une erreur inattendue remonter en 500 non
    // capturé — cron-job.org compte ça comme un échec et finit par
    // désactiver le job après plusieurs échecs consécutifs (root cause
    // probable du bug remonté). Retourne 200 avec la cause en clair :
    // le run reste visible comme "réussi" côté cron-job.org (le run a
    // bien eu lieu), mais l'erreur reste diagnosticable sans dépendre
    // uniquement des Vercel Logs. Filet de sécurité global pré-existant
    // (panne avant même la boucle par session, ex. connexion DB) —
    // différent du try/catch par rappel ci-dessus, qui ne renvoie jamais
    // le détail dans le JSON.
    logger.error("cron:reminders", error);
    return NextResponse.json(
      {
        checked: 0,
        sent: [],
        failed: [],
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 200 }
    );
  }
}
