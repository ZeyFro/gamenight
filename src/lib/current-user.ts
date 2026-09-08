import type { User } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { touchStreak } from "@/lib/xp-actions";
import { checkTemporalBadges } from "@/lib/badges";

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
  if (user.forceReloginAt) {
    const sessionCreatedAt = session.user.sessionCreatedAt;
    if (!sessionCreatedAt || user.forceReloginAt.getTime() > sessionCreatedAt) {
      return null;
    }
  }

  // Chantier XP : tient le streak de connexion à jour à chaque page
  // protégée — `touchStreak` throttle lui-même ses écritures (pas de
  // requête supplémentaire tant que < 12h se sont écoulées depuis le
  // dernier passage), donc appelable ici sans coût perf notable.
  const streak = await touchStreak(user);

  // PR 7/9 — badges "temporels" (streak, ancienneté du compte) : on ne
  // relance le check que si `touchStreak` a réellement écrit cette
  // fois-ci (une vraie nouvelle visite, pas un rechargement de page dans
  // les 12h). Sans ce garde-fou, chaque page protégée ferait une requête
  // badges en plus — négligeable une fois par visite, pas à chaque nav.
  const streakActuallyTouched =
    streak.streakLastActiveAt.getTime() !== (user.streakLastActiveAt?.getTime() ?? -1);
  if (streakActuallyTouched) {
    await checkTemporalBadges({
      id: user.id,
      streakCount: streak.streakCount,
      createdAt: user.createdAt,
    });
  }

  return { ...user, ...streak };
}
