import { prisma } from "@/lib/prisma";
import { creationMemberUserWhere } from "@/lib/community-isolation";

/**
 * Nombre de membres ACTIFS du serveur affiché, calculé UNE seule fois pour toutes les pages (même filtre que la liste Potes, le
 * calendrier et les bibliothèques : `creationMemberUserWhere`). `members` compte `viewerId` s'il est membre ; `others` est sans lui.
 * Voir `group-stats-rules.ts` pour les définitions affichées.
 */
export async function getGroupMemberCounts(viewerId: string): Promise<{ members: number; others: number }> {
  const where = await creationMemberUserWhere(viewerId);
  const [members, viewerIsMember] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.count({ where: { AND: [where, { id: viewerId }] } }),
  ]);
  return { members, others: Math.max(0, members - viewerIsMember) };
}
