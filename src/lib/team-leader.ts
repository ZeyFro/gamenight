import { resolveTeamLeaderId } from "@/lib/team-applications-rules";

const activeMemberWhere = (communityId: string) => ({
  user: { memberships: { some: { communityId, status: "ACTIVE" as const } } },
});

/** Sélection commune pour résoudre le responsable d'une équipe (capitaine actif, sinon membre actif le plus ancien). */
export const leaderSelect = (communityId: string) => ({
  createdById: true, captainId: true,
  createdBy: { select: { memberships: { where: { communityId, status: "ACTIVE" as const }, select: { id: true } } } },
  captain: { select: { memberships: { where: { communityId, status: "ACTIVE" as const }, select: { id: true } } } },
  members: { where: activeMemberWhere(communityId), orderBy: { joinedAt: "asc" as const }, take: 1, select: { userId: true } },
});

type LeaderRow = {
  createdById: string; captainId: string | null;
  createdBy: { memberships: unknown[] }; captain: { memberships: unknown[] } | null; members: { userId: string }[];
};

export function leaderIdOf(team: LeaderRow): string | null {
  return resolveTeamLeaderId({
    captainId: team.captainId, createdById: team.createdById,
    leaderIsActive: team.captainId ? Boolean(team.captain?.memberships.length) : team.createdBy.memberships.length > 0,
    oldestActiveMemberId: team.members[0]?.userId ?? null,
  });
}
