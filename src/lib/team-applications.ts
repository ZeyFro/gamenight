import { Prisma } from "@prisma/client";
import { getScopedPrisma, scopedPrisma, scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { getCommunityTeamsCommunityId, joinCommunityTeam } from "@/lib/community-teams";
import { prisma } from "@/lib/prisma";
import { isTeamApplicationsEnabled, teamApplicationBlock, type ApplyBlock } from "@/lib/team-applications-rules";
import { isTeamRecruitersEnabled } from "@/lib/team-recruiters-rules";
import { leaderIdOf, leaderSelect } from "@/lib/team-leader";
import { requestTeamSpaceMemberSync } from "@/lib/discord-team-space-hooks";

const activeMemberWhere = (communityId: string) => ({
  user: { memberships: { some: { communityId, status: "ACTIVE" as const } } },
});

/** Communauté active de l'utilisateur si le drapeau, les équipes et son appartenance l'autorisent. */
export async function getTeamApplicationsCommunityId(userId: string): Promise<string | null> {
  if (!isTeamApplicationsEnabled()) return null;
  return getCommunityTeamsCommunityId(userId);
}

async function canUse(tx: Prisma.TransactionClient, userId: string, communityId: string): Promise<boolean> {
  const [membership, community] = await Promise.all([
    tx.membership.findUnique({ where: { communityId_userId: { communityId, userId } }, select: { status: true } }),
    tx.community.findUnique({ where: { id: communityId }, select: { status: true, communityTeamsEnabled: true } }),
  ]);
  return membership?.status === "ACTIVE" && community?.status === "ACTIVE" && community.communityTeamsEnabled;
}

async function serializable<T>(run: () => Promise<T>): Promise<T> {
  for (let retry = 0; ; retry++) {
    try {
      return await run();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && retry === 0) continue;
      throw error;
    }
  }
}

export type ApplyResult = "applied" | ApplyBlock | "missing" | "unavailable";

