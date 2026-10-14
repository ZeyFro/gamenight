import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { wallClockNow } from "@/lib/wallclock";
import { scopedPrisma } from "@/lib/community-scoped-client";
import { cronCommunityScope } from "@/lib/community-isolation";
import {
  enqueueSessionThreadArchive,
  enqueueSessionThreadAutoDelete,
  sessionThreadCleanupSlots,
} from "@/lib/session-announce";
import {
  enqueueTournamentThreadAutoDelete,
  enqueueTournamentThreadClose,
  tournamentThreadCleanupSlots,
} from "@/lib/tournament-announce";

/**
 * Nettoyage automatique des fils Discord (V2) — règle produit validée :
 *   1. Soirée/tournoi passé en DONE ou CANCELLED → le fil est ARCHIVÉ ET
 *      VERROUILLÉ au passage cron suivant (plus personne n'y écrit).
 *   2. 24 h après cet archivage (horodatage réel `sentAt` de la livraison,
 *      jamais une date métier approximative) → le fil est SUPPRIMÉ
 *      définitivement.
 *
 * Ce module ne fait AUCUN appel Discord : il enqueue uniquement des
 * intentions, traitées ensuite par l'exécuteur (`/api/cron/notification-executor`),
 * qui porte déjà les retries, le respect des rate limits et la traçabilité
 * (`NotificationDelivery`). Les résolveurs relisent le statut AU
 * TRAITEMENT : un fil encore lié à une soirée/un tournoi actif n'est
 * jamais ni verrouillé ni supprimé, même si une intention existe.
 *
 * Relançable sans risque, y compris en concurrence : chaque enqueue a une
 * occurrence FIXE (un second passage retombe sur la même livraison), et un
 * fil déjà absent (404) est traité comme l'objectif atteint par
 * l'exécuteur. Pas de verrou `CronLock` dédié pour cette raison (il en
 * faudrait une ligne créée par migration, sans rien protéger de plus).
 *
 * Ne concerne que les événements encore présents en base : une soirée ou
 * un tournoi SUPPRIMÉ voit déjà son fil supprimé immédiatement par son
 * propre chemin (`deleteSessionAction`/`deleteTournament`).
 */

export const THREAD_CLEANUP_DELETE_DELAY_MS = 24 * 60 * 60 * 1000;
export const THREAD_CLEANUP_MAX_ACTIONS_PER_RUN = 25;
const THREAD_CLEANUP_PAGE_SIZE = 200;

export type CleanupSlotStatus = "none" | "pending" | "sent" | "failed" | "skipped";

export interface ThreadCleanupState {
  /** Le SEND `thread` est SENT avec un identifiant de fil persisté. */
  threadCreated: boolean;
  archive: { status: CleanupSlotStatus; sentAt: Date | null };
  /** Au moins une livraison existe déjà sur l'emplacement de suppression
   * (automatique, manuelle ou issue de la rétention) — jamais doublée. */
  deleteEnqueued: boolean;
}

export type ThreadCleanupDecision = "archive" | "delete" | "wait" | "archive_failed" | "nothing";

/**
 * Pure — décide de la prochaine étape pour un événement DÉJÀ terminé
 * (DONE/CANCELLED, filtré en amont). Un archivage `skipped` signifie que
 * le résolveur l'a refusé définitivement (fil jamais créé, etc.) : rien à
 * faire. Un archivage `failed` (ex. permission `MANAGE_THREADS` absente)
 * bloque la suppression et est remonté dans le rapport, jamais contourné.
 */
export function decideThreadCleanup(state: ThreadCleanupState, now: Date): ThreadCleanupDecision {
  if (state.deleteEnqueued || !state.threadCreated) return "nothing";
  switch (state.archive.status) {
    case "none":
      return "archive";
    case "pending":
      return "wait";
    case "failed":
      return "archive_failed";
    case "skipped":
      return "nothing";
    case "sent": {
      const sentAt = state.archive.sentAt;
      if (!sentAt) return "wait";
      return now.getTime() - sentAt.getTime() >= THREAD_CLEANUP_DELETE_DELAY_MS ? "delete" : "wait";
    }
  }
}

type DeliveryRow = {
  targetSlot: string;
  operation: string;
  status: string;
  sentAt: Date | null;
  discordThreadId: string | null;
};

/** Pure — `rows` triées par `sequence` décroissante. Une livraison
 * SKIPPED est soit remplacée par une plus récente, soit un refus définitif :
 * seule la plus récente non-SKIPPED fait foi, sinon `skipped`. */
