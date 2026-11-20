import { scopedPrisma } from "@/lib/community-scoped-client";
import { logger } from "@/lib/logger";
import { leaderIdOf, leaderSelect } from "@/lib/team-leader";
import { enqueueTeamApplicationNotice } from "@/lib/team-application-notify";
import { isTeamRecruitersEnabled } from "@/lib/team-recruiters-rules";

/**
 * Destinataires des MP d'une candidature : le responsable et, avec TEAM_RECRUITERS_ENABLED, les recruteurs nommés
 * encore membres actifs de l'équipe. Les autres membres ne sont jamais prévenus.
 */
export async function listApplicationApproverIds(communityId: string, teamId: string): Promise<string[]> {
  const scopedDb = scopedPrisma({ communityIds: [communityId], includesDefault: false });
  const team = await scopedDb.communityTeam.findFirst({ where: { id: teamId, communityId }, select: leaderSelect(communityId) });
  if (!team) return [];
  const ids = new Set<string>();
  const leaderId = leaderIdOf(team);
  if (leaderId) ids.add(leaderId);
  if (isTeamRecruitersEnabled()) {
    const recruiters = await scopedDb.communityTeamRecruiter.findMany({
      where: { teamId, communityId, user: { memberships: { some: { communityId, status: "ACTIVE" } } } },
      select: { userId: true, user: { select: { communityTeamMemberships: { where: { teamId }, select: { id: true }, take: 1 } } } },
    });
    for (const row of recruiters) if (row.user.communityTeamMemberships.length) ids.add(row.userId);
  }
  return [...ids];
}

/** Après un dépôt réussi : MP au responsable et aux recruteurs (jamais bloquant, no-op sans les verrous). */
export async function notifyApproversOfApplication(communityId: string, teamId: string, applicantId: string): Promise<void> {
  if (!isTeamRecruitersEnabled()) return;
  try {
    const scopedDb = scopedPrisma({ communityIds: [communityId], includesDefault: false });
    const application = await scopedDb.teamApplication.findUnique({
      where: { teamId_applicantId: { teamId, applicantId } }, select: { id: true, status: true, createdAt: true },
    });
    if (application?.status !== "PENDING") return;
    const recipientIds = (await listApplicationApproverIds(communityId, teamId)).filter((id) => id !== applicantId);
    await enqueueTeamApplicationNotice({ communityId, teamId, applicationId: application.id, kind: "new", createdAt: application.createdAt, recipientIds });
  } catch (error) {
    logger.warn("team-applications", "Prévenir les décideurs d'une candidature a échoué.", { errorType: error instanceof Error ? error.name : "unknown" });
  }
}
