import { wallClockNow } from "@/lib/wallclock";
import { logger } from "@/lib/logger";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";
import { cronCommunityScope } from "@/lib/community-isolation";
import {
  RETENTION_BATCH_SIZE,
  RETENTION_CRON_LOCK_LEASE_MS,
  RETENTION_CRON_LOCK_NAME,
  RETENTION_MAX_BATCH_DURATION_MS,
  purgeClosedSeasonNotificationsBatch,
  purgeEligibleChatMessagesBatch,
  purgeEligibleInstantSessionsBatch,
  purgeEligibleSessionsBatch,
  purgeEligibleTournamentsBatch,
  purgeTechnicalDeliveriesBatch,
  scheduleDiscordCleanupForEligibleEvents,
  type SessionPurgeBlockReason,
} from "@/lib/retention";

/**
 * Chantier nettoyage réel du stockage (V2, suite) — orchestre les SEPT
 * volets de `retention.ts` (chat, nettoyage Discord programmé, purge
 * réelle des lignes Session, purge réelle des lignes Tournament, purge
 * réelle des lignes InstantSession ["Jouer maintenant"],
 * notifications de saison close, données techniques), DANS CET ORDRE
 * (le nettoyage Discord est toujours au moins enqueue-é avant que la
 * ligne Session/Tournament correspondante ne disparaisse — voir le
 * commentaire de fichier de `retention.ts`), en un seul passage BORNÉ :
 * chaque volet ne traite qu'UN lot (`RETENTION_BATCH_SIZE`), et l'ensemble
 * s'arrête dès que `RETENTION_MAX_BATCH_DURATION_MS` est dépassé — jamais
 * un chargement intégral d'une table en mémoire, jamais une exécution sans
 * limite de durée. Protégé contre les exécutions concurrentes par un
 * verrou dédié (`CronLock`, name `"retention-cleanup"`, même mécanisme que
 * le cron `reminders`) — "fail closed" : si le verrou ne peut pas être
 * acquis (déjà détenu par une autre exécution en cours), cette fonction
 * s'arrête immédiatement SANS RIEN TENTER, jamais une double exécution
 * concurrente d'une purge.
 *
 * `dryRun: true` partage EXACTEMENT les mêmes critères d'éligibilité que
 * `dryRun: false` (chaque fonction de `retention.ts` accepte le même
 * paramètre et ne bifurque JAMAIS sur une logique différente) — seule la
 * mutation réelle (DELETE / enqueue Discord) est court-circuitée.
 *
 * Reprenable après interruption SANS état persisté dédié : chaque volet
 * interroge "que reste-t-il à faire MAINTENANT" plutôt que de suivre un
 * curseur — une exécution précédente arrêtée en cours de route (timeout de
 * plateforme, crash) laisse simplement moins de candidats au prochain
 * passage, jamais d'état à réparer.
 */

export interface RetentionRunReport {
  dryRun: boolean;
  startedAt: string;
  durationMs: number;
  stoppedReason: "completed" | "budget_exhausted" | "lock_not_acquired";
  chat: { candidateSessionIds: string[]; messagesAffected: number } | null;
  discordCleanup: { sessionsEnqueued: string[]; tournamentsEnqueued: string[] } | null;
  sessionRowPurge: {
    candidateSessionIds: string[];
    purgedSessionIds: string[];
    blockedSessions: { sessionId: string; reason: SessionPurgeBlockReason }[];
  } | null;
  tournamentRowPurge: { candidateTournamentIds: string[]; purgedTournamentIds: string[] } | null;
  instantSessionRowPurge: { candidateInstantSessionIds: string[]; purgedInstantSessionIds: string[] } | null;
  notifications: { notificationsAffected: number; seasonCycleAvailable: boolean } | null;
  technicalData: { deliveriesAffected: number } | null;
  errors: string[];
}

