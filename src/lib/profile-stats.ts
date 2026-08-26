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
 */
export async function getProfileStats(
  userId: string,
  streakCount: number
): Promise<ProfileStats> {
  const [sessionsParticipated, libraryCount, sessionsCreated, superlativesWon] =
    await Promise.all([
      prisma.xpEvent.count({ where: { userId, reason: "PARTICIPATE" } }),
      prisma.userGame.count({ where: { userId, owned: true } }),
      prisma.session.count({ where: { createdById: userId } }),
      prisma.superlativeAward.count({ where: { winnerUserId: userId } }),
    ]);

  return { sessionsParticipated, libraryCount, sessionsCreated, superlativesWon, streakCount };
}

/**
 * Rang global par XP (`#N sur X`), affiché dans l'en-tête du profil
 * (lien cliquable vers `/classement`, PR 9/9). Reste une simple requête
 * de comptage plutôt que de réutiliser `getScoreboard("global")` — cette
 * page n'a besoin que de sa propre position, pas du classement complet
 * de tout le groupe.
 */
export async function getGlobalRank(
  userId: string,
  xpTotal: number
): Promise<{ position: number; total: number }> {
  const [ahead, total] = await Promise.all([
    prisma.user.count({ where: { xpTotal: { gt: xpTotal } } }),
    prisma.user.count(),
  ]);
  return { position: ahead + 1, total };
}
