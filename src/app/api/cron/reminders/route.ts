import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendSessionReminder } from "@/lib/discord-reminder";
import { WEBHOOK_ANNOUNCE_DISABLED_FOR_PRIVACY } from "@/lib/discord";
import { enqueueSessionReminderDelivery } from "@/lib/session-announce";
import { logger } from "@/lib/logger";
import { verifyCronRequest } from "@/lib/cron-auth";
import { wallClockNow } from "@/lib/wallclock";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";
import {
  applyReminderResults,
  computeTimingsDue,
  parseRemindersSent,
  type ReminderSendOutcome,
} from "@/lib/reminders";

/**
 * `maxDuration` EXPLICITE de 60s — même convention que les routes de
 * backfill IGDB/Steam/actus
 * (`src/app/api/backfill/{igdb-coop,steam-store,game-news}/route.ts`).
 * Ce n'est PAS le plafond du plan : sur Hobby avec Fluid compute, le défaut
 * et le maximum Vercel sont de 300s (doc Vercel, « Duration limits »).
 * Déclarée ici (auparavant implicite) car c'est cette valeur de 60s qui
 * sert de base au bail du verrou `CronLock` (voir `src/lib/cron-lock.ts`) :
 * une exécution ne peut de toute façon jamais dépasser cette valeur.
 */
