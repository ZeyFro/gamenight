import type { Badge } from "@prisma/client";
import { scopedPrismaForCommunityId, scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { statsCommunityIdForSession, writeCommunityIdForUser } from "@/lib/community-stats";
import { isCommunityIsolationEnabled } from "@/lib/community-isolation";
import { durableProgressWhere } from "@/lib/member-stats";
import { canProgressInCommunity, getMemberStats, lockCommunityProgress } from "@/lib/member-stats";
import { prisma } from "@/lib/prisma";
import { awardXp } from "@/lib/xp-actions";
import { announceBadgeUnlocked } from "@/lib/discord-badge-unlocked";
import { createNotification } from "@/lib/notifications";
export { BADGE_XP_BY_RARITY, RARITY_LABELS, CATEGORY_LABELS } from "@/lib/badge-rarity";

/**
 * Système de badges automatiques (PR 7/9) — 100% passif : l'app détecte
 * et attribue, l'utilisateur ne fait jamais d'action dédiée. `criteria`
 * (JSON en base, typé ici) suit une forme unique `{ type, count }` pour
 * les 7 types de critère listés par l'utilisateur — un seuil à atteindre
 * sur une statistique donnée.
 */
export type BadgeCriteria =
  | { type: "SESSIONS_CREATED"; count: number }
  | { type: "SESSIONS_PARTICIPATED"; count: number }
  | { type: "VOTES_CAST"; count: number }
  | { type: "SUPERLATIVES_WON"; count: number }
  | { type: "LIBRARY_SIZE"; count: number }
  | { type: "STREAK_DAYS"; count: number }
  | { type: "ACCOUNT_AGE_DAYS"; count: number }
  // Sprint 3 suite (défis hebdo) — "Challenger" au 5ème défi complété.
  | { type: "CHALLENGES_COMPLETED"; count: number }
  // Sprint 4 (Pronostics) — "Oracle" à 10 pronos corrects.
  | { type: "PRONOSTICS_CORRECT"; count: number }
  // Sprint 4 (Paris d'XP) — "High Roller" à 5 paris gagnés.
  | { type: "BETS_WON"; count: number }
  // Sprint 4 (Paris d'XP) — "All In" : parier 50% du solde ET gagner.
  // `count` toujours 1 ici (pas un seuil cumulatif comme les autres
  // critères) — la stat correspondante (`allInWin`) vaut 0 ou 1, jamais
  // plus, cf. `checkBetBadges`.
  | { type: "ALL_IN_WIN"; count: number }
  // Sprint 5 (Tournois Bracket) — "Champion de tournoi" (1 tournoi gagné),
  // "Gladiateur" (5 tournois joués).
  | { type: "TOURNAMENTS_WON"; count: number }
  | { type: "TOURNAMENTS_PARTICIPATED"; count: number };

/**
 * Stats partielles passées à `unlockMatchingBadges` — chaque appelant ne
 * calcule QUE la statistique concernée par l'événement qui vient de se
 * produire (une requête `count()` ciblée), jamais le bundle complet.
 * Volontairement léger : contrairement à `touchStreak`/`checkTemporalBadges`
 * (appelés à chaque page protégée, cf. `getCurrentUser`), les checks
 * "live" ci-dessous sont déclenchés par une action explicite (créer une
 * soirée, voter…), pas à chaque chargement de page — pas besoin de
 * mutualiser en un seul gros calcul.
 */
export interface BadgeStats {
  sessionsCreated?: number;
  sessionsParticipated?: number;
  votesCast?: number;
  superlativesWon?: number;
  libraryCount?: number;
  streakCount?: number;
  accountAgeDays?: number;
  challengesCompleted?: number;
  pronosticsCorrect?: number;
  betsWon?: number;
  allInWin?: number;
  tournamentsWon?: number;
  tournamentsParticipated?: number;
}

/**
 * Exportée (PR "build ne fait plus que compiler") pour être réutilisée par
 * `src/lib/backfill-badges.ts` sans la dupliquer — même mapping critère →
 * clé de stat des deux côtés (live et backfill), une seule source de
 * vérité.
 */
export const STAT_KEY_FOR_CRITERIA_TYPE: Record<BadgeCriteria["type"], keyof BadgeStats> = {
  SESSIONS_CREATED: "sessionsCreated",
  SESSIONS_PARTICIPATED: "sessionsParticipated",
  VOTES_CAST: "votesCast",
  SUPERLATIVES_WON: "superlativesWon",
  LIBRARY_SIZE: "libraryCount",
  STREAK_DAYS: "streakCount",
  ACCOUNT_AGE_DAYS: "accountAgeDays",
  CHALLENGES_COMPLETED: "challengesCompleted",
  PRONOSTICS_CORRECT: "pronosticsCorrect",
  BETS_WON: "betsWon",
  ALL_IN_WIN: "allInWin",
  TOURNAMENTS_WON: "tournamentsWon",
  TOURNAMENTS_PARTICIPATED: "tournamentsParticipated",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Débloque tous les badges (parmi ceux pas encore obtenus) dont le
 * critère est satisfait par `stats` — ne regarde que les types de
 * critère présents dans `stats` (les autres badges sont ignorés cette
 * fois-ci, pas "jamais" : un futur appel avec les bonnes stats les
 * check era). Idempotent : `unlockBadge` retombe silencieusement sur la
 * contrainte unique `@@unique([communityId, userId, badgeId])` en cas de course.
 *
 * Retourne `true` si au moins un badge a été débloqué (Sprint 2 PR-B,
 * U9 — confettis `?celebrate=badge` sur les appelants qui redirigent
 * vers une page vue par ce même user, ex. `createSession`).
 */
async function unlockMatchingBadges(userId: string, communityId: string | null, stats: BadgeStats): Promise<boolean> {
  const id = await statsCommunityIdForSession(communityId);
  if (!(await canProgressInCommunity(userId, id))) return false;
  const scopedDb = await scopedPrismaForCommunityId(id);
  // Les badges déjà gagnés restent dus, même désactivés ou si le streak casse.
  const earned = await scopedDb.userBadge.findMany({ where: { communityId: id, userId }, include: { badge: true } });
  for (const row of earned) {
    if (row.badge.xpReward) await awardXp(userId, id, "BADGE_UNLOCKED", row.badgeId, row.badge.xpReward);
  }
  const earnedIds = new Set(earned.map((row) => row.badgeId));
  const badges = await prisma.badge.findMany({ where: { active: true } });
  let unlockedAny = false;
  for (const badge of badges) {
    if (earnedIds.has(badge.id)) continue;
    const criteria = badge.criteria as unknown as BadgeCriteria;
    const value = stats[STAT_KEY_FOR_CRITERIA_TYPE[criteria.type]];
    if (value === undefined || value < criteria.count) continue;
    if (await unlockBadge(userId, id, badge)) unlockedAny = true;
  }
  return unlockedAny;
}

async function unlockBadge(userId: string, communityId: string, badge: Badge): Promise<boolean> {
  const unlocked = await prisma.$transaction(async (tx) => {
    if (!(await lockCommunityProgress(tx, communityId, userId))) return false;
    const scopedDb = scopedTransactionPrisma(tx, isCommunityIsolationEnabled() ? { communityIds: [communityId], includesDefault: false } : null);
    return (await scopedDb.userBadge.createMany({ data: [{ communityId, userId, badgeId: badge.id }], skipDuplicates: true })).count > 0;
  });
  // Réparer la récompense même après interruption entre badge et XP.
  // Le ledger composé garantit l'idempotence de cette réparation.
  if (badge.xpReward) await awardXp(userId, communityId, "BADGE_UNLOCKED", badge.id, badge.xpReward);
  if (!unlocked) return false;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user) await announceBadgeUnlocked(user, badge, communityId);
  await createNotification({ userId, communityId, type: "BADGE", title: badge.icon + " " + badge.name, message: badge.description, relatedBadgeId: badge.id });
  return true;
}

/**
 * Après `createSession` — First Blood / Meneur / Community leader.
 *
 * Chantier nettoyage réel du stockage (V2, suite) — compte les `XpEvent`
 * `CREATE_SESSION` (posés à CHAQUE création de session, classique ET
 * roulette — voir `session-lifecycle.ts`/`roulette.ts`) plutôt que les
 * lignes `Session` elles-mêmes : même raisonnement EXACT que
 * `checkSessionsParticipatedBadges`/`checkVotesCastBadges` juste en
 * dessous (déjà ainsi AVANT ce chantier) — un badge ne doit jamais se
 * reverrouiller/sous-compter parce qu'une soirée ancienne a été purgée,
 * seul le cumul historique compte.
 */
export async function checkSessionsCreatedBadges(userId: string, communityId: string | null): Promise<boolean> {
  const id = await statsCommunityIdForSession(communityId);
  const scopedDb = await scopedPrismaForCommunityId(id);
  const count = await scopedDb.xpEvent.count({ where: { communityId: id, userId, reason: "CREATE_SESSION" } });
  return unlockMatchingBadges(userId, id, { sessionsCreated: count });
}

/**
 * Après la clôture d'une session, pour chaque voteur de la proposition
 * gagnante — Habitué / GOAT / LÉGENDE. Compte les `XpEvent` PARTICIPATE
 * plutôt que de recalculer "présent à combien de soirées" à la main :
 * c'est exactement la même définition de présence déjà utilisée partout
 * dans le chantier XP, et déjà backfillée pour l'historique.
 */
export async function checkSessionsParticipatedBadges(userId: string, communityId: string | null): Promise<void> {
  const id = await statsCommunityIdForSession(communityId);
  const scopedDb = await scopedPrismaForCommunityId(id);
  const count = await scopedDb.xpEvent.count({ where: { communityId: id, userId, reason: "PARTICIPATE" } });
  await unlockMatchingBadges(userId, id, { sessionsParticipated: count });
}

/**
 * Après un nouveau vote (pas un dévote) — Citoyen. Compte les `XpEvent`
 * VOTE (un par proposition votée une fois dans sa vie) plutôt que les
 * lignes `Vote` actuelles : un badge ne doit pas redevenir verrouillé
 * parce qu'on a retiré un vote entre-temps, seul le cumul historique
 * compte.
 */
export async function checkVotesCastBadges(userId: string, communityId: string | null): Promise<void> {
  const id = await statsCommunityIdForSession(communityId);
  const scopedDb = await scopedPrismaForCommunityId(id);
  const count = await scopedDb.xpEvent.count({ where: { communityId: id, userId, reason: "VOTE" } });
  await unlockMatchingBadges(userId, id, { votesCast: count });
}

/** Après l'attribution d'un award de superlatif — Compétiteur / Star. */
export async function checkSuperlativesWonBadges(userId: string, communityId: string | null): Promise<void> {
  const id = await statsCommunityIdForSession(communityId);
  const scopedDb = await scopedPrismaForCommunityId(id);
  const count = await scopedDb.superlativeAward.count({ where: { winnerUserId: userId, ...await durableProgressWhere(id) } });
  await unlockMatchingBadges(userId, id, { superlativesWon: count });
}

/** Après l'ajout d'un jeu (manuel ou import Steam) — Bibliophile / Collectionneur. */
export async function checkLibraryBadges(userId: string, communityId: string | null): Promise<void> {
  const id = await statsCommunityIdForSession(communityId);
  const count = await prisma.userGame.count({ where: { userId, owned: true } });
  await unlockMatchingBadges(userId, id, { libraryCount: count });
}

/**
 * Après `completeWeeklyChallenge` (Sprint 3 suite), pour chaque
 * participant — "Challenger" au 5ème défi. Compte les `XpEvent`
 * CHALLENGE_COMPLETE, même mécanique que `checkSessionsParticipatedBadges`
 * (le cumul historique compte, pas un état recalculable autrement).
 */
export async function checkChallengeBadges(userId: string, communityId: string | null): Promise<boolean> {
  const id = await statsCommunityIdForSession(communityId);
  const scopedDb = await scopedPrismaForCommunityId(id);
  const count = await scopedDb.xpEvent.count({ where: { communityId: id, userId, reason: "CHALLENGE_COMPLETE" } });
  return unlockMatchingBadges(userId, id, { challengesCompleted: count });
}

/** Après un prono résolu correct (`resolvePronostics`) — "Oracle" à 10 pronos corrects. */
export async function checkPronosticBadges(userId: string, communityId: string | null): Promise<void> {
  const id = await statsCommunityIdForSession(communityId);
  const scopedDb = await scopedPrismaForCommunityId(id);
  const count = await scopedDb.pronostic.count({ where: { voterId: userId, correct: true, ...await durableProgressWhere(id) } });
  await unlockMatchingBadges(userId, id, { pronosticsCorrect: count });
}

/**
 * Après un pari gagné (`resolveBets`) — "High Roller" à 5 paris gagnés, et
 * "All In" au premier pari `allIn` gagné (`stats.allInWin` vaut 1 si CE
 * pari qui vient d'être résolu était `allIn`, 0/absent sinon — pas un
 * cumul, contrairement aux autres critères : un seul pari all-in gagné
 * suffit).
 */
export async function checkBetBadges(userId: string, communityId: string | null): Promise<void> {
  const id = await statsCommunityIdForSession(communityId);
  const scopedDb = await scopedPrismaForCommunityId(id);
  const [betsWonCount, allInWinCount] = await Promise.all([
    scopedDb.xpBet.count({ where: { voterId: userId, won: true, ...await durableProgressWhere(id) } }),
    scopedDb.xpBet.count({ where: { voterId: userId, won: true, allIn: true, ...await durableProgressWhere(id) } }),
  ]);
  await unlockMatchingBadges(userId, id, {
    betsWon: betsWonCount,
    allInWin: allInWinCount > 0 ? 1 : 0,
  });
}

/**
 * Après la fin d'un tournoi (`finalizeTournament`, src/lib/tournaments.ts),
 * pour chaque participant — "Champion de tournoi" (1 victoire) et
 * "Gladiateur" (5 tournois joués, gagnés ou non).
 *
 * Chantier nettoyage réel du stockage (V2, suite) — ni `Tournament` ni
 * `TournamentParticipant` ne survivent à la purge (contrairement à
 * `SessionResult`/`SuperlativeAward`/`Pronostic`/`XpBet`, aucune autre
 * lecture durable n'en dépend — voir le README) : ces deux critères ne
 * peuvent donc plus compter des lignes live.
 *   - `tournamentsWon` — compte les `XpEvent` `TOURNAMENT_RESULT` dont le
 *     `sourceId` finit par `:1st` (posé UNIQUEMENT pour le champion, voir
 *     `announceTournamentFinalization`, tournaments.ts) — déjà durable,
 *     aucun nouveau champ nécessaire.
 *   - `tournamentsParticipated` — `CommunityMemberStats.tournamentsParticipatedCount`,
 *     résumé durable MINIMAL maintenu à l'inscription/désinscription (voir
 *     `registerForTournamentAction`/`unregisterFromTournamentAction`,
 *     tournois/actions.ts) — jamais recalculé par un `count()`.
 */
export async function checkTournamentBadges(userId: string, communityId: string | null): Promise<void> {
  const id = await statsCommunityIdForSession(communityId);
  const scopedDb = await scopedPrismaForCommunityId(id);
  const [won, stats] = await Promise.all([
    scopedDb.xpEvent.count({ where: { communityId: id, userId, reason: "TOURNAMENT_RESULT", sourceId: { endsWith: ":1st" } } }),
    getMemberStats(userId, id),
  ]);
  await unlockMatchingBadges(userId, id, {
    tournamentsWon: won,
    tournamentsParticipated: stats?.tournamentsParticipatedCount ?? 0,
  });
}

/**
 * Critères "temporels" (pas liés à une action ponctuelle) — Marathon /
 * Insomniaque (streak) et Ancien / Vétéran (ancienneté du compte).
 * Appelée depuis `getCurrentUser()`, throttlée là-bas sur le même signal
 * que `touchStreak` (pas de requête supplémentaire à chaque page).
 */
export async function checkTemporalBadges(user: {
  id: string;
  streakCount: number;
  createdAt: Date;
}, communityId: string | null): Promise<void> {
  const id = await statsCommunityIdForSession(communityId);
  const accountAgeDays = Math.floor((Date.now() - user.createdAt.getTime()) / DAY_MS);
  await unlockMatchingBadges(user.id, id, {
    streakCount: user.streakCount,
    accountAgeDays,
  });
}

export async function checkLibraryBadgesForActiveCommunity(userId: string): Promise<void> {
  const communityId = await writeCommunityIdForUser(userId);
  if (communityId !== null) await checkLibraryBadges(userId, communityId);
}
