import { prisma } from "@/lib/prisma";
import { wallClockNow } from "@/lib/wallclock";
import { HISTORY_VISIBILITY_WINDOW_DAYS, isWithinHistoryWindow } from "@/lib/history-visibility";
import { getActiveSeason } from "@/lib/seasons";
import { enqueueSessionThreadDelete, getSessionThreadDeleteStatus } from "@/lib/session-announce";
import {
  enqueueTournamentAnnounceDelete,
  enqueueTournamentThreadDelete,
  getTournamentCleanupStatus,
  isTournamentAnnounceSent,
} from "@/lib/tournament-announce";

/**
 * Chantier nettoyage réel du stockage (V2) — politique de rétention
 * CENTRALISÉE et documentée, chaque règle testable indépendamment de tout
 * accès réseau/DB (les fonctions d'ÉLIGIBILITÉ ci-dessous sont pures).
 * Chaque fonction de purge batch partage EXACTEMENT les mêmes critères
 * d'éligibilité entre `dryRun: true` (compte/liste, aucune mutation, aucun
 * appel Discord) et `dryRun: false` (exécute réellement) — un seul chemin
 * de décision, jamais deux logiques divergentes à maintenir en parallèle.
 *
 * Portée (V2, suite — complète la première itération qui ne purgeait que
 * le chat) :
 *   - Purge RÉELLEMENT les messages de chat (`ChatMessage`/`ChatReaction`,
 *     cascade) rattachés à une soirée terminée/annulée depuis plus de 7
 *     jours.
 *   - Purge RÉELLEMENT la ligne `Session`/`Tournament` elle-même une fois
 *     la fenêtre de 7 jours dépassée — voir `purgeEligibleSessionsBatch`/
 *     `purgeEligibleTournamentsBatch`. Rendu possible SANS perte de
 *     résultats/récompenses/statistiques grâce à un RÉSUMÉ DURABLE
 *     minimal (voir le README, "Résumé durable" — analyse complète des
 *     dépendances, coûts, et ce qui reste volontairement hors périmètre) :
 *       - `SessionResult`/`SuperlativeAward`/`Pronostic`/`XpBet` — DÉCOUPLÉS
 *         de `Session` (`onDelete: SetNull`, jamais Cascade), avec 5
 *         colonnes dénormalisées (`gameId`/`gameName`/`sessionDate`)
 *         capturées à l'écriture initiale — AUCUNE copie dans une table
 *         d'archive séparée, la ligne SURVIT telle quelle.
 *       - `UserLifetimeStats.tournamentsParticipatedCount` — résumé
 *         durable MINIMAL (un entier) pour le seul critère de badge qui
 *         comptait des lignes `TournamentParticipant`, elles, toujours
 *         intégralement cascadées (aucune autre lecture n'en dépend).
 *       - XP (`XpEvent`) et badges (`UserBadge`) étaient DÉJÀ sans FK vers
 *         `Session`/`Tournament` avant ce chantier — déjà à l'abri.
 *     BLOQUE explicitement la purge d'une soirée tant qu'une DETTE reste
 *     impayée (`Debt.paidAt: null`) ou que le vote de superlatifs n'est
 *     pas clôturé (`Session.superlativeVotingClosed: false`) — jamais une
 *     récompense/obligation non finalisée qui disparaît silencieusement
 *     pour respecter artificiellement le délai (voir
 *     `sessionPurgeBlockReason`).
 *   - Programme la suppression Discord (fil + annonce) des soirées/
 *     tournois éligibles dont le nettoyage n'a jamais été déclenché,
 *     AVANT (ou au moment de) la purge de leur ligne — jamais après :
 *     `resolveSessionThreadDelete`/`resolveThreadDelete`/`resolveAnnounceDelete`
 *     ne dépendent structurellement JAMAIS de l'existence de la ligne
 *     métier (voir leur commentaire), donc l'ordre exact n'a pas d'impact
 *     fonctionnel, mais la ligne n'est jamais supprimée sans qu'un
 *     nettoyage Discord ait été AU MOINS enqueue-é.
 *   - Purge les notifications in-app déjà LUES d'une saison désormais
 *     close.
 *   - Purge les lignes techniques `NotificationDelivery` TERMINALES
 *     (SENT/SKIPPED) et RETRY-SAFE (occurrence non fixe) au-delà d'une
 *     courte rétention.
 *   - Ne touche JAMAIS aux pièces jointes : aucun modèle de ce schéma n'en
 *     stocke pour les soirées/tournois/messages de chat (`ChatMessage.content`
 *     est un simple texte) — Vercel Blob n'est utilisé QUE pour la bannière
 *     de profil (`src/lib/banner-blob.ts`), scope utilisateur, hors de
 *     cette politique.
 *   - Hors périmètre, documenté explicitement (voir le README) : les
 *     statistiques GROUPE (pas par utilisateur) de `src/lib/home.ts`
 *     (`getGroupStats` — total de soirées jouées et jeu le plus joué DU
 *     GROUPE) continuent de compter des lignes `Session` live et perdront
 *     en exactitude au fil des purges — aucun résumé durable groupe n'est
 *     introduit par ce chantier (coût estimé : un compteur global +
 *     compteur par jeu, complexité jugée disproportionnée face à
 *     l'exigence "résumé minimal", voir le README pour le détail).
 */