export const maxDuration = 60;

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
 *
 * Fix bug remonté (F7, rappels Discord en double si deux exécutions du
 * cron externe se chevauchent) — verrou global (`CronLock`, voir
 * `src/lib/cron-lock.ts`) acquis avant la boucle ci-dessous et libéré
 * dans le `finally` : la boucle d'envoi elle-même (sélection des
 * sessions, `computeTimingsDue`, `sendSessionReminder`,
 * `applyReminderResults`/`remindersSent`) n'est PAS modifiée par ce fix,
 * seul l'admission d'une exécution au tout début change. Si le verrou est
 * déjà détenu par une autre exécution en cours, ce run s'arrête
 * immédiatement (`skipped: "already_running"`, 200 — cas normal, pas une
 * erreur). Si la ligne `CronLock` manque ou que l'acquisition échoue pour
 * toute autre raison, la route échoue de façon EXPLICITE
 * (`error: "cron_lock_unavailable"`) et n'envoie AUCUN rappel — jamais de
 * dégradation silencieuse vers un envoi non protégé, même si ce cas ne
 * devrait jamais se produire en pratique (la ligne est créée par la
 * migration `20260914120000_add_cron_lock`, appliquée avant tout
 * déploiement). Limites résiduelles assumées et documentées dans
 * `cron-lock.ts` et le README : un doublon reste possible si une
 * exécution dépasse elle-même le bail du verrou, et un rappel peut rester
 * manqué si la prochaine exécution qui réussit arrive après la date de la
 * session (comportement de filtrage inchangé, déjà présent avant ce fix).
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

  const lock = await acquireCronLock();
  if (!lock.acquired) {
    if (lock.reason === "locked") {
      logger.info(
        "cron:reminders",
        "Verrou déjà détenu par une autre exécution en cours — run ignoré (évite un doublon)."
      );
      return NextResponse.json({ checked: 0, sent: [], failed: [], skipped: "already_running" });
    }
    // lock.reason === "missing_row" — anomalie d'infra qui ne devrait
    // jamais se produire (ligne créée par la migration au déploiement) :
    // fail closed, aucun envoi non protégé, erreur explicite distincte du
    // cas normal ci-dessus.
    logger.error(
      "cron:reminders",
      "Verrou CronLock indisponible — aucun rappel envoyé (fail closed)."
    );
    return NextResponse.json(
      { checked: 0, sent: [], failed: [], error: "cron_lock_unavailable" },
      { status: 200 }
    );
  }

  try {
    const now = wallClockNow();
    const sessions = await prisma.session.findMany({
      where: { status: "SCHEDULED", decidedGameId: { not: null }, date: { gt: now } },
      include: { decidedGame: true },
    });

    const sent: string[] = [];
    const failed: string[] = [];
    const staleSkipped: string[] = [];

    for (const session of sessions) {
      const { toSend, toResolveWithoutSending } = computeTimingsDue(session, now);
      if (!toSend && toResolveWithoutSending.length === 0) continue;

      const outcomes: ReminderSendOutcome[] = [];

      if (toSend) {
        const { minutes, actualMinutesRemaining } = toSend;
        try {
          // Chemin bot (chantier annonces Discord/fils) : n'ENVOIE rien
          // ici — enqueue une livraison `thread-reminder-<minutes>`
          // (occurrence FIXE = `minutes`, donc un appel répété pour le
          // même timing ne duplique jamais la ligne). `ok` ici signifie
          // "enqueue réussi", pas "posté dans le fil" — la livraison
          // réelle (et ses propres tentatives/backoff si le fil n'existe
          // pas encore) reste entièrement de la responsabilité de
          // l'exécuteur (`session-announce.ts`/`notification-executor.ts`),
          // jamais réessayée par ce cron une fois enqueue confirmé. Le
          // libellé affiché ("dans Xh/Xmin !") n'est PAS calculé ici pour
          // ce chemin : `resolveThreadReminder` le recalcule à partir du
          // temps RÉELLEMENT restant au moment du traitement effectif
          // (potentiellement décalé si l'exécuteur traite la livraison
          // plus tard), jamais figé à l'enqueue — voir son commentaire.
          const ok = session.announceViaBot
            ? await enqueueSessionReminderDelivery(session.id, minutes).then(
                () => true,
                (error) => {
                  logger.error(
                    "cron:reminders",
                    `Échec enqueue rappel bot ${minutes}min pour la session ${session.id}: ${String(error)}`,
                    { sessionId: session.id, minutes }
                  );
                  return false;
                }
              )
            : await sendSessionReminder(session, actualMinutesRemaining).then((result) => {
                // Chantier confidentialité des soirées — ce chemin webhook
                // ne poste plus JAMAIS dans Discord (voir le commentaire de
                // `WEBHOOK_ANNOUNCE_DISABLED_FOR_PRIVACY`, src/lib/discord.ts).
                // Traité comme "traité avec succès" pour `remindersSent` :
                // un échec RÉEL (webhook down) était auparavant réessayé au
                // prochain passage (15 min), ce qui a du sens — mais ce
                // résultat-ci ne changera JAMAIS d'issue en retentant, le
                // retenter indéfiniment ne ferait que ré-écrire les mêmes
                // notifications internes toutes les 15 min jusqu'à la
                // session, sans jamais aboutir à un vrai envoi.
                if (!result.ok && result.error === WEBHOOK_ANNOUNCE_DISABLED_FOR_PRIVACY) return true;
                return result.ok;
              });
          outcomes.push({ minutes, ok });
          if (ok) {
            sent.push(`${session.id}:${minutes}min`);
          } else {
            failed.push(`${session.id}:${minutes}min`);
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

      if (toResolveWithoutSending.length > 0) {
        staleSkipped.push(
          ...toResolveWithoutSending.map((minutes) => `${session.id}:${minutes}min`)
        );
      }

      const hasNewSuccess = outcomes.some((outcome) => outcome.ok);
      if (hasNewSuccess || toResolveWithoutSending.length > 0) {
        const remindersSent = applyReminderResults(
          parseRemindersSent(session.remindersSent),
          outcomes,
          toResolveWithoutSending
        );
        await prisma.session.update({
          where: { id: session.id },
          data: { remindersSent },
        });
      }
    }

    logger.info(
      "cron:reminders",
      `${sent.length} rappel(s) envoyé(s), ${failed.length} échec(s), ${staleSkipped.length} seuil(s) obsolète(s) consommé(s) sans envoi, sur ${sessions.length} session(s) vérifiée(s).`
    );
    return NextResponse.json({ checked: sessions.length, sent, failed, staleSkipped });
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
  } finally {
    // Libération dans TOUS les cas (succès comme erreur) — sinon un run
    // qui plante avant le return laisserait le verrou détenu jusqu'à
    // l'expiration du bail, retardant inutilement la prochaine exécution
    // réussie.
    await releaseCronLock(lock.token);
  }
}
