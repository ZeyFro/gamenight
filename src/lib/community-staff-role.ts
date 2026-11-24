import type { Prisma } from "@prisma/client";
import { isAdminUser, parseAdminDiscordIds } from "@/lib/admin-rules";

/**
 * Rôle EFFECTIF de staff sur un serveur pour les écrans Tower réservés au staff (/admin/tower-propositions, /admin/tower-irregular).
 * Le rôle de communauté (`Membership.role`) vaut MEMBER par défaut : il n'est JAMAIS déduit des permissions Discord (la connexion ne
 * lit que la liste des serveurs, `syncOAuthMemberships`) ; seul un SQL ou une action explicite le change. Un administrateur de
 * l'APPLICATION (`ADMIN_DISCORD_IDS` ou `User.role = ADMIN`) qui est membre ACTIF du serveur est donc traité comme ADMIN du serveur
 * pour ces écrans ; OWNER et ADMIN restent inchangés ; un simple membre reste MEMBER.
 */
export async function effectiveCommunityRole(tx: Prisma.TransactionClient, userId: string, membershipRole: string): Promise<string> {
  if (membershipRole === "OWNER" || membershipRole === "ADMIN") return membershipRole;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { discordId: true, role: true } });
  if (user && isAdminUser(user, parseAdminDiscordIds(process.env.ADMIN_DISCORD_IDS))) return "ADMIN";
  return membershipRole;
}