export const RETENTION_CHAT_PURGE_DELAY_DAYS = HISTORY_VISIBILITY_WINDOW_DAYS;
export const RETENTION_TECHNICAL_DATA_RETENTION_DAYS = 30;
export const RETENTION_BATCH_SIZE = 50;
export const RETENTION_MAX_BATCH_DURATION_MS = 45_000;
export const RETENTION_CRON_LOCK_NAME = "retention-cleanup";
export const RETENTION_CRON_LOCK_LEASE_MS = 90_000;

/* -------------------------------------------------------------------- */
/* Éligibilité — pures, testables sans Prisma                            */
/* -------------------------------------------------------------------- */

export type PurgeEligibility =
  | { eligible: true; referenceDate: Date }
  /** `"active"` — événement encore VOTING/SCHEDULED/REGISTRATION/IN_PROGRESS,
   * jamais purgé quel que soit son âge. `"no_reliable_date"` — statut
   * terminal (DONE/CANCELLED) mais sans date de fin fiable connue (ne
   * devrait normalement jamais arriver, voir les commentaires de
   * `isSessionVisibleInHistory`/`isTournamentVisibleInHistory` sur les
   * mêmes replis prudents) — jamais purgé, jamais une date inventée. */
  | { eligible: false; reason: "active" | "no_reliable_date" };

/**
 * Même référence RÉELLE que `isSessionVisibleInHistory` (sessions.ts) :
 * `session.date`, jamais une date de création. Une session `Session.date`
 * n'est jamais nulle en base (colonne `NOT NULL`) — le cas
 * `"no_reliable_date"` n'est donc, pour les soirées, jamais atteignable en
 * pratique ; il reste représenté pour rester honnête sur le contrat de
 * cette fonction et pour couvrir un futur modèle où ça changerait.
 */
export function sessionPurgeEligibility(session: { status: string; date: Date }): PurgeEligibility {
  if (session.status !== "DONE" && session.status !== "CANCELLED") return { eligible: false, reason: "active" };
  return { eligible: true, referenceDate: session.date };
}

