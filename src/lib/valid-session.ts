import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { shouldForceRelogin } from "@/lib/force-relogin";

/**
 * Garde d'authentification légère pour les routes API qui n'ont pas besoin
 * de l'objet `User` complet (contrairement à `getCurrentUser`, voir
 * `src/lib/current-user.ts`) : pas de `touchStreak`/badges déclenchés. La
 * date de révocation et l'adhésion active sont relues en base à chaque appel,
 * sans réutiliser les droits du JWT.
 */
export async function getValidSession() {
  const session = await auth();
  if (!session?.user?.discordId) return null;

  const user = await prisma.user.findUnique({
    where: { discordId: session.user.discordId },
    select: { id: true, forceReloginAt: true },
  });
  if (!user) return null;

  if (shouldForceRelogin(user.forceReloginAt, session.user.sessionCreatedAt)) {
    return null;
  }

  const membership = await prisma.membership.findFirst({
    where: { userId: user.id, status: "ACTIVE", community: { status: "ACTIVE" } },
    select: { id: true },
  });
  if (!membership) return null;

  return session;
}
