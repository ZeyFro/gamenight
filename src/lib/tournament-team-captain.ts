import { resolveTeamLeaderId } from "@/lib/team-applications-rules";

/**
 * Capitaine d'une équipe pour un tournoi : le capitaine (`captainId`, à défaut le créateur) tant qu'il est membre actif de la
 * communauté, sinon le membre actif le plus ancien (même règle que les candidatures, `team-applications-rules.ts`).
 */
export const captainSelect = (communityId: string) => ({
  createdById: true, captainId: true,
  createdBy: { select: { memberships: { where: { communityId, status: "ACTIVE" as const }, select: { id: true } } } },
  captain: { select: { memberships: { where: { communityId, status: "ACTIVE" as const }, select: { id: true } } } },
  members: {
    where: { user: { memberships: { some: { communityId, status: "ACTIVE" as const } } } },
    orderBy: { joinedAt: "asc" as const }, take: 1, select: { userId: true },
  },
});

type CaptainRow = {
  createdById: string; captainId: string | null;
  createdBy: { memberships: unknown[] }; captain: { memberships: unknown[] } | null; members: { userId: string }[];
};

export function captainIdOf(team: CaptainRow): string | null {
  return resolveTeamLeaderId({
    captainId: team.captainId, createdById: team.createdById,
    leaderIsActive: team.captainId ? Boolean(team.captain?.memberships.length) : team.createdBy.memberships.length > 0,
    oldestActiveMemberId: team.members[0]?.userId ?? null,
  });
}
