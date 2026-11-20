import { Prisma } from "@prisma/client";
import { getScopedPrisma, scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { getCommunityTeamsCommunityId } from "@/lib/community-teams";
import { prisma } from "@/lib/prisma";
import { resolveTeamLeaderId } from "@/lib/team-applications-rules";
import {
  isEmptyTeamCriteria,
  isTeamRecruitmentCriteriaEnabled,
  type TeamRecruitmentCriteriaInput,
  type TeamRecruitmentCriteriaView,
} from "@/lib/team-recruitment-criteria-rules";

const activeMemberWhere = (communityId: string) => ({
  user: { memberships: { some: { communityId, status: "ACTIVE" as const } } },
});

/** Communauté active de l'utilisateur si le drapeau, les équipes et son appartenance l'autorisent. */
export async function getTeamRecruitmentCriteriaCommunityId(userId: string): Promise<string | null> {
  if (!isTeamRecruitmentCriteriaEnabled()) return null;
  return getCommunityTeamsCommunityId(userId);
}

export type SaveCriteriaResult = "saved" | "cleared" | "missing" | "forbidden" | "unavailable";

/**
 * Le responsable (capitaine actif, à défaut le créateur, à défaut le plus ancien membre actif) enregistre les
 * objectifs et critères de son équipe. Tout vide supprime la ligne. Aucune notification.
 */
export async function saveTeamRecruitmentCriteria(
  userId: string, communityId: string, input: TeamRecruitmentCriteriaInput,
): Promise<SaveCriteriaResult> {
  if (await getTeamRecruitmentCriteriaCommunityId(userId) !== communityId) return "unavailable";
  const attempt = () => prisma.$transaction(async (tx) => {
    const [membership, community] = await Promise.all([
      tx.membership.findUnique({ where: { communityId_userId: { communityId, userId } }, select: { status: true } }),
      tx.community.findUnique({ where: { id: communityId }, select: { status: true, communityTeamsEnabled: true } }),
    ]);
    if (membership?.status !== "ACTIVE" || community?.status !== "ACTIVE" || !community.communityTeamsEnabled) return "unavailable" as const;
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    const team = await scopedDb.communityTeam.findFirst({
      where: { id: input.teamId, communityId },
      select: {
        createdById: true, captainId: true,
        createdBy: { select: { memberships: { where: { communityId, status: "ACTIVE" }, select: { id: true } } } },
        captain: { select: { memberships: { where: { communityId, status: "ACTIVE" }, select: { id: true } } } },
        members: { where: activeMemberWhere(communityId), orderBy: { joinedAt: "asc" }, take: 1, select: { userId: true } },
      },
    });
    if (!team) return "missing" as const;
    const leaderId = resolveTeamLeaderId({
      captainId: team.captainId, createdById: team.createdById,
      leaderIsActive: team.captainId ? Boolean(team.captain?.memberships.length) : team.createdBy.memberships.length > 0,
      oldestActiveMemberId: team.members[0]?.userId ?? null,
    });
    if (leaderId !== userId) return "forbidden" as const;

    const data = { goals: input.goals, minLevel: input.minLevel, mic: input.mic, slots: input.slots, platforms: input.platforms, note: input.note };
    if (isEmptyTeamCriteria(data)) {
      await scopedDb.teamRecruitmentCriteria.deleteMany({ where: { teamId: input.teamId, communityId } });
      return "cleared" as const;
    }
    const updated = await scopedDb.teamRecruitmentCriteria.updateMany({ where: { teamId: input.teamId, communityId }, data });
    if (!updated.count) await scopedDb.teamRecruitmentCriteria.create({ data: { teamId: input.teamId, communityId, ...data } });
    await scopedDb.communityTeam.updateMany({ where: { id: input.teamId, communityId }, data: { captainLastActivityAt: new Date() } });
    return "saved" as const;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  for (let retry = 0; ; retry++) {
    try {
      return await attempt();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && retry === 0) continue;
      throw error;
    }
  }
}

/**
 * Critères des équipes données, par identifiant d'équipe. Vide (sans requête) quand le drapeau est éteint ou
 * que l'utilisateur n'est pas membre actif d'une communauté avec équipes : la table n'est alors jamais lue.
 */
export async function listTeamRecruitmentCriteria(
  userId: string, communityId: string, teamIds: string[],
): Promise<Map<string, TeamRecruitmentCriteriaView>> {
  const result = new Map<string, TeamRecruitmentCriteriaView>();
  if (!teamIds.length || await getTeamRecruitmentCriteriaCommunityId(userId) !== communityId) return result;
  const scopedDb = await getScopedPrisma(userId);
  const rows = await scopedDb.teamRecruitmentCriteria.findMany({
    where: { communityId, teamId: { in: teamIds } },
    select: { teamId: true, goals: true, minLevel: true, mic: true, slots: true, platforms: true, note: true },
  });
  for (const { teamId, minLevel, ...rest } of rows) {
    const criteria = { ...rest, minLevel: (minLevel ?? null) as TeamRecruitmentCriteriaView["minLevel"] };
    if (!isEmptyTeamCriteria(criteria)) result.set(teamId, criteria);
  }
  return result;
}