/** Même référence RÉELLE que `isTournamentVisibleInHistory` (tournaments.ts). */
export function tournamentPurgeEligibility(
  tournament: { status: string; cancelledAt: Date | null },
  matches: { completedAt: Date | null }[]
): PurgeEligibility {
  if (tournament.status === "CANCELLED") {
    if (!tournament.cancelledAt) return { eligible: false, reason: "no_reliable_date" };
    return { eligible: true, referenceDate: tournament.cancelledAt };
  }
  if (tournament.status === "DONE") {
    const completed = matches.map((m) => m.completedAt).filter((d): d is Date => d !== null);
    if (completed.length === 0) return { eligible: false, reason: "no_reliable_date" };
    return { eligible: true, referenceDate: new Date(Math.max(...completed.map((d) => d.getTime()))) };
  }
  return { eligible: false, reason: "active" };
}

/** Vrai si `referenceDate` est désormais AU-DELÀ de la fenêtre de
 * rétention (l'inverse exact d'`isWithinHistoryWindow`, réutilisée telle
 * quelle — même fenêtre, jamais un second délai parallèle inventé). */
export function isPastRetentionWindow(referenceDate: Date, now: Date = wallClockNow()): boolean {
  return !isWithinHistoryWindow(referenceDate, now);
}

/* -------------------------------------------------------------------- */
/* Chat — purge RÉELLE (pas un masquage) des messages d'une soirée        */
/* éligible                                                               */
/* -------------------------------------------------------------------- */

export interface ChatPurgeBatchResult {
  /** Soirées candidates trouvées ce passage (bornées par `limit`). */
  candidateSessionIds: string[];
  /** Nombre de messages qui SERAIENT/ONT ÉTÉ supprimés (selon `dryRun`). */
  messagesAffected: number;
  dryRun: boolean;
}

/**
 * Un seul lot borné (jamais toute la table en mémoire) : soirées DONE/
 * CANCELLED, `date` au-delà de la fenêtre, possédant ENCORE au moins un
 * `ChatMessage` — auto-résumant par construction (une soirée dont les
 * messages sont déjà purgés ne correspond plus à `some: {}` au passage
 * suivant, aucun curseur persisté nécessaire pour reprendre après
 * interruption). `dryRun: true` calcule le même compte (`count`) sans
 * jamais exécuter `deleteMany`.
 */
export async function purgeEligibleChatMessagesBatch(
  opts: { limit?: number; dryRun: boolean; now?: Date }
): Promise<ChatPurgeBatchResult> {
  const limit = opts.limit ?? RETENTION_BATCH_SIZE;
  const now = opts.now ?? wallClockNow();
  const cutoff = new Date(now.getTime() - RETENTION_CHAT_PURGE_DELAY_DAYS * 24 * 60 * 60 * 1000);

  const sessions = await prisma.session.findMany({
    where: {
      status: { in: ["DONE", "CANCELLED"] },
      date: { lt: cutoff },
      chatMessages: { some: {} },
    },
    select: { id: true },
    take: limit,
  });
  const candidateSessionIds = sessions.map((s) => s.id);
  if (candidateSessionIds.length === 0) {
    return { candidateSessionIds: [], messagesAffected: 0, dryRun: opts.dryRun };
  }

  if (opts.dryRun) {
    const count = await prisma.chatMessage.count({ where: { sessionId: { in: candidateSessionIds } } });
    return { candidateSessionIds, messagesAffected: count, dryRun: true };
  }

  // `ChatReaction` cascade via `onDelete: Cascade` sur `ChatMessage` —
  // rien à supprimer séparément.
  const deleted = await prisma.chatMessage.deleteMany({
    where: { sessionId: { in: candidateSessionIds } },
  });
  return { candidateSessionIds, messagesAffected: deleted.count, dryRun: false };
}

/* -------------------------------------------------------------------- */
/* Discord — programme le nettoyage définitif des événements ÉLIGIBLES,   */
/* jamais un balayage du serveur par nom/approximation                    */
/* -------------------------------------------------------------------- */

export interface DiscordCleanupBatchResult {
  sessionsEnqueued: string[];
  tournamentsEnqueued: string[];
  dryRun: boolean;
}

