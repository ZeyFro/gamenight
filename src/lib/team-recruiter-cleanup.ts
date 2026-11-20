import type { Prisma } from "@prisma/client";
import { scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { isTeamRecruitersEnabled } from "@/lib/team-recruiters-rules";

/**
 * Retire les rôles de recruteur d'un joueur (départ) ou de toute l'équipe (dissolution), dans la transaction de l'appelant.
 * No-op sans TEAM_RECRUITERS_ENABLED : la table ajoutée par la migration `team_recruiters_guest` n'est alors jamais lue.
 */
export async function clearTeamRecruiterRoles(tx: Prisma.TransactionClient, communityId: string, teamId: string, userId?: string): Promise<void> {
  if (!isTeamRecruitersEnabled()) return;
  const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
  await scopedDb.communityTeamRecruiter.deleteMany({ where: { teamId, communityId, ...(userId ? { userId } : {}) } });
}
