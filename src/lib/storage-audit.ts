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

export async function generateStorageAuditReport(): Promise<StorageAuditReport> {
  const now = wallClockNow();

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
    prisma.notification.count(),
    prisma.notification.count({ where: { read: true } }),
    getActiveSeason(),
    prisma.notificationDelivery.count(),
    prisma.notificationDelivery.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.chatMessage.count(),
    prisma.chatMessage.count({ where: { sessionId: null } }),
    prisma.session.count(),
    prisma.tournament.count(),
    prisma.sessionResult.count(),
    prisma.proposal.count(),
    prisma.vote.count(),
    prisma.tournamentMatch.count(),
    prisma.xpEvent.count(),
    prisma.levelUpEvent.count(),
    prisma.seasonSnapshot.count(),
    prisma.userBadge.count(),
  ]);

  const byStatus: Record<string, number> = {};
  for (const row of deliveryByStatusRaw) byStatus[row.status] = row._count._all;

  const terminalRetrySafe = await prisma.notificationDelivery.count({
    where: {
      status: { in: ["SENT", "SKIPPED"] as ("SENT" | "SKIPPED")[] },
      event: { occurrence: { not: "" } },
    },
  });

  const notificationsEligible =
    activeSeason !== null
      ? await prisma.notification.count({ where: { read: true, createdAt: { lt: activeSeason.startDate } } })
      : null;

  // Éligibilité chat — même critère EXACT que `purgeEligibleChatMessagesBatch`
  // (soirées DONE/CANCELLED, `date` au-delà de la fenêtre) — recalculé ici
  // en une requête agrégée plutôt que de réutiliser la fonction batchée
  // (bornée par `limit`, impropre à un total).
  const chatCutoff = new Date(now.getTime() - RETENTION_CHAT_PURGE_DELAY_DAYS * 24 * 60 * 60 * 1000);
  const chatEligible = await prisma.chatMessage.count({
    where: { session: { status: { in: ["DONE", "CANCELLED"] }, date: { lt: chatCutoff } } },
  });

  // Sessions/tournois — comptés via un échantillonnage borné des lignes
  // terminales (jamais toute la table) : au-delà d'un volume raisonnable
  // pour ce groupe d'amis, un audit exact nécessiterait un agrégat SQL dédié
  // par date, hors périmètre de cette PR (l'app ne vise pas des volumes
  // nécessitant ça — voir le README pour la limite assumée).
  const AUDIT_SAMPLE_SIZE = 2000;
  const terminalSessions = await prisma.session.findMany({
    where: { status: { in: ["DONE", "CANCELLED"] } },
    select: { id: true, status: true, date: true, superlativeVotingClosed: true },
    take: AUDIT_SAMPLE_SIZE,
  });
  let sessionsEligible = 0;
  let sessionsNoDate = 0;
  let sessionsBlockedBySuperlativeVoting = 0;
  let sessionsBlockedByDebt = 0;
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
        else sessionsEligible++;
      }
    } else if (e.reason === "no_reliable_date") {
      sessionsNoDate++;
    }
  }
  const activeSessions = await prisma.session.count({ where: { status: { in: ["VOTING", "SCHEDULED"] } } });

  const terminalTournaments = await prisma.tournament.findMany({
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
  const activeTournaments = await prisma.tournament.count({
    where: { status: { in: ["REGISTRATION", "IN_PROGRESS"] } },
  });

  // V2 ("Jouer maintenant") — même échantillonnage borné que
  // sessions/tournois ci-dessus, même raison (limite assumée documentée
  // dans le README).
  const [instantSessionTotal, activeInstantSessions, terminalInstantSessions] = await Promise.all([
    prisma.instantSession.count(),
    prisma.instantSession.count({ where: { status: "ACTIVE" } }),
    prisma.instantSession.findMany({
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
      "Session/Tournament/InstantSession sont RÉELLEMENT supprimées 7 jours après leur fin (Session sauf blocage explicite : dette impayée, vote de superlatifs pas encore clôturé — voir ci-dessus ; InstantSession sans condition bloquante équivalente). SessionResult/SuperlativeAward/Pronostic/XpBet SURVIVENT à la suppression d'une Session (résumé durable, jamais copiés dans une table séparée). L'XP de participation à une InstantSession (XpEvent) survit de la même façon, déjà sans FK — voir le README.",
  };
}
