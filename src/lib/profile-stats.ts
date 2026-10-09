import { scopedPrismaForCommunityId } from "@/lib/community-scoped-client";
import { communityMemberUserWhere } from "@/lib/community-isolation";
import { writeCommunityIdForUser } from "@/lib/community-stats";
import { prisma } from "@/lib/prisma";

export interface ProfileStats {
  sessionsParticipated: number;
  libraryCount: number;
  sessionsCreated: number;
  superlativesWon: number;
  streakCount: number;
}

/**
 * Les 5 stats affichées en cartes sur le profil rich (PR 8/9). Formes de
 * requêtes volontairement proches de celles de `src/lib/badges.ts` (même
 * définitions : participation = `XpEvent` PARTICIPATE, etc.) mais PAS
 * mutualisées avec elles — ce sont deux préoccupations différentes
 * (afficher 5 nombres vs. vérifier 15 critères de déblocage), et
 * badges.ts calcule volontairement une seule stat à la fois (déclencheurs
 * ciblés) là où ce fichier a besoin du bundle complet pour une seule page.
 *
 * PR B : les compteurs d'activité (soirées jouées, créées, superlatifs) sont ceux de
 * la communauté COURANTE de l'utilisateur ; sans communauté, tout vaut zéro.
 */
export async function getProfileStats(
  userId: string,
  streakCount: number
): Promise<ProfileStats> {
  const communityId = await writeCommunityIdForUser(userId);
  const libraryCount = await prisma.userGame.count({ where: { userId, owned: true } });
  if (communityId === null) {
    return { sessionsParticipated: 0, libraryCount, sessionsCreated: 0, superlativesWon: 0, streakCount };
  }
  const scopedDb = await scopedPrismaForCommunityId(communityId);
  const [sessionsParticipated, sessionsCreated, superlativesWon] = await Promise.all([
    scopedDb.xpEvent.count({ where: { communityId, userId, reason: "PARTICIPATE" } }),
    // Chantier nettoyage réel du stockage (V2, suite) — même correctif
    // que `checkSessionsCreatedBadges` (src/lib/badges.ts) : compte les
    // `XpEvent` `CREATE_SESSION`, jamais les lignes `Session` (purgeables).
    scopedDb.xpEvent.count({ where: { communityId, userId, reason: "CREATE_SESSION" } }),
    scopedDb.superlativeAward.count({ where: { winnerUserId: userId } }),
  ]);

  return { sessionsParticipated, libraryCount, sessionsCreated, superlativesWon, streakCount };
}

/**
 * Rang global par XP (`#N sur X`), affiché dans l'en-tête du profil
 * (lien cliquable vers `/classement`, PR 9/9). Reste une simple requête
 * de comptage plutôt que de réutiliser `getScoreboard("global")` — cette
 * page n'a besoin que de sa propre position, pas du classement complet
 * de tout le groupe.
 *
 * PR B : rang parmi les membres de la communauté courante, sur leur solde dans
 * cette communauté (`CommunityMemberStats`).
 */
export async function getGlobalRank(
  userId: string,
  xpTotal: number
): Promise<{ position: number; total: number }> {
  const communityId = await writeCommunityIdForUser(userId);
  if (communityId === null) return { position: 1, total: 0 };
  const scopedDb = await scopedPrismaForCommunityId(communityId);
  const members = await communityMemberUserWhere(communityId);
  const [ahead, total] = await Promise.all([
    scopedDb.communityMemberStats.count({ where: { communityId, xpTotal: { gt: xpTotal }, user: members } }),
    prisma.user.count({ where: members }),
  ]);
  return { position: ahead + 1, total };
}
