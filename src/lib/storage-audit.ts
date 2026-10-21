import { prisma } from "@/lib/prisma";
import { wallClockNow } from "@/lib/wallclock";
import {
  RETENTION_CHAT_PURGE_DELAY_DAYS,
  sessionPurgeEligibility,
  sessionPurgeBlockReason,
  tournamentPurgeEligibility,
  instantSessionPurgeEligibility,
  isPastRetentionWindow,
} from "@/lib/retention";
import { getActiveSeason } from "@/lib/seasons";
import { scopedPrisma } from "@/lib/community-scoped-client";
import { communityIdFilter, resolveActiveCommunityScope, isCommunityIsolationEnabled } from "@/lib/community-isolation";
import { getDefaultCommunityId } from "@/lib/default-community";

/**
 * Chantier nettoyage réel du stockage (V2) — inventaire EN LECTURE SEULE
 * du schéma pertinent pour la rétention, demandé AVANT toute décision de
 * suppression (cf. demande explicite). Chaque compte utilise
 * `prisma.<model>.count()` (agrégat SQL, jamais un `findMany` chargeant
 * les lignes en mémoire) — reste rapide même sur une table plus grande.
 *
 * HONNÊTETÉ EXPLICITE : sans accès aux données de PRODUCTION (cette PR
 * tourne contre une base de développement/test), ces chiffres ne
 * prétendent JAMAIS refléter les volumes réels ni les gains réels d'une
 * activation — seule la STRUCTURE de l'inventaire (quels modèles, quelles
 * relations/cascades, quels critères d'éligibilité) est garantie exacte.
 * Exécuter cette fonction directement contre la base de production (via le
 * futur endpoint/onglet admin, lecture seule, aucune mutation) est le seul
 * moyen d'obtenir des chiffres réels.
 */

export interface StorageAuditReport {
  generatedAt: string;
  notifications: {
    total: number;
    read: number;
    /** Notifications LUES et antérieures à la saison active — éligibles à
     * la purge décrite dans `purgeClosedSeasonNotificationsBatch`. `null`
     * si aucune saison active n'existe (cycle non exploitable). */
    eligibleForPurge: number | null;
    seasonCycleAvailable: boolean;
  };
  notificationDelivery: {
    total: number;
    byStatus: Record<string, number>;
    /** Terminal (SENT/SKIPPED) ET retry-safe (occurrence non fixe) —
     * seules purgeables automatiquement, voir `purgeTechnicalDeliveriesBatch`. */
    terminalRetrySafe: number;
  };
  chatMessages: {
    total: number;
    /** Rattachés à une soirée DONE/CANCELLED au-delà de la fenêtre de
     * rétention — purgeables réellement (voir `purgeEligibleChatMessagesBatch`). */
    eligibleForPurge: number;
    /** Messages de chat INDÉPENDANTS d'une soirée (`sessionId: null`) —
     * ce schéma n'en a AUCUN aujourd'hui (`ChatMessage.sessionId` piloté
     * exclusivement par le chat de soirée, aucun autre chemin d'écriture
     * connu), documenté ici plutôt que supposé. */
    independentOfSession: number;
  };
  sessions: {
    total: number;
    active: number;
    eligibleForPurge: number;
    noReliableDate: number;
    /** Éligibles par la date mais bloquées — voir `sessionPurgeBlockReason`
     * (retention.ts) pour le raisonnement complet. Jamais purgées tant que
     * ce blocage tient, jamais une récompense/obligation non finalisée
     * effacée silencieusement. */
    blockedBySuperlativeVoting: number;
    blockedByUnpaidDebt: number;
    blockedByChronicle: number;
  };
  tournaments: { total: number; active: number; eligibleForPurge: number; noReliableDate: number };
  /** V2 ("Jouer maintenant") — pas de blocage comme `sessions` ci-dessus
   * (aucune condition équivalente à une dette/un vote en attente n'existe
   * pour ce type, voir `retention.ts`). */
  instantSessions: { total: number; active: number; eligibleForPurge: number; noReliableDate: number };
  sessionResults: { total: number };
  proposalsAndVotes: { proposals: number; votes: number };
  tournamentMatches: { total: number };
  xpAndRewards: {
    xpEvents: number;
    levelUpEvents: number;
    seasonSnapshots: number;
    userBadges: number;
    note: string;
  };
  attachments: {
    note: string;
  };
  scopeNote: string;
}