/**
 * Programme (enqueue une intention, jamais un appel Discord ici — voir
 * `enqueueSessionThreadDelete`/`enqueueTournamentThreadDelete`/
 * `enqueueTournamentAnnounceDelete`) la suppression définitive du fil (et,
 * pour un tournoi, de l'annonce) des soirées/tournois ÉLIGIBLES
 * (`sessionPurgeEligibility`/`tournamentPurgeEligibility`,
 * `isPastRetentionWindow`) dont AUCUN nettoyage n'a jamais été tenté
 * (`"never_enqueued"` — un nettoyage déjà `"pending"`/`"done"`/`"failed"`
 * est laissé tel quel : `"pending"` sera repris par l'exécuteur lui-même,
 * `"failed"` attend un réessai manuel explicite, voir
 * `retryDiscordCleanupAction` — jamais réessayé automatiquement en boucle
 * ici, pour ne jamais masquer un échec de permission qui reviendrait
 * échouer indéfiniment à chaque passage). Jamais utilisée sur un événement
 * sans référence de fil PERSISTÉE et VÉRIFIÉE (voir les résolveurs).
 */
export async function scheduleDiscordCleanupForEligibleEvents(
  opts: { limit?: number; dryRun: boolean; now?: Date }
): Promise<DiscordCleanupBatchResult> {
  const limit = opts.limit ?? RETENTION_BATCH_SIZE;
  const now = opts.now ?? wallClockNow();

  const sessionsEnqueued: string[] = [];
  const candidateSessions = await prisma.session.findMany({
    where: { status: { in: ["DONE", "CANCELLED"] }, announceViaBot: true },
    select: { id: true, status: true, date: true },
    take: limit * 4, // sur-échantillonne, filtré ensuite par éligibilité réelle — reste borné
  });
  for (const session of candidateSessions) {
    if (sessionsEnqueued.length >= limit) break;
    const eligibility = sessionPurgeEligibility(session);
    if (!eligibility.eligible || !isPastRetentionWindow(eligibility.referenceDate, now)) continue;
    const status = await getSessionThreadDeleteStatus(session.id);
    if (status !== "never_enqueued") continue;
    sessionsEnqueued.push(session.id);
    if (!opts.dryRun) await enqueueSessionThreadDelete(session.id);
  }

  const tournamentsEnqueued: string[] = [];
  const candidateTournaments = await prisma.tournament.findMany({
    where: { status: { in: ["DONE", "CANCELLED"] }, announceViaBot: true },
    select: { id: true, status: true, cancelledAt: true, matches: { select: { completedAt: true } } },
    take: limit * 4,
  });
  for (const tournament of candidateTournaments) {
    if (tournamentsEnqueued.length >= limit) break;
    const eligibility = tournamentPurgeEligibility(tournament, tournament.matches);
    if (!eligibility.eligible || !isPastRetentionWindow(eligibility.referenceDate, now)) continue;
    const status = await getTournamentCleanupStatus(tournament.id);
    const threadDone = status.thread !== "never_enqueued";
    const announceSent = await isTournamentAnnounceSent(tournament.id);
    const announceDone = !announceSent || status.announce !== "never_enqueued";
    if (threadDone && announceDone) continue;
    tournamentsEnqueued.push(tournament.id);
    if (!opts.dryRun) {
      if (!threadDone) await enqueueTournamentThreadDelete(tournament.id);
      if (announceSent && !announceDone) await enqueueTournamentAnnounceDelete(tournament.id);
    }
  }

  return { sessionsEnqueued, tournamentsEnqueued, dryRun: opts.dryRun };
}

/* -------------------------------------------------------------------- */
/* Purge RÉELLE de la ligne Session/Tournament — le point qui manquait   */
/* à la première itération (V2, suite)                                   */
/* -------------------------------------------------------------------- */

export type SessionPurgeBlockReason = "superlative_voting_pending" | "debt_unpaid";

