import { prisma } from "@/lib/prisma";
import { scopedPrisma } from "@/lib/community-scoped-client";
import { requestTeamSpaceMemberSync } from "@/lib/discord-team-space-hooks";
import { listApplicationApproverIds } from "@/lib/team-application-approvers";
import { enqueueTeamApplicationNotice } from "@/lib/team-application-notify";
import { applicationLifecycleStep, APPLICATION_REMINDER_AFTER_MS } from "@/lib/team-recruiters-rules";

const BATCH = 100;
const ACCESS_BATCH = 50;

export interface TeamApplicationLifecycleReport {
  communities: number;
  reminded: number;
  expired: number;
  accessRequests: number;
}

/**
 * Entretien des candidatures (TEAM_RECRUITERS_ENABLED), déclenché par un cron authentifié, jamais par une lecture de page.
 * - relance UNIQUE au responsable et aux recruteurs 48 h après le dépôt (MP via la file) ;
 * - expiration à 7 jours (statut EXPIRED, aucune pénalité : le candidat peut repostuler) ;
 * - accès Discord : demande de retrait du rôle d'équipe pour les membres dont l'appartenance au serveur n'est plus ACTIVE
 *   (départ du serveur, retrait administratif). Idempotent côté file (fenêtre de 10 minutes) ; aucun appel Discord ici.
 * Idempotent : un passage répété ne relance ni n'expire deux fois. Les gardes d'état (statut PENDING, `createdAt`
 * inchangé) évitent d'écraser une candidature décidée ou renvoyée entre la lecture et l'écriture.
 */
export async function runTeamApplicationLifecycle(now: Date = new Date()): Promise<TeamApplicationLifecycleReport> {
  const report: TeamApplicationLifecycleReport = { communities: 0, reminded: 0, expired: 0, accessRequests: 0 };
  const communities = await prisma.community.findMany({
    where: { status: "ACTIVE", communityTeamsEnabled: true }, select: { id: true }, orderBy: { id: "asc" },
  });
  for (const { id: communityId } of communities) {
    report.communities += 1;
    const scopedDb = scopedPrisma({ communityIds: [communityId], includesDefault: false });
    const pending = await scopedDb.teamApplication.findMany({
      where: { communityId, status: "PENDING", createdAt: { lte: new Date(now.getTime() - APPLICATION_REMINDER_AFTER_MS) } },
      select: { id: true, teamId: true, applicantId: true, createdAt: true, reminderSentAt: true },
      orderBy: { createdAt: "asc" },
      take: BATCH,
    });
    for (const application of pending) {
      const step = applicationLifecycleStep(application, now);
      if (step === "expire") {
        const updated = await scopedDb.teamApplication.updateMany({
          where: { id: application.id, communityId, status: "PENDING", createdAt: application.createdAt },
          data: { status: "EXPIRED", decidedAt: now },
        });
        report.expired += updated.count;
      } else if (step === "remind") {
        const recipientIds = (await listApplicationApproverIds(communityId, application.teamId)).filter((id) => id !== application.applicantId);
        const queued = await enqueueTeamApplicationNotice({
          communityId, teamId: application.teamId, applicationId: application.id, kind: "reminder", createdAt: application.createdAt, recipientIds,
        });
        // File éteinte : la relance n'est pas consommée, elle partira quand la file sera active (avant l'expiration).
        if (queued === "disabled") continue;
        const updated = await scopedDb.teamApplication.updateMany({
          where: { id: application.id, communityId, status: "PENDING", createdAt: application.createdAt, reminderSentAt: null },
          data: { reminderSentAt: now },
        });
        report.reminded += updated.count;
      }
    }
    const stale = await scopedDb.communityTeamMember.findMany({
      where: {
        communityId,
        team: { discordSpaces: { some: {} } },
        user: { memberships: { none: { communityId, status: "ACTIVE" } } },
      },
      select: { teamId: true, user: { select: { discordId: true } } },
      orderBy: { joinedAt: "asc" },
      take: ACCESS_BATCH,
    });
    for (const member of stale) {
      await requestTeamSpaceMemberSync({ communityId, teamId: member.teamId, discordId: member.user.discordId });
      report.accessRequests += 1;
    }
  }
  return report;
}