export function slotStatusFromRows(rows: DeliveryRow[]): ThreadCleanupState["archive"] {
  if (rows.length === 0) return { status: "none", sentAt: null };
  const latest = rows.find((row) => row.status !== "SKIPPED");
  if (!latest) return { status: "skipped", sentAt: null };
  if (latest.status === "SENT") return { status: "sent", sentAt: latest.sentAt };
  if (latest.status === "FAILED") return { status: "failed", sentAt: null };
  return { status: "pending", sentAt: null };
}

type CleanupSlots = { thread: string; archive: string; delete: string };

async function loadCleanupStates(slotsById: Map<string, CleanupSlots>): Promise<Map<string, ThreadCleanupState>> {
  const allSlots = [...slotsById.values()].flatMap((slots) => [slots.thread, slots.archive, slots.delete]);
  const rows = await prisma.notificationDelivery.findMany({
    where: { targetSlot: { in: allSlots } },
    select: { targetSlot: true, operation: true, status: true, sentAt: true, discordThreadId: true },
    orderBy: { sequence: "desc" },
  });
  const bySlot = new Map<string, DeliveryRow[]>();
  for (const row of rows) {
    const list = bySlot.get(row.targetSlot) ?? [];
    list.push(row);
    bySlot.set(row.targetSlot, list);
  }

  const states = new Map<string, ThreadCleanupState>();
  for (const [id, slots] of slotsById) {
    const threadRows = bySlot.get(slots.thread) ?? [];
    states.set(id, {
      threadCreated: threadRows.some(
        (row) => row.operation === "SEND" && row.status === "SENT" && row.discordThreadId !== null
      ),
      archive: slotStatusFromRows(bySlot.get(slots.archive) ?? []),
      deleteEnqueued: (bySlot.get(slots.delete) ?? []).length > 0,
    });
  }
  return states;
}

export interface ThreadCleanupKindReport {
  archiveEnqueued: string[];
  deleteEnqueued: string[];
  /** Archivage en échec terminal — suppression bloquée, à examiner
   * (typiquement `MANAGE_THREADS` manquante côté Discord). */
  archiveFailed: string[];
  waiting: number;
}

export interface ThreadCleanupReport {
  dryRun: boolean;
  sessions: ThreadCleanupKindReport;
  tournaments: ThreadCleanupKindReport;
  /** Plafond d'actions atteint : le reste sera traité au passage suivant. */
  truncated: boolean;
}

function emptyKindReport(): ThreadCleanupKindReport {
  return { archiveEnqueued: [], deleteEnqueued: [], archiveFailed: [], waiting: 0 };
}

interface CleanupTarget {
  label: "session" | "tournament";
  /** Page d'identifiants d'événements TERMINÉS, triée par id, après `cursor`. */
  loadPage: (cursor: string | undefined) => Promise<string[]>;
  slots: (id: string) => CleanupSlots;
  enqueueArchive: (id: string) => Promise<void>;
  enqueueDelete: (id: string) => Promise<void>;
}

const TERMINAL_STATUSES = ["DONE", "CANCELLED"] as const;

const SESSION_TARGET: CleanupTarget = {
  label: "session",
  loadPage: async (cursor) => {
    const scopedDb = scopedPrisma(await cronCommunityScope());
    return (
      await scopedDb.session.findMany({
        where: { status: { in: [...TERMINAL_STATUSES] }, announceViaBot: true, ...(cursor ? { id: { gt: cursor } } : {}) },
        select: { id: true },
        orderBy: { id: "asc" },
        take: THREAD_CLEANUP_PAGE_SIZE,
      })
    ).map((row) => row.id);
  },
  slots: sessionThreadCleanupSlots,
  enqueueArchive: (id) => enqueueSessionThreadArchive(id),
  enqueueDelete: (id) => enqueueSessionThreadAutoDelete(id),
};

const TOURNAMENT_TARGET: CleanupTarget = {
  label: "tournament",
  loadPage: async (cursor) => {
    const scopedDb = scopedPrisma(await cronCommunityScope());
    return (
      await scopedDb.tournament.findMany({
        where: { status: { in: [...TERMINAL_STATUSES] }, announceViaBot: true, ...(cursor ? { id: { gt: cursor } } : {}) },
        select: { id: true },
        orderBy: { id: "asc" },
        take: THREAD_CLEANUP_PAGE_SIZE,
      })
    ).map((row) => row.id);
  },
  slots: tournamentThreadCleanupSlots,
  enqueueArchive: (id) => enqueueTournamentThreadClose(id),
  enqueueDelete: (id) => enqueueTournamentThreadAutoDelete(id),
};

