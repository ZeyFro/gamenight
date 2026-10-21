import type { User } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { touchStreak } from "@/lib/xp-actions";
import { checkTemporalBadges } from "@/lib/badges";
import { writeCommunityIdForUser } from "@/lib/community-stats";
import { getMemberStats, projectUserProgress, ZERO_MEMBER_STATS } from "@/lib/member-stats";
import { shouldForceRelogin } from "@/lib/force-relogin";
import { isAdminUser, parseAdminDiscordIds } from "@/lib/admin-rules";

export async function getCurrentUser(
  options: { recordActivity?: boolean; allowPlatformAdminWithoutMembership?: boolean } = {}
): Promise<User | null> {
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

  const communityId = await writeCommunityIdForUser(user.id);
  if (communityId === null) {
    // Platform administration has its own explicit gate. Do not let its
    // bootstrap identity inherit default-community data or create stats.
    if (!options.allowPlatformAdminWithoutMembership || !isAdminUser(user, parseAdminDiscordIds(process.env.ADMIN_DISCORD_IDS))) {
      return null;
    }
    return projectUserProgress(user, ZERO_MEMBER_STATS);
  }
  // Les lectures de fond (chat, header) ne sont pas une nouvelle visite :
  // aucun verrou, INSERT de stats ou attribution de badge à chaque polling.
  // Le gate JWT/reconnexion et l'appartenance restent relus à chaque appel.
  if (options.recordActivity === false) {
    return projectUserProgress(user, await getMemberStats(user.id, communityId));
  }
  const stats = await touchStreak(user.id, communityId);
  if (stats.touched) {
    await checkTemporalBadges({ id: user.id, streakCount: stats.streakCount, createdAt: user.createdAt }, communityId);
  }
  return projectUserProgress(user, stats);
}
