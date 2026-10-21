import type { User } from "@prisma/client";
import { getCurrentUser } from "@/lib/current-user";
import { isAdminUser, parseAdminDiscordIds } from "@/lib/admin-rules";

export { isAdminUser, parseAdminDiscordIds } from "@/lib/admin-rules";

/**
 * Accès admin (PR "Accès & secrets") — jusqu'ici `getCurrentUser()` suffisait
 * pour appeler n'importe quelle action/page d'administration (/admin) :
 * n'importe quel pote connecté pouvait supprimer un badge, désactiver un
 * message Discord, ou déclencher la reconnexion forcée globale. `requireAdmin`
 * remplace `getCurrentUser` à l'identique (même contrat `Promise<User | null>`,
 * même garde `if (!admin) redirect("/")` côté appelant) dans les 19
 * fonctions/pages listées dans la reconnaissance de cette PR.
 *
 * Deux mécanismes, l'un ne remplaçant jamais l'autre (logique de décision
 * dans `src/lib/admin-rules.ts`, testable sans dépendre de next-auth) :
 * - `ADMIN_DISCORD_IDS` (env, CSV de discordId) — bootstrap : garantit un
 *   accès admin dès le premier déploiement, avant même la première
 *   connexion, sans dépendre d'une ligne en base.
 * - `User.role` (base, `UserRole.ADMIN`) — modifiable ensuite sans
 *   redéploiement pour ajouter/retirer des admins.
 */
export async function requireAdmin(): Promise<User | null> {
  const user = await getCurrentUser({ allowPlatformAdminWithoutMembership: true });
  if (!user) return null;
  const adminIds = parseAdminDiscordIds(process.env.ADMIN_DISCORD_IDS);
  return isAdminUser(user, adminIds) ? user : null;
}