export async function generateStorageAuditReport(userId?: string): Promise<StorageAuditReport> {
  const now = wallClockNow();
  const scope = userId ? await resolveActiveCommunityScope(userId) : isCommunityIsolationEnabled() ? { communityIds: [], includesDefault: false } : null;
  const scopedDb = scopedPrisma(scope);
  const communityId = scope ? scope.communityIds[0] : await getDefaultCommunityId();
  const progressionWhere = { communityId: communityId ?? "__no_community__" };
  const parentWhere = communityIdFilter(scope);
  const deliveryWhere = { event: parentWhere };

  const [
    notificationTotal,
    notificationRead,
    activeSeason,
    deliveryTotal,
    deliveryByStatusRaw,
    chatMessageTotal,
    chatMessageIndependent,
    sessionTotal,
    tournamentTotal,
    sessionResultTotal,
    proposalTotal,
    voteTotal,
    matchTotal,
    xpEventTotal,
    levelUpEventTotal,
    seasonSnapshotTotal,
    userBadgeTotal,
  ] = await Promise.all([
    scopedDb.notification.count(),
    scopedDb.notification.count({ where: { read: true } }),
    communityId ? getActiveSeason(communityId) : Promise.resolve(null),
    prisma.notificationDelivery.count({ where: deliveryWhere }),
    prisma.notificationDelivery.groupBy({ where: deliveryWhere, by: ["status"], _count: { _all: true } }),
    scopedDb.chatMessage.count(),
    scopedDb.chatMessage.count({ where: { sessionId: null } }),
    scopedDb.session.count(),
    scopedDb.tournament.count(),
    scopedDb.sessionResult.count(),
    scopedDb.proposal.count({ where: { session: parentWhere } }),
    scopedDb.vote.count({ where: { proposal: { session: parentWhere } } }),
    scopedDb.tournamentMatch.count({ where: { tournament: parentWhere } }),
    scopedDb.xpEvent.count({ where: progressionWhere }),
    scopedDb.levelUpEvent.count({ where: progressionWhere }),
    scopedDb.seasonSnapshot.count({ where: { season: { communityId: progressionWhere.communityId } } }),
    scopedDb.userBadge.count({ where: progressionWhere }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const row of deliveryByStatusRaw) byStatus[row.status] = row._count._all;

  const terminalRetrySafe = await prisma.notificationDelivery.count({
    where: {
      status: { in: ["SENT", "SKIPPED"] as ("SENT" | "SKIPPED")[] },
      event: { occurrence: { not: "" }, ...parentWhere },
    },
  });

  const notificationsEligible =
    activeSeason !== null
      ? await scopedDb.notification.count({ where: { read: true, createdAt: { lt: activeSeason.startDate } } })
      : null;

  // Éligibilité chat — même critère EXACT que `purgeEligibleChatMessagesBatch`
  // (soirées DONE/CANCELLED, `date` au-delà de la fenêtre) — recalculé ici
  // en une requête agrégée plutôt que de réutiliser la fonction batchée
  // (bornée par `limit`, impropre à un total).
  const chatCutoff = new Date(now.getTime() - RETENTION_CHAT_PURGE_DELAY_DAYS * 24 * 60 * 60 * 1000);
  const chatEligible = await scopedDb.chatMessage.count({
    where: { session: { status: { in: ["DONE", "CANCELLED"] }, date: { lt: chatCutoff } } },
  });

  // Sessions/tournois — comptés via un échantillonnage borné des lignes
  // terminales (jamais toute la table) : au-delà d'un volume raisonnable
  // pour ce groupe d'amis, un audit exact nécessiterait un agrégat SQL dédié
  // par date, hors périmètre de cette PR (l'app ne vise pas des volumes
  // nécessitant ça — voir docs/archive/README_IMPLEMENTATION_HISTORY_2026-10.md pour la limite assumée).
  const AUDIT_SAMPLE_SIZE = 2000;
  const terminalSessions = await scopedDb.session.findMany({
    where: { status: { in: ["DONE", "CANCELLED"] } },
    select: { id: true, status: true, date: true, superlativeVotingClosed: true },
    take: AUDIT_SAMPLE_SIZE,
  });
  let sessionsEligible = 0;
  let sessionsNoDate = 0;
  let sessionsBlockedBySuperlativeVoting = 0;
  let sessionsBlockedByDebt = 0;
  let sessionsBlockedByChronicle = 0;
  for (const s of terminalSessions) {
    const e = sessionPurgeEligibility(s);
    if (e.eligible) {
      if (isPastRetentionWindow(e.referenceDate, now)) {
        // Coût borné à l'échantillon ET aux seules soirées déjà éligibles
        // par la date — jamais une requête `Debt` pour chaque soirée
        // terminale de l'échantillon.
        const block = await sessionPurgeBlockReason(s);
        if (block === "superlative_voting_pending") sessionsBlockedBySuperlativeVoting++;
        else if (block === "debt_unpaid") sessionsBlockedByDebt++;
        else if (block === "chronicle") sessionsBlockedByChronicle++;
        else sessionsEligible++;
      }
    } else if (e.reason === "no_reliable_date") {
      sessionsNoDate++;
    }
  }
  const activeSessions = await scopedDb.session.count({ where: { status: { in: ["VOTING", "SCHEDULED"] } } });

  const terminalTournaments = await scopedDb.tournament.findMany({
    where: { status: { in: ["DONE", "CANCELLED"] } },
    select: { status: true, cancelledAt: true, matches: { select: { completedAt: true } } },
    take: AUDIT_SAMPLE_SIZE,
  });
  let tournamentsEligible = 0;
  let tournamentsNoDate = 0;
  for (const t of terminalTournaments) {
    const e = tournamentPurgeEligibility(t, t.matches);
    if (e.eligible) {
      if (isPastRetentionWindow(e.referenceDate, now)) tournamentsEligible++;
    } else if (e.reason === "no_reliable_date") {
      tournamentsNoDate++;
    }
  }
  const activeTournaments = await scopedDb.tournament.count({
    where: { status: { in: ["REGISTRATION", "IN_PROGRESS"] } },
  });

  // V2 ("Jouer maintenant") — même échantillonnage borné que
  // sessions/tournois ci-dessus, même raison (limite assumée documentée
  // dans docs/archive/README_IMPLEMENTATION_HISTORY_2026-10.md).
  const [instantSessionTotal, activeInstantSessions, terminalInstantSessions] = await Promise.all([
    scopedDb.instantSession.count(),
    scopedDb.instantSession.count({ where: { status: "ACTIVE" } }),
    scopedDb.instantSession.findMany({
      where: { status: "ENDED" },
      select: { status: true, endedAt: true },
      take: AUDIT_SAMPLE_SIZE,
    }),
  ]);
  let instantSessionsEligible = 0;
  let instantSessionsNoDate = 0;
  for (const s of terminalInstantSessions) {
    const e = instantSessionPurgeEligibility(s);
    if (e.eligible) {
      if (isPastRetentionWindow(e.referenceDate, now)) instantSessionsEligible++;
    } else if (e.reason === "no_reliable_date") {
      instantSessionsNoDate++;
    }
  }

  return {
    generatedAt: now.toISOString(),
    notifications: {
      total: notificationTotal,
      read: notificationRead,
      eligibleForPurge: notificationsEligible,
      seasonCycleAvailable: activeSeason !== null,
    },
    notificationDelivery: { total: deliveryTotal, byStatus, terminalRetrySafe },
    chatMessages: {
      total: chatMessageTotal,
      eligibleForPurge: chatEligible,
      independentOfSession: chatMessageIndependent,
    },
    sessions: {
      total: sessionTotal,
      active: activeSessions,
      eligibleForPurge: sessionsEligible,
      noReliableDate: sessionsNoDate,
      blockedBySuperlativeVoting: sessionsBlockedBySuperlativeVoting,
      blockedByUnpaidDebt: sessionsBlockedByDebt,
      blockedByChronicle: sessionsBlockedByChronicle,
    },
    tournaments: {
      total: tournamentTotal,
      active: activeTournaments,
      eligibleForPurge: tournamentsEligible,
      noReliableDate: tournamentsNoDate,
    },
    instantSessions: {
      total: instantSessionTotal,
      active: activeInstantSessions,
      eligibleForPurge: instantSessionsEligible,
      noReliableDate: instantSessionsNoDate,
    },
    sessionResults: { total: sessionResultTotal },
    proposalsAndVotes: { proposals: proposalTotal, votes: voteTotal },
    tournamentMatches: { total: matchTotal },
    xpAndRewards: {
      xpEvents: xpEventTotal,
      levelUpEvents: levelUpEventTotal,
      seasonSnapshots: seasonSnapshotTotal,
      userBadges: userBadgeTotal,
      note:
        "Aucune de ces 4 tables ne référence Session/Tournament par clé étrangère (sourceId est un id libre, non contraint) — déjà à l'abri d'une éventuelle purge future de ces lignes, aucune action nécessaire dans cette PR.",
    },
    attachments: {
      note:
        "Aucune pièce jointe détenue par l'application pour les soirées/tournois/messages de chat (ChatMessage.content est un simple texte). Vercel Blob (banner-blob.ts) sert UNIQUEMENT la bannière de profil utilisateur, hors périmètre de cette politique.",
    },
    scopeNote:
      "Session/Tournament/InstantSession sont RÉELLEMENT supprimées 7 jours après leur fin (Session sauf blocage explicite : dette impayée, vote de superlatifs pas encore clôturé — voir ci-dessus ; InstantSession sans condition bloquante équivalente). SessionResult/SuperlativeAward/Pronostic/XpBet SURVIVENT à la suppression d'une Session (résumé durable, jamais copiés dans une table séparée). L'XP de participation à une InstantSession (XpEvent) survit de la même façon, déjà sans FK.",
  };
}