/**
 * Bloque UNIQUEMENT sur une opération encore active dont la disparition
 * silencieuse serait une perte réelle (jamais une purge qui efface une
 * récompense/obligation non finalisée pour respecter artificiellement le
 * délai) :
 *   - `superlative_voting_pending` — `Session.superlativeVotingClosed`
 *     encore `false` : les pronostics/paris/récompenses de superlatifs de
 *     CETTE soirée ne sont pas encore résolus (`resolvePronostics`/
 *     `resolveBets`/`finalizeSuperlativeVoting` n'ont pas encore tourné —
 *     lazy, voir `finalizeSuperlativeVotingIfDue`). Purger maintenant
 *     figerait ces pronostics/paris en `correct`/`won` `null` À VIE
 *     (`resolvePronostics`/`resolveBets` ont besoin de la ligne `Session`
 *     ET de `SuperlativeVote`/les catégories pour trancher).
 *   - `debt_unpaid` — au moins une `Debt` liée à cette soirée a
 *     `paidAt: null` (gage non soldé, encore affiché sur la Home) :
 *     `Debt` cascade avec `Session` (contrairement aux 4 modèles
 *     "résultat" ci-dessus — voir son commentaire dans schema.prisma) —
 *     la purger maintenant effacerait une obligation non résolue sans
 *     aucune trace.
 * Ne fait qu'UNE requête (`Debt`) — `superlativeVotingClosed` est déjà
 * disponible sur la ligne `Session` déjà chargée par l'appelant.
 */
export async function sessionPurgeBlockReason(session: {
  id: string;
  superlativeVotingClosed: boolean;
}): Promise<SessionPurgeBlockReason | null> {
  if (!session.superlativeVotingClosed) return "superlative_voting_pending";
  const unpaidDebt = await prisma.debt.findFirst({
    where: { sessionId: session.id, paidAt: null },
    select: { id: true },
  });
  return unpaidDebt ? "debt_unpaid" : null;
}

export interface SessionRowPurgeBatchResult {
  /** Soirées éligibles par la date, AVANT tout blocage — pour l'audit. */
  candidateSessionIds: string[];
  purgedSessionIds: string[];
  blockedSessions: { sessionId: string; reason: SessionPurgeBlockReason }[];
  dryRun: boolean;
}

/**
 * Purge RÉELLEMENT la ligne `Session` (et, par cascade, `Proposal`/`Vote`/
 * `SessionInvite`/`SuperlativeVote`/`ChatMessage` restants/`Debt` déjà
 * soldées) une fois la fenêtre de 7 jours dépassée ET aucun blocage actif
 * (voir `sessionPurgeBlockReason`). `SessionResult`/`SuperlativeAward`/
 * `Pronostic`/`XpBet` SURVIVENT (`onDelete: SetNull`, voir le schéma) —
 * jamais perdus.
 *
 * Programme (enqueue, jamais un appel Discord ici) le nettoyage définitif
 * du fil AVANT de supprimer la ligne, si `announceViaBot` — reprend le
 * MÊME mécanisme idempotent que `deleteSessionAction` (occurrence
 * aléatoire, convergence "la plus récente gagne") : appelable sans risque
 * même si `scheduleDiscordCleanupForEligibleEvents` a déjà enqueue-é ce
 * nettoyage lors d'un passage précédent.
 *
 * Chaque suppression tourne dans SA PROPRE transaction, qui REVÉRIFIE
 * sous verrou (`FOR UPDATE`) le statut ET l'absence de dette impayée —
 * protège contre une course avec une saisie de résultats/un paiement de
 * dette survenus entre la sélection des candidats et l'exécution réelle
 * (fenêtre étroite, mais réelle) : la transaction est un no-op silencieux
 * si l'état a changé, jamais une suppression sur un état périmé.
 */
