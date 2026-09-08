import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendSessionReminder } from "@/lib/discord-reminder";
import { logger } from "@/lib/logger";

function parseRemindersSent(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

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
 */
export async function GET(request: Request) {
  logger.info("cron:reminders", "Handler appelé.");

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      logger.warn("cron:reminders", "Authorization manquante/invalide — 401.");
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  } else {
    logger.warn(
      "cron:reminders",
      "CRON_SECRET non configurée — route accessible sans authentification."
    );
  }

  try {
    const now = new Date();
    const sessions = await prisma.session.findMany({
      where: { status: "SCHEDULED", decidedGameId: { not: null }, date: { gt: now } },
      include: { decidedGame: true },
    });

    const sent: string[] = [];

    for (const session of sessions) {
      const minutesUntil = (session.date.getTime() - now.getTime()) / 60_000;
      const remindersSent = parseRemindersSent(session.remindersSent);
      // `reminderTimings` vide (créateur a décoché tous les rappels à la
      // création) → `timingsDue` reste toujours vide, aucun rappel n'est
      // jamais envoyé pour cette session. Comportement attendu, pas un cas
      // limite à gérer à part.
      const timingsDue = session.reminderTimings.filter(
        (minutes) => minutesUntil <= minutes && !remindersSent.includes(String(minutes))
      );

      for (const minutes of timingsDue) {
        const result = await sendSessionReminder(session, minutes);
        if (!result.ok) {
          logger.error(
            "cron:reminders",
            `Échec rappel ${minutes}min pour la session ${session.id}: ${result.error}`,
            { sessionId: session.id, minutes }
          );
        }
        remindersSent.push(String(minutes));
        sent.push(`${session.id}:${minutes}min`);
      }

      if (timingsDue.length > 0) {
        await prisma.session.update({
          where: { id: session.id },
          data: { remindersSent },
        });
      }
    }

    logger.info(
      "cron:reminders",
      `${sent.length} rappel(s) envoyé(s) sur ${sessions.length} session(s) vérifiée(s).`
    );
    return NextResponse.json({ checked: sessions.length, sent });
  } catch (error) {
    // Ne jamais laisser une erreur inattendue remonter en 500 non
    // capturé — cron-job.org compte ça comme un échec et finit par
    // désactiver le job après plusieurs échecs consécutifs (root cause
    // probable du bug remonté). Retourne 200 avec la cause en clair :
    // le run reste visible comme "réussi" côté cron-job.org (le run a
    // bien eu lieu), mais l'erreur reste diagnosticable sans dépendre
    // des Vercel Logs.
    logger.error("cron:reminders", error);
    return NextResponse.json(
      { checked: 0, sent: [], error: error instanceof Error ? error.message : String(error) },
      { status: 200 }
    );
  }
}
