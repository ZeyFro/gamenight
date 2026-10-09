import type { User } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { touchStreak } from "@/lib/xp-actions";
import { checkTemporalBadges } from "@/lib/badges";
import { getCurrentMemberStats } from "@/lib/member-stats";
import { shouldForceRelogin } from "@/lib/force-relogin";

/**
 * Utilisateur connecté. PR B (multi-communautés) : `xpTotal`, `streakCount`,
 * `streakLastActiveAt` et `bestStreakCount` de l'objet renvoyé sont ceux de la
 * communauté COURANTE de l'utilisateur (`CommunityMemberStats`) et non plus les
 * colonnes héritées de `User` : toutes les pages qui lisent `user.xpTotal` /
 * `user.streakCount` affichent ainsi le solde et le streak du serveur affiché.
 * Sans aucune communauté (isolation allumée), ils valent zéro.
 */
export async function getCurrentUser(): Promise<User | null> {
  const session = await auth();
  if (!session?.user?.discordId) return null;

  const user = await prisma.user.findUnique({
    where: { discordId: session.user.discordId },
  });
  if (!user) return null;

  // Feature "forcer la reconnexion globale" — traite la session comme
  // déconnectée si elle précède le dernier déclenchement (ou si le token
  // n'a pas `sessionCreatedAt` du tout, cas de TOUTES les sessions actives
  // avant ce déploiement : sans lecture possible de leur date de création
  // réelle, on les considère par prudence comme antérieures). Chaque page
  // protégée fait déjà `if (!user) redirect("/")`, donc renvoyer `null`
  // ici suffit à forcer un vrai re-login — aucun cookie à effacer
  // explicitement, pas de table `Session` à purger (JWT sans base).
  if (shouldForceRelogin(user.forceReloginAt, session.user.sessionCreatedAt)) {
    return null;
  }

  // Chantier XP : tient le streak de connexion à jour à chaque page
  // protégée — `touchStreak` throttle lui-même ses écritures (pas de
  // requête supplémentaire tant que < 12h se sont écoulées depuis le
  // dernier passage), donc appelable ici sans coût perf notable.
  // PR B : le streak est celui de la communauté courante.
  const { communityId, stats } = await getCurrentMemberStats(user.id);
  if (communityId === null) {
    return { ...user, xpTotal: 0, streakCount: 0, streakLastActiveAt: null, bestStreakCount: 0 };
  }
  const streak = await touchStreak({ id: user.id, ...stats }, communityId);

  // PR 7/9 — badges "temporels" (streak, ancienneté du compte) : on ne
  // relance le check que si `touchStreak` a réellement écrit cette
  // fois-ci (une vraie nouvelle visite, pas un rechargement de page dans
  // les 12h). Sans ce garde-fou, chaque page protégée ferait une requête
  // badges en plus — négligeable une fois par visite, pas à chaque nav.
  const streakActuallyTouched =
    streak.streakLastActiveAt.getTime() !== (stats.streakLastActiveAt?.getTime() ?? -1);
  if (streakActuallyTouched) {
    await checkTemporalBadges(
      {
        id: user.id,
        streakCount: streak.streakCount,
        createdAt: user.createdAt,
      },
      communityId
    );
  }

  return {
    ...user,
    xpTotal: stats.xpTotal,
    streakCount: streak.streakCount,
    streakLastActiveAt: streak.streakLastActiveAt,
    bestStreakCount: Math.max(stats.bestStreakCount, streak.streakCount),
  };
}
