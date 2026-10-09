import { prisma } from "@/lib/prisma";
import { communityIdFilter } from "@/lib/community-isolation";
import { getDefaultCommunityId } from "@/lib/default-community";
import { wallClockNow } from "@/lib/wallclock";
import {
  RETENTION_CHAT_PURGE_DELAY_DAYS,
  getEarliestActiveSeasonStart,
  listRetentionCommunityIds,
  retentionClient,
  sessionPurgeEligibility,
  sessionPurgeBlockReason,
  tournamentPurgeEligibility,
  instantSessionPurgeEligibility,
  isPastRetentionWindow,
} from "@/lib/retention";

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
 *
 * Multi-communautés, PR B — l'inventaire est BORNÉ PAR COMMUNAUTÉ : chaque compte
 * collectif passe par `retentionClient` (périmètre = UNE communauté, quel que soit
 * l'état de `COMMUNITY_ISOLATION_ENABLED`) ; les enfants sans colonne de communauté
 * (propositions, votes, matchs, résultats, instantanés de saison) sont comptés via
 * leur parent. Avec `communityId`, le rapport ne contient QUE cette communauté ;
 * sans, c'est la somme de toutes. Restent GLOBAUX, car personnels : notifications et
 * livraisons techniques. Un résumé durable dont la soirée a été purgée
 * (`SessionResult.sessionId = null`) n'est plus rattachable à une communauté : il
 * n'est compté dans aucun inventaire de communauté.
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

interface CommunityAuditCounts {
  chatMessageTotal: number;
  chatMessageIndependent: number;
  chatEligible: number;
  sessionTotal: number;
  activeSessions: number;
  sessionsEligible: number;
  sessionsNoDate: number;
  sessionsBlockedBySuperlativeVoting: number;
  sessionsBlockedByDebt: number;
  tournamentTotal: number;
  activeTournaments: number;
  tournamentsEligible: number;
  tournamentsNoDate: number;
  instantSessionTotal: number;
  activeInstantSessions: number;
  instantSessionsEligible: number;
  instantSessionsNoDate: number;
  sessionResultTotal: number;
  proposalTotal: number;
  voteTotal: number;
  matchTotal: number;
  xpEventTotal: number;
  levelUpEventTotal: number;
  seasonSnapshotTotal: number;
  userBadgeTotal: number;
}

// Échantillon borné (jamais toute la table) — limite assumée documentée dans le README.
const AUDIT_SAMPLE_SIZE = 2000;

async function auditCommunity(communityId: string, now: Date): Promise<CommunityAuditCounts> {
  const scopedDb = await retentionClient(communityId);
  const defaultId = await getDefaultCommunityId();
  // Filtre de relation pour les enfants sans colonne de communauté (via leur soirée / tournoi).
  const parent = communityIdFilter({ communityIds: [communityId], includesDefault: communityId === defaultId });

  const [
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
    scopedDb.chatMessage.count(),
    scopedDb.chatMessage.count({ where: { sessionId: null } }),
    scopedDb.session.count(),
    scopedDb.tournament.count(),
    scopedDb.sessionResult.count({ where: { session: parent } }),
    scopedDb.proposal.count({ where: { session: parent } }),
    scopedDb.vote.count({ where: { proposal: { session: parent } } }),
    scopedDb.tournamentMatch.count({ where: { tournament: parent } }),
    scopedDb.xpEvent.count({ where: { communityId } }),
    scopedDb.levelUpEvent.count({ where: { communityId } }),
    scopedDb.seasonSnapshot.count({ where: { season: { communityId } } }),
    scopedDb.userBadge.count({ where: { communityId } }),
  ]);

  // Éligibilité chat — même critère EXACT que `purgeEligibleChatMessagesBatch`
  // (soirées DONE/CANCELLED, `date` au-delà de la fenêtre) — recalculé ici
  // en une requête agrégée plutôt que de réutiliser la fonction batchée
  // (bornée par `limit`, impropre à un total).
  const chatCutoff = new Date(now.getTime() - RETENTION_CHAT_PURGE_DELAY_DAYS * 24 * 60 * 60 * 1000);
  const chatEligible = await scopedDb.chatMessage.count({
    where: { session: { status: { in: ["DONE", "CANCELLED"] }, date: { lt: chatCutoff } } },
  });

  const terminalSessions = await scopedDb.session.findMany({
    where: { status: { in: ["DONE", "CANCELLED"] } },
    select: { id: true, status: true, date: true, superlativeVotingClosed: true, communityId: true },
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
  // dans le README).
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
    chatMessageTotal,
    chatMessageIndependent,
    chatEligible,
    sessionTotal,
    activeSessions,
    sessionsEligible,
    sessionsNoDate,
    sessionsBlockedBySuperlativeVoting,
    sessionsBlockedByDebt,
    tournamentTotal,
    activeTournaments,
    tournamentsEligible,
    tournamentsNoDate,
    instantSessionTotal,
    activeInstantSessions,
    instantSessionsEligible,
    instantSessionsNoDate,
    sessionResultTotal,
    proposalTotal,
    voteTotal,
    matchTotal,
    xpEventTotal,
    levelUpEventTotal,
    seasonSnapshotTotal,
    userBadgeTotal,
  };
}

export async function generateStorageAuditReport(
  opts: { communityId?: string } = {}
): Promise<StorageAuditReport> {
  const now = wallClockNow();

  // Personnel / technique, donc GLOBAL : jamais rattaché à une communauté.
  const [notificationTotal, notificationRead, earliestSeasonStart, deliveryTotal, deliveryByStatusRaw] =
    await Promise.all([
      prisma.notification.count(),
      prisma.notification.count({ where: { read: true } }),
      getEarliestActiveSeasonStart(),
      prisma.notificationDelivery.count(),
      prisma.notificationDelivery.groupBy({ by: ["status"], _count: { _all: true } }),
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
    earliestSeasonStart !== null
      ? await prisma.notification.count({ where: { read: true, createdAt: { lt: earliestSeasonStart } } })
      : null;

  const communityIds = opts.communityId ? [opts.communityId] : await listRetentionCommunityIds();
  const parts: CommunityAuditCounts[] = [];
  for (const id of communityIds) parts.push(await auditCommunity(id, now));
  const sum = (pick: (c: CommunityAuditCounts) => number) => parts.reduce((total, c) => total + pick(c), 0);

  return {
    generatedAt: now.toISOString(),
    notifications: {
      total: notificationTotal,
      read: notificationRead,
      eligibleForPurge: notificationsEligible,
      seasonCycleAvailable: earliestSeasonStart !== null,
    },
    notificationDelivery: { total: deliveryTotal, byStatus, terminalRetrySafe },
    chatMessages: {
      total: sum((c) => c.chatMessageTotal),
      eligibleForPurge: sum((c) => c.chatEligible),
      independentOfSession: sum((c) => c.chatMessageIndependent),
    },
    sessions: {
      total: sum((c) => c.sessionTotal),
      active: sum((c) => c.activeSessions),
      eligibleForPurge: sum((c) => c.sessionsEligible),
      noReliableDate: sum((c) => c.sessionsNoDate),
      blockedBySuperlativeVoting: sum((c) => c.sessionsBlockedBySuperlativeVoting),
      blockedByUnpaidDebt: sum((c) => c.sessionsBlockedByDebt),
    },
    tournaments: {
      total: sum((c) => c.tournamentTotal),
      active: sum((c) => c.activeTournaments),
      eligibleForPurge: sum((c) => c.tournamentsEligible),
      noReliableDate: sum((c) => c.tournamentsNoDate),
    },
    instantSessions: {
      total: sum((c) => c.instantSessionTotal),
      active: sum((c) => c.activeInstantSessions),
      eligibleForPurge: sum((c) => c.instantSessionsEligible),
      noReliableDate: sum((c) => c.instantSessionsNoDate),
    },
    sessionResults: { total: sum((c) => c.sessionResultTotal) },
    proposalsAndVotes: { proposals: sum((c) => c.proposalTotal), votes: sum((c) => c.voteTotal) },
    tournamentMatches: { total: sum((c) => c.matchTotal) },
    xpAndRewards: {
      xpEvents: sum((c) => c.xpEventTotal),
      levelUpEvents: sum((c) => c.levelUpEventTotal),
      seasonSnapshots: sum((c) => c.seasonSnapshotTotal),
      userBadges: sum((c) => c.userBadgeTotal),
      note:
        "Aucune de ces 4 tables ne référence Session/Tournament par clé étrangère (sourceId est un id libre, non contraint) — déjà à l'abri d'une éventuelle purge future de ces lignes, aucune action nécessaire dans cette PR. Comptées par communauté (XpEvent, LevelUpEvent, UserBadge portent leur communauté ; les instantanés de saison passent par leur saison).",
    },
    attachments: {
      note:
        "Aucune pièce jointe détenue par l'application pour les soirées/tournois/messages de chat (ChatMessage.content est un simple texte). Vercel Blob (banner-blob.ts) sert UNIQUEMENT la bannière de profil utilisateur, hors périmètre de cette politique.",
    },
    scopeNote:
      "Session/Tournament/InstantSession sont RÉELLEMENT supprimées 7 jours après leur fin (Session sauf blocage explicite : dette impayée, vote de superlatifs pas encore clôturé — voir ci-dessus ; InstantSession sans condition bloquante équivalente). SessionResult/SuperlativeAward/Pronostic/XpBet SURVIVENT à la suppression d'une Session (résumé durable, jamais copiés dans une table séparée). L'XP de participation à une InstantSession (XpEvent) survit de la même façon, déjà sans FK — voir le README. Inventaire borné par communauté : notifications et livraisons techniques (personnelles) restent globales.",
  };
}
