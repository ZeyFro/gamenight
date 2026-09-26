import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { shouldForceRelogin } from "@/lib/force-relogin";

/**
 * Garde d'authentification légère pour les routes API qui n'ont pas besoin
 * de l'objet `User` complet (contrairement à `getCurrentUser`, voir
 * `src/lib/current-user.ts`) : pas de `touchStreak`/badges déclenchés, et
 * une seule colonne lue en base (`forceReloginAt`) plutôt que toute la
 * ligne `User`. Nécessaire pour `igdb/search` (appelée à chaque frappe) et
 * les routes Steam link/callback, qui contournaient jusqu'ici la
 * reconnexion forcée globale en appelant `auth()` directement.
 */
export async function getValidSession() {
  const session = await auth();
  if (!session?.user?.discordId) return null;

  const user = await prisma.user.findUnique({
    where: { discordId: session.user.discordId },
    select: { forceReloginAt: true },
  });
  if (!user) return null;

  if (shouldForceRelogin(user.forceReloginAt, session.user.sessionCreatedAt)) {
    return null;
  }

  return session;
}
