import type { Badge } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { awardXp, isUniqueConstraintViolation } from "@/lib/xp-actions";
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
  | { type: "CHALLENGES_COMPLETED"; count: number };

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
}

const STAT_KEY_FOR_CRITERIA_TYPE: Record<BadgeCriteria["type"], keyof BadgeStats> = {
  SESSIONS_CREATED: "sessionsCreated",
  SESSIONS_PARTICIPATED: "sessionsParticipated",
  VOTES_CAST: "votesCast",
  SUPERLATIVES_WON: "superlativesWon",
  LIBRARY_SIZE: "libraryCount",
  STREAK_DAYS: "streakCount",
  ACCOUNT_AGE_DAYS: "accountAgeDays",
  CHALLENGES_COMPLETED: "challengesCompleted",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Débloque tous les badges (parmi ceux pas encore obtenus) dont le
 * critère est satisfait par `stats` — ne regarde que les types de
 * critère présents dans `stats` (les autres badges sont ignorés cette
 * fois-ci, pas "jamais" : un futur appel avec les bonnes stats les
 * check era). Idempotent : `unlockBadge` retombe silencieusement sur la
 * contrainte unique `@@unique([userId, badgeId])` en cas de course.
 *
 * Retourne `true` si au moins un badge a été débloqué (Sprint 2 PR-B,
 * U9 — confettis `?celebrate=badge` sur les appelants qui redirigent
 * vers une page vue par ce même user, ex. `createSession`).
 */
async function unlockMatchingBadges(userId: string, stats: BadgeStats): Promise<boolean> {
  const [alreadyUnlocked, badges] = await Promise.all([
    prisma.userBadge.findMany({ where: { userId }, select: { badgeId: true } }),
    prisma.badge.findMany({ where: { active: true } }),
  ]);
  const unlockedIds = new Set(alreadyUnlocked.map((b) => b.badgeId));

  let unlockedAny = false;
  for (const badge of badges) {
    if (unlockedIds.has(badge.id)) continue;

    const criteria = badge.criteria as unknown as BadgeCriteria;
    const key = STAT_KEY_FOR_CRITERIA_TYPE[criteria.type];
    const value = stats[key];
    if (value === undefined || value < criteria.count) continue;

    const unlocked = await unlockBadge(userId, badge);
    if (unlocked) unlockedAny = true;
  }
  return unlockedAny;
}

async function unlockBadge(userId: string, badge: Badge): Promise<boolean> {
  try {
    await prisma.userBadge.create({ data: { userId, badgeId: badge.id } });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) return false;
    throw error;
  }

  if (badge.xpReward) {
    await awardXp(userId, "BADGE_UNLOCKED", badge.id, badge.xpReward);
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user) await announceBadgeUnlocked(user, badge);
  // Notification in-app (Sprint 2 PR-C, U3) — même événement que le
  // webhook Discord ci-dessus, écrit en parallèle.
  await createNotification({
    userId,
    type: "BADGE",
    title: `${badge.icon} ${badge.name}`,
    message: badge.description,
    relatedBadgeId: badge.id,
  });
  return true;
}

/** Après `createSession` — First Blood / Meneur / Community leader. */
export async function checkSessionsCreatedBadges(userId: string): Promise<boolean> {
  const count = await prisma.session.count({ where: { createdById: userId } });
  return unlockMatchingBadges(userId, { sessionsCreated: count });
}

/**
 * Après la clôture d'une session, pour chaque voteur de la proposition
 * gagnante — Habitué / GOAT / LÉGENDE. Compte les `XpEvent` PARTICIPATE
 * plutôt que de recalculer "présent à combien de soirées" à la main :
 * c'est exactement la même définition de présence déjà utilisée partout
 * dans le chantier XP, et déjà backfillée pour l'historique.
 */
export async function checkSessionsParticipatedBadges(userId: string): Promise<void> {
  const count = await prisma.xpEvent.count({ where: { userId, reason: "PARTICIPATE" } });
  await unlockMatchingBadges(userId, { sessionsParticipated: count });
}

/**
 * Après un nouveau vote (pas un dévote) — Citoyen. Compte les `XpEvent`
 * VOTE (un par proposition votée une fois dans sa vie) plutôt que les
 * lignes `Vote` actuelles : un badge ne doit pas redevenir verrouillé
 * parce qu'on a retiré un vote entre-temps, seul le cumul historique
 * compte.
 */
export async function checkVotesCastBadges(userId: string): Promise<void> {
  const count = await prisma.xpEvent.count({ where: { userId, reason: "VOTE" } });
  await unlockMatchingBadges(userId, { votesCast: count });
}

/** Après l'attribution d'un award de superlatif — Compétiteur / Star. */
export async function checkSuperlativesWonBadges(userId: string): Promise<void> {
  const count = await prisma.superlativeAward.count({ where: { winnerUserId: userId } });
  await unlockMatchingBadges(userId, { superlativesWon: count });
}

/** Après l'ajout d'un jeu (manuel ou import Steam) — Bibliophile / Collectionneur. */
export async function checkLibraryBadges(userId: string): Promise<void> {
  const count = await prisma.userGame.count({ where: { userId, owned: true } });
  await unlockMatchingBadges(userId, { libraryCount: count });
}

/**
 * Après `completeWeeklyChallenge` (Sprint 3 suite), pour chaque
 * participant — "Challenger" au 5ème défi. Compte les `XpEvent`
 * CHALLENGE_COMPLETE, même mécanique que `checkSessionsParticipatedBadges`
 * (le cumul historique compte, pas un état recalculable autrement).
 */
export async function checkChallengeBadges(userId: string): Promise<boolean> {
  const count = await prisma.xpEvent.count({ where: { userId, reason: "CHALLENGE_COMPLETE" } });
  return unlockMatchingBadges(userId, { challengesCompleted: count });
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
}): Promise<void> {
  const accountAgeDays = Math.floor((Date.now() - user.createdAt.getTime()) / DAY_MS);
  await unlockMatchingBadges(user.id, {
    streakCount: user.streakCount,
    accountAgeDays,
  });
}