export async function purgeEligibleSessionsBatch(
  opts: { limit?: number; dryRun: boolean; now?: Date }
): Promise<SessionRowPurgeBatchResult> {
  const limit = opts.limit ?? RETENTION_BATCH_SIZE;
  const now = opts.now ?? wallClockNow();

  const candidates = await prisma.session.findMany({
    where: { status: { in: ["DONE", "CANCELLED"] } },
    select: { id: true, status: true, date: true, superlativeVotingClosed: true, announceViaBot: true },
    take: limit * 4,
  });

  const candidateSessionIds: string[] = [];
  const purgedSessionIds: string[] = [];
  const blockedSessions: { sessionId: string; reason: SessionPurgeBlockReason }[] = [];

  for (const session of candidates) {
    if (purgedSessionIds.length >= limit) break;
    const eligibility = sessionPurgeEligibility(session);
    if (!eligibility.eligible || !isPastRetentionWindow(eligibility.referenceDate, now)) continue;
    candidateSessionIds.push(session.id);

    const blockReason = await sessionPurgeBlockReason(session);
    if (blockReason) {
      blockedSessions.push({ sessionId: session.id, reason: blockReason });
      continue;
    }

    if (opts.dryRun) {
      purgedSessionIds.push(session.id);
      continue;
    }

    // Enqueue SEULEMENT si jamais tenté — jamais un réessai automatique
    // d'un nettoyage déjà `"failed"` (réservé au réessai manuel, voir
    // `discord-cleanup-status.ts`/l'onglet admin "Nettoyage") : même garde
    // que `scheduleDiscordCleanupForEligibleEvents` ci-dessus, jamais une
    // logique divergente entre les deux chemins qui enqueue-ent le même
    // rôle `thread-delete`.
    if (session.announceViaBot && (await getSessionThreadDeleteStatus(session.id)) === "never_enqueued") {
      await enqueueSessionThreadDelete(session.id);
    }

    const deleted = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; status: string; superlativeVotingClosed: boolean }[]>`
        SELECT id, status, "superlativeVotingClosed" FROM "Session" WHERE id = ${session.id} FOR UPDATE
      `;
      const current = locked[0];
      if (!current) return false; // déjà purgée par un passage concurrent
      if (current.status !== "DONE" && current.status !== "CANCELLED") return false; // ne devrait jamais arriver (statut terminal irréversible), garde défensive
      if (!current.superlativeVotingClosed) return false; // course perdue — résolu entre-temps
      const stillUnpaid = await tx.debt.findFirst({ where: { sessionId: session.id, paidAt: null }, select: { id: true } });
      if (stillUnpaid) return false; // course perdue — nouvelle dette détectée entre-temps

      await tx.session.delete({ where: { id: session.id } });
      return true;
    });

    if (deleted) purgedSessionIds.push(session.id);
    else blockedSessions.push({ sessionId: session.id, reason: "debt_unpaid" });
  }

  return { candidateSessionIds, purgedSessionIds, blockedSessions, dryRun: opts.dryRun };
}

export interface TournamentRowPurgeBatchResult {
  candidateTournamentIds: string[];
  purgedTournamentIds: string[];
  dryRun: boolean;
}

/**
 * Purge RÉELLEMENT la ligne `Tournament` (et, par cascade,
 * `TournamentParticipant`/`TournamentMatch`) une fois la fenêtre de 7
 * jours dépassée — AUCUNE condition bloquante équivalente à
 * `sessionPurgeBlockReason` : la finalisation d'un tournoi
 * (`declareWinner`/`advanceWinner`, championId + XP + badges) est
 * TOUJOURS synchrone, contrairement au vote de superlatifs des soirées
 * (aucune résolution différée en attente possible pour un tournoi déjà
 * `DONE`/`CANCELLED`).
 *
 * `checkTournamentBadges` compte désormais `XpEvent`/`UserLifetimeStats`
 * (voir src/lib/badges.ts) — jamais les lignes cascadées ici, aucune
 * perte de badge/XP possible.
 */