export async function runRetentionCleanup(opts: {
  dryRun: boolean;
  now?: Date;
  batchSize?: number;
  budgetMs?: number;
}): Promise<RetentionRunReport> {
  const startedAt = opts.now ?? wallClockNow();
  const budgetMs = opts.budgetMs ?? RETENTION_MAX_BATCH_DURATION_MS;
  const deadlineMs = Date.now() + budgetMs;
  const limit = opts.batchSize ?? RETENTION_BATCH_SIZE;
  const scope = await cronCommunityScope();
  const errors: string[] = [];

  const report: RetentionRunReport = {
    dryRun: opts.dryRun,
    startedAt: startedAt.toISOString(),
    durationMs: 0,
    stoppedReason: "completed",
    chat: null,
    discordCleanup: null,
    sessionRowPurge: null,
    tournamentRowPurge: null,
    instantSessionRowPurge: null,
    notifications: null,
    technicalData: null,
    errors,
  };

  // Le dry-run n'a besoin d'AUCUNE protection de concurrence (aucune
  // mutation, deux dry-run concurrents produisent juste deux rapports
  // identiques) — le verrou n'est acquis que pour une exécution réelle,
  // pour ne jamais bloquer une consultation en lecture seule derrière un
  // verrou déjà détenu par un passage réel en cours.
  let lockToken: string | null = null;
  if (!opts.dryRun) {
    const lock = await acquireCronLock(RETENTION_CRON_LOCK_NAME, RETENTION_CRON_LOCK_LEASE_MS);
    if (!lock.acquired) {
      report.stoppedReason = "lock_not_acquired";
      report.durationMs = Date.now() - startedAt.getTime();
      logger.info("retention-runner", "Verrou non acquis — passage ignoré.", { reason: lock.reason });
      return report;
    }
    lockToken = lock.token;
  }

  try {
    try {
      report.chat = await purgeEligibleChatMessagesBatch({ limit, dryRun: opts.dryRun, now: startedAt, scope });
    } catch (error) {
      errors.push(`chat: ${String(error)}`);
      logger.error("retention-runner", error, { step: "chat" });
    }

    if (Date.now() >= deadlineMs) {
      report.stoppedReason = "budget_exhausted";
      return report;
    }

    try {
      report.discordCleanup = await scheduleDiscordCleanupForEligibleEvents({
        limit,
        dryRun: opts.dryRun,
        now: startedAt,
        scope,
      });
    } catch (error) {
      errors.push(`discordCleanup: ${String(error)}`);
      logger.error("retention-runner", error, { step: "discordCleanup" });
    }

    if (Date.now() >= deadlineMs) {
      report.stoppedReason = "budget_exhausted";
      return report;
    }

    try {
      report.sessionRowPurge = await purgeEligibleSessionsBatch({ limit, dryRun: opts.dryRun, now: startedAt, scope });
    } catch (error) {
      errors.push(`sessionRowPurge: ${String(error)}`);
      logger.error("retention-runner", error, { step: "sessionRowPurge" });
    }

    if (Date.now() >= deadlineMs) {
      report.stoppedReason = "budget_exhausted";
      return report;
    }

    try {
      report.tournamentRowPurge = await purgeEligibleTournamentsBatch({ limit, dryRun: opts.dryRun, now: startedAt, scope });
    } catch (error) {
      errors.push(`tournamentRowPurge: ${String(error)}`);
      logger.error("retention-runner", error, { step: "tournamentRowPurge" });
    }

    if (Date.now() >= deadlineMs) {
      report.stoppedReason = "budget_exhausted";
      return report;
    }

    try {
      report.instantSessionRowPurge = await purgeEligibleInstantSessionsBatch({
        limit,
        dryRun: opts.dryRun,
        now: startedAt,
        scope,
      });
    } catch (error) {
      errors.push(`instantSessionRowPurge: ${String(error)}`);
      logger.error("retention-runner", error, { step: "instantSessionRowPurge" });
    }

    if (Date.now() >= deadlineMs) {
      report.stoppedReason = "budget_exhausted";
      return report;
    }

    try {
      report.notifications = await purgeClosedSeasonNotificationsBatch({ limit, dryRun: opts.dryRun, scope });
    } catch (error) {
      errors.push(`notifications: ${String(error)}`);
      logger.error("retention-runner", error, { step: "notifications" });
    }

    if (Date.now() >= deadlineMs) {
      report.stoppedReason = "budget_exhausted";
      return report;
    }

    try {
      report.technicalData = await purgeTechnicalDeliveriesBatch({ limit, dryRun: opts.dryRun, now: startedAt, scope });
    } catch (error) {
      errors.push(`technicalData: ${String(error)}`);
      logger.error("retention-runner", error, { step: "technicalData" });
    }

    return report;
  } finally {
    report.durationMs = Date.now() - startedAt.getTime();
    if (lockToken) await releaseCronLock(lockToken, RETENTION_CRON_LOCK_NAME);
  }
}