/**
 * Parcourt TOUS les événements terminés par pages (curseur sur l'id) —
 * jamais une fenêtre fixe sans tri, où des événements déjà traités
 * pourraient masquer indéfiniment les nouveaux. Le nombre d'intentions
 * enqueue-ées par passage reste borné (`maxActions`).
 */
async function processTarget(
  target: CleanupTarget,
  report: ThreadCleanupKindReport,
  budget: { remaining: number },
  opts: { dryRun: boolean; now: Date }
): Promise<boolean> {
  let cursor: string | undefined;
  for (;;) {
    const ids = await target.loadPage(cursor);
    if (ids.length === 0) return false;
    cursor = ids[ids.length - 1];

    const slotsById = new Map(ids.map((id) => [id, target.slots(id)]));
    const states = await loadCleanupStates(slotsById);

    for (const id of ids) {
      const decision = decideThreadCleanup(states.get(id)!, opts.now);
      if (decision === "wait") report.waiting += 1;
      if (decision === "archive_failed") {
        report.archiveFailed.push(id);
        logger.warn("discord-thread-cleanup", "Archivage de fil en échec terminal — suppression bloquée.", {
          kind: target.label,
          id,
        });
      }
      if (decision !== "archive" && decision !== "delete") continue;

      if (budget.remaining <= 0) return true;
      budget.remaining -= 1;
      if (decision === "archive") {
        if (!opts.dryRun) await target.enqueueArchive(id);
        report.archiveEnqueued.push(id);
      } else {
        if (!opts.dryRun) await target.enqueueDelete(id);
        report.deleteEnqueued.push(id);
      }
    }
  }
}

/**
 * `dryRun: true` applique EXACTEMENT les mêmes décisions sans rien
 * enqueue-er. Aucune erreur n'est absorbée ici : une panne base remonte à
 * la route cron (réponse 500 visible), jamais un rapport faussement vide.
 */
export async function runDiscordThreadCleanup(opts: {
  dryRun: boolean;
  now?: Date;
  maxActions?: number;
}): Promise<ThreadCleanupReport> {
  const now = opts.now ?? wallClockNow();
  const budget = { remaining: opts.maxActions ?? THREAD_CLEANUP_MAX_ACTIONS_PER_RUN };
  const report: ThreadCleanupReport = {
    dryRun: opts.dryRun,
    sessions: emptyKindReport(),
    tournaments: emptyKindReport(),
    truncated: false,
  };

  report.truncated = await processTarget(SESSION_TARGET, report.sessions, budget, { dryRun: opts.dryRun, now });
  if (!report.truncated) {
    report.truncated = await processTarget(TOURNAMENT_TARGET, report.tournaments, budget, {
      dryRun: opts.dryRun,
      now,
    });
  }
  return report;
}

export type CloseOnEndResult = "enqueued" | "not_eligible" | "not_needed";

/**
 * Archivage IMMÉDIAT à la fin (drapeau `DISCORD_THREAD_CLOSE_ON_END_ENABLED`,
 * voir `thread-close-on-end.ts`) : appelée juste APRÈS le commit qui fait
 * passer une soirée / un tournoi en DONE ou CANCELLED, au lieu d'attendre le
 * prochain passage du cron. Mêmes règles que le cron — ce n'est que la même
 * décision (`decideThreadCleanup`) prise plus tôt :
 *   - jamais sans fil réellement créé (sinon l'archivage serait refusé
 *     définitivement, et le fil créé ensuite ne serait jamais nettoyé) ;
 *   - jamais deux archivages (occurrence fixe + garde `none`) ;
 *   - la suppression à 24 h reste portée par le cron, inchangée.
 * Relit l'état en base : un événement qui n'est plus terminé, ou sans
 * annonce bot, n'est pas éligible.
 */
export async function closeThreadOnEnd(kind: "session" | "tournament", id: string): Promise<CloseOnEndResult> {
  const scopedDb = scopedPrisma(await cronCommunityScope());
  const target = kind === "session" ? SESSION_TARGET : TOURNAMENT_TARGET;
  const row =
    kind === "session"
      ? await scopedDb.session.findUnique({ where: { id }, select: { status: true, announceViaBot: true } })
      : await scopedDb.tournament.findUnique({ where: { id }, select: { status: true, announceViaBot: true } });
  if (!row || !row.announceViaBot || !(TERMINAL_STATUSES as readonly string[]).includes(row.status)) {
    return "not_eligible";
  }

  const states = await loadCleanupStates(new Map([[id, target.slots(id)]]));
  if (decideThreadCleanup(states.get(id)!, wallClockNow()) !== "archive") return "not_needed";

  await target.enqueueArchive(id);
  return "enqueued";
}