export async function applyToTeam(userId: string, communityId: string, input: { teamId: string; message: string }): Promise<ApplyResult> {
  if (await getTeamApplicationsCommunityId(userId) !== communityId) return "unavailable";
  return serializable(() => prisma.$transaction(async (tx) => {
    if (!await canUse(tx, userId, communityId)) return "unavailable";
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    const team = await scopedDb.communityTeam.findFirst({
      where: { id: input.teamId, communityId },
      select: { isRecruiting: true, maxMembers: true },
    });
    if (!team) return "missing";
    const [member, activeMembers, existing] = await Promise.all([
      scopedDb.communityTeamMember.findUnique({ where: { teamId_userId: { teamId: input.teamId, userId } }, select: { id: true } }),
      scopedDb.communityTeamMember.count({ where: { teamId: input.teamId, communityId, ...activeMemberWhere(communityId) } }),
      scopedDb.teamApplication.findUnique({ where: { teamId_applicantId: { teamId: input.teamId, applicantId: userId } }, select: { status: true } }),
    ]);
    const block = teamApplicationBlock({
      isMember: Boolean(member), isRecruiting: team.isRecruiting, activeMembers, maxMembers: team.maxMembers,
      existingStatus: existing?.status ?? null,
    });
    if (block) return block;
    if (existing) {
      await scopedDb.teamApplication.update({
        where: { teamId_applicantId: { teamId: input.teamId, applicantId: userId } },
        data: { message: input.message, status: "PENDING", createdAt: new Date(), decidedAt: null, decidedById: null, ...(isTeamRecruitersEnabled() ? { reminderSentAt: null } : {}) },
      });
    } else {
      await scopedDb.teamApplication.create({ data: { communityId, teamId: input.teamId, applicantId: userId, message: input.message } });
    }
    return "applied";
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
}

export async function withdrawTeamApplication(userId: string, communityId: string, applicationId: string): Promise<"withdrawn" | "missing" | "unavailable"> {
  if (await getTeamApplicationsCommunityId(userId) !== communityId) return "unavailable";
  const scopedDb = await getScopedPrisma(userId);
  const updated = await scopedDb.teamApplication.updateMany({
    where: { id: applicationId, communityId, applicantId: userId, status: "PENDING" },
    data: { status: "WITHDRAWN", decidedAt: new Date(), decidedById: userId },
  });
  return updated.count ? "withdrawn" : "missing";
}

export type DecideResult = "accepted" | "declined" | "closed" | "full" | "already_team" | "cooldown" | "missing" | "forbidden" | "unavailable";

/** Le recruteur nommé décide au même titre que le capitaine, seulement s'il est toujours membre actif de l'équipe. */
async function isActiveRecruiter(communityId: string, teamId: string, userId: string): Promise<boolean> {
  if (!isTeamRecruitersEnabled()) return false;
  const scopedDb = scopedPrisma({ communityIds: [communityId], includesDefault: false });
  const row = await scopedDb.communityTeamRecruiter.findFirst({
    where: {
      teamId, communityId, userId,
      user: { memberships: { some: { communityId, status: "ACTIVE" } }, communityTeamMemberships: { some: { teamId } } },
    },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * Le responsable (ou, avec TEAM_RECRUITERS_ENABLED, un recruteur nommé) accepte ou refuse une candidature en
 * attente. L'acceptation passe par `joinCommunityTeam` (mêmes règles d'adhésion que l'inscription directe :
 * recrutement ouvert, place libre sous transaction sérialisable donc jamais plus de 8, règles d'équipe en
 * vigueur) ; la candidature reste en attente si l'adhésion échoue. Après une acceptation, l'accès à l'espace
 * Discord de l'équipe est demandé à la file (no-op sans les verrous).
 */
export async function decideTeamApplication(userId: string, communityId: string, applicationId: string, accept: boolean): Promise<DecideResult> {
  if (await getTeamApplicationsCommunityId(userId) !== communityId) return "unavailable";
  const scopedDb = await getScopedPrisma(userId);
  const application = await scopedDb.teamApplication.findFirst({
    where: { id: applicationId, communityId, status: "PENDING" },
    select: { teamId: true, applicantId: true, applicant: { select: { discordId: true } }, team: { select: leaderSelect(communityId) } },
  });
  if (!application) return "missing";
  if (leaderIdOf(application.team) !== userId && !await isActiveRecruiter(communityId, application.teamId, userId)) return "forbidden";
  if (accept) {
    const joined = await joinCommunityTeam(application.applicantId, communityId, application.teamId);
    if (joined === "closed" || joined === "full" || joined === "already_team" || joined === "cooldown") return joined;
    if (joined === "missing" || joined === "unavailable") return "unavailable";
  }
  const updated = await scopedDb.teamApplication.updateMany({
    where: { id: applicationId, communityId, status: "PENDING" },
    data: { status: accept ? "ACCEPTED" : "DECLINED", decidedAt: new Date(), decidedById: userId },
  });
  if (!updated.count) return "missing";
  if (accept) await requestTeamSpaceMemberSync({ communityId, teamId: application.teamId, discordId: application.applicant.discordId });
  return accept ? "accepted" : "declined";
}

/** Candidatures en attente sur les équipes dont l'utilisateur est le responsable ou un recruteur nommé. */
export async function listPendingApplicationsForLeader(userId: string, communityId: string) {
  if (await getTeamApplicationsCommunityId(userId) !== communityId) return [];
  const scopedDb = await getScopedPrisma(userId);
  const teams = await scopedDb.communityTeam.findMany({
    where: { communityId },
    select: { id: true, ...leaderSelect(communityId) },
  });
  const teamIds = new Set(teams.filter(team => leaderIdOf(team) === userId).map(team => team.id));
  if (isTeamRecruitersEnabled()) {
    const recruiterRows = await scopedDb.communityTeamRecruiter.findMany({
      where: { communityId, userId, user: { memberships: { some: { communityId, status: "ACTIVE" } } } },
      select: { teamId: true, user: { select: { communityTeamMemberships: { select: { teamId: true } } } } },
    });
    for (const row of recruiterRows) if (row.user.communityTeamMemberships.some(member => member.teamId === row.teamId)) teamIds.add(row.teamId);
  }
  if (!teamIds.size) return [];
  return scopedDb.teamApplication.findMany({
    where: { communityId, teamId: { in: [...teamIds] }, status: "PENDING", applicant: { memberships: { some: { communityId, status: "ACTIVE" } } } },
    select: { id: true, message: true, createdAt: true, team: { select: { name: true } }, applicant: { select: { discordName: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/** Candidatures de l'utilisateur, les plus récentes d'abord. */
export async function listMyTeamApplications(userId: string, communityId: string) {
  if (await getTeamApplicationsCommunityId(userId) !== communityId) return [];
  const scopedDb = await getScopedPrisma(userId);
  return scopedDb.teamApplication.findMany({
    where: { communityId, applicantId: userId },
    select: { id: true, teamId: true, status: true, message: true, createdAt: true, team: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}