export async function purgeEligibleTournamentsBatch(
  opts: { limit?: number; dryRun: boolean; now?: Date }
): Promise<TournamentRowPurgeBatchResult> {
  const limit = opts.limit ?? RETENTION_BATCH_SIZE;
  const now = opts.now ?? wallClockNow();

  const candidates = await prisma.tournament.findMany({
    where: { status: { in: ["DONE", "CANCELLED"] } },
    select: {
      id: true,
      status: true,
      cancelledAt: true,
      announceViaBot: true,
      matches: { select: { completedAt: true } },
    },
    take: limit * 4,
  });

  const candidateTournamentIds: string[] = [];
  const purgedTournamentIds: string[] = [];

  for (const tournament of candidates) {
    if (purgedTournamentIds.length >= limit) break;
    const eligibility = tournamentPurgeEligibility(tournament, tournament.matches);
    if (!eligibility.eligible || !isPastRetentionWindow(eligibility.referenceDate, now)) continue;
    candidateTournamentIds.push(tournament.id);

    if (opts.dryRun) {
      purgedTournamentIds.push(tournament.id);
      continue;
    }

    // Même garde que `purgeEligibleSessionsBatch` ci-dessus — jamais un
    // réessai automatique d'un nettoyage déjà `"failed"`.
    if (tournament.announceViaBot) {
      const status = await getTournamentCleanupStatus(tournament.id);
      if (status.thread === "never_enqueued") await enqueueTournamentThreadDelete(tournament.id);
      if (status.announce === "never_enqueued" && (await isTournamentAnnounceSent(tournament.id))) {
        await enqueueTournamentAnnounceDelete(tournament.id);
      }
    }

    const deleted = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status FROM "Tournament" WHERE id = ${tournament.id} FOR UPDATE
      `;
      const current = locked[0];
      if (!current) return false; // déjà purgé par un passage concurrent
      if (current.status !== "DONE" && current.status !== "CANCELLED") return false; // garde défensive
      await tx.tournament.delete({ where: { id: tournament.id } });
      return true;
    });
    if (deleted) purgedTournamentIds.push(tournament.id);
  }

  return { candidateTournamentIds, purgedTournamentIds, dryRun: opts.dryRun };
}

/* -------------------------------------------------------------------- */
/* Notifications — nettoyage à la clôture de saison, RÉEL cycle de       */
/* saisons (`src/lib/seasons.ts`), jamais un calendrier parallèle         */
/* -------------------------------------------------------------------- */

export interface NotificationPurgeBatchResult {
  notificationsAffected: number;
  dryRun: boolean;
  /** `false` si aucune saison active n'existe — expose le manque plutôt
   * que de purger sur un calendrier inventé (cf. demande explicite). */
  seasonCycleAvailable: boolean;
}

/**
 * Les seules notifications purgeables sont celles créées AVANT le début de
 * la saison ACTIVE (`getActiveSeason`) : par construction du cycle de
 * saisons (`finalizeSeasonIfDue`, "jamais de trou sans saison active"),
 * TOUTE notification antérieure à `startDate` de la saison active a
 * nécessairement été créée pendant une saison DÉSORMAIS close — inutile de
 * parcourir `Season`/`SeasonSnapshot` individuellement. Restreint à
 * `read: true` — une notification NON LUE est considérée "encore
 * nécessaire à une action en cours" (l'utilisateur ne l'a pas encore vue)
 * et n'est JAMAIS purgée tant qu'elle ne l'a pas été, quel que soit son
 * âge. Ne purge JAMAIS les notifications de la saison ACTIVE elle-même
 * (bornage strict `createdAt < startDate`).
 */
export async function purgeClosedSeasonNotificationsBatch(
  opts: { limit?: number; dryRun: boolean }
): Promise<NotificationPurgeBatchResult> {
  const limit = opts.limit ?? RETENTION_BATCH_SIZE;
  const activeSeason = await getActiveSeason();
  if (!activeSeason) {
    return { notificationsAffected: 0, dryRun: opts.dryRun, seasonCycleAvailable: false };
  }

  const where = { read: true, createdAt: { lt: activeSeason.startDate } };

  if (opts.dryRun) {
    const candidates = await prisma.notification.findMany({ where, select: { id: true }, take: limit });
    return { notificationsAffected: candidates.length, dryRun: true, seasonCycleAvailable: true };
  }

  const candidates = await prisma.notification.findMany({ where, select: { id: true }, take: limit });
  if (candidates.length === 0) {
    return { notificationsAffected: 0, dryRun: false, seasonCycleAvailable: true };
  }
  const deleted = await prisma.notification.deleteMany({
    where: { id: { in: candidates.map((c) => c.id) } },
  });
  return { notificationsAffected: deleted.count, dryRun: false, seasonCycleAvailable: true };
}

/* -------------------------------------------------------------------- */
/* Données techniques — livraisons TERMINALES et RETRY-SAFE uniquement    */
/* -------------------------------------------------------------------- */

export interface TechnicalDataPurgeBatchResult {
  deliveriesAffected: number;
  dryRun: boolean;
}

/**
 * Purge UNIQUEMENT les `NotificationDelivery` :
 *   - au statut TERMINAL `SENT` ou `SKIPPED` (jamais `PENDING`/`RESERVED` —
 *     en attente ou en cours — ni `FAILED`, conservé indéfiniment pour la
 *     visibilité/le réessai admin, voir `discord-cleanup-status.ts`) ;
 *   - dont l'événement parent a une occurrence NON VIDE (`occurrence !== ""`) —
 *     les rôles à occurrence FIXE (`thread`/`announce`/`thread-summary`/
 *     `thread-close` — "SEND exactement une fois dans la vie de l'entité")
 *     ne sont JAMAIS purgés : leur unique ligne EST la garantie
 *     d'idempotence contre un ré-enqueue accidentel qui rejouerait
 *     l'événement (créerait un second fil/une seconde annonce) — les rôles
 *     à occurrence aléatoire (`invite:<id>`, `creator-member`,
 *     `member:<userId>`, `thread-delete`, `announce-delete`,
 *     `thread-reminder-<n>`) sont conçus pour être ré-enqueue-és
 *     (convergence "la plus récente gagne"), donc RETRY-SAFE même après
 *     purge de leurs anciennes lignes ;
 *   - plus vieilles que `RETENTION_TECHNICAL_DATA_RETENTION_DAYS`
 *     (`createdAt`, prudent : toujours défini, contrairement à `sentAt`
 *     qui reste `null` pour un `SKIPPED`).
 *
 * La ligne `NotificationEvent` parente n'est JAMAIS supprimée par cette
 * fonction (empreinte négligeable, aucune donnée personnelle/contenu de
 * message) — seules les lignes `NotificationDelivery`, plus nombreuses.
 */
export async function purgeTechnicalDeliveriesBatch(
  opts: { limit?: number; dryRun: boolean; now?: Date }
): Promise<TechnicalDataPurgeBatchResult> {
  const limit = opts.limit ?? RETENTION_BATCH_SIZE;
  const now = opts.now ?? wallClockNow();
  const cutoff = new Date(now.getTime() - RETENTION_TECHNICAL_DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  const where = {
    status: { in: ["SENT", "SKIPPED"] as ("SENT" | "SKIPPED")[] },
    createdAt: { lt: cutoff },
    event: { occurrence: { not: "" } },
  };

  const candidates = await prisma.notificationDelivery.findMany({ where, select: { id: true }, take: limit });
  if (opts.dryRun) {
    return { deliveriesAffected: candidates.length, dryRun: true };
  }
  if (candidates.length === 0) {
    return { deliveriesAffected: 0, dryRun: false };
  }
  const deleted = await prisma.notificationDelivery.deleteMany({
    where: { id: { in: candidates.map((c) => c.id) } },
  });
  return { deliveriesAffected: deleted.count, dryRun: false };
}
