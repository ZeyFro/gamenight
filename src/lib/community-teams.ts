import { Prisma } from "@prisma/client";
import { findActiveMembership } from "@/lib/community-access";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { getScopedPrisma, scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { accessibleSessionWhereFor } from "@/lib/session-access";
import { DEFAULT_COMMUNITY_SLUG } from "@/lib/default-community";
import { prisma } from "@/lib/prisma";

export async function getCommunityTeamsCommunityId(userId: string): Promise<string | null> {
  const communityId = await resolveActiveCommunityId(userId);
  if (!communityId) return null;
  const membership = await findActiveMembership(userId, communityId);
  return membership?.community.communityTeamsEnabled ? communityId : null;
}

const activeTeamMemberWhere = (communityId: string) => ({
  user: { memberships: { some: { communityId, status: "ACTIVE" as const } } },
});

async function canUseTeams(tx: Prisma.TransactionClient, userId: string, communityId: string): Promise<boolean> {
  const [membership, community] = await Promise.all([
    tx.membership.findUnique({ where: { communityId_userId: { communityId, userId } }, select: { status: true } }),
    tx.community.findUnique({ where: { id: communityId }, select: { status: true, communityTeamsEnabled: true } }),
  ]);
  return membership?.status === "ACTIVE" && community?.status === "ACTIVE" && community.communityTeamsEnabled;
}

export async function listCommunityTeams(userId: string, communityId: string) {
  const scopedDb = await getScopedPrisma(userId);
  const accessibleSessions = await accessibleSessionWhereFor(userId);
  return scopedDb.communityTeam.findMany({
    where: { communityId },
    select: {
      id: true,
      name: true,
      description: true,
      platform: true,
      maxMembers: true,
      isRecruiting: true,
      createdById: true,
      _count: { select: { members: { where: activeTeamMemberWhere(communityId) } } },
      game: { select: { name: true } },
      createdBy: { select: { discordName: true, memberships: { where: { communityId, status: "ACTIVE" }, select: { id: true } } } },
      members: { where: activeTeamMemberWhere(communityId), select: { userId: true, joinedAt: true, user: { select: { discordName: true } } }, orderBy: { joinedAt: "asc" } },
      sessions: {
        where: { AND: [accessibleSessions, { status: { in: ["VOTING", "SCHEDULED"] }, date: { gte: new Date() } }] },
        select: { id: true, date: true, status: true, decidedGame: { select: { name: true } } },
        orderBy: { date: "asc" },
      },
    },
    orderBy: [{ isRecruiting: "desc" }, { createdAt: "desc" }],
  });
}

export async function listMemberCommunityTeamOptions(userId: string, communityId: string) {
  if (await getCommunityTeamsCommunityId(userId) !== communityId) return [];
  const scopedDb = await getScopedPrisma(userId);
  return scopedDb.communityTeam.findMany({
    where: {
      communityId,
      members: { some: { userId, ...activeTeamMemberWhere(communityId) } },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function canAttachSessionToTeam(userId: string, teamId: string, communityId: string): Promise<boolean> {
  if (await getCommunityTeamsCommunityId(userId) !== communityId) return false;
  const scopedDb = await getScopedPrisma(userId);
  const team = await scopedDb.communityTeam.findFirst({
    where: {
      id: teamId,
      communityId,
      members: { some: { userId, ...activeTeamMemberWhere(communityId) } },
    },
    select: { id: true },
  });
  return Boolean(team);
}

export async function assertSessionTeamLinkInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  teamId: string,
  sessionCommunityId: string | null,
): Promise<void> {
  const defaultCommunity = sessionCommunityId ? null : await tx.community.findUnique({
    where: { slug: DEFAULT_COMMUNITY_SLUG }, select: { id: true },
  });
  const communityId = sessionCommunityId ?? defaultCommunity?.id;
  if (!communityId) throw new Error("invalid_session_team_link");
  const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
  const team = await scopedDb.communityTeam.findFirst({
    where: {
      id: teamId,
      communityId,
      community: { status: "ACTIVE", communityTeamsEnabled: true },
      members: { some: { userId, communityId, user: { memberships: { some: { communityId, status: "ACTIVE" } } } } },
    },
    select: { id: true },
  });
  if (!team) throw new Error("invalid_session_team_link");
}

export type TeamInput = {
  userId: string;
  communityId: string;
  gameId: string;
  name: string;
  description: string;
  platform: string;
  maxMembers: number;
};

export async function createCommunityTeam(input: TeamInput): Promise<"created" | "limit" | "invalid_game" | "unavailable"> {
  if (await getCommunityTeamsCommunityId(input.userId) !== input.communityId) return "unavailable";
  const attempt = () => prisma.$transaction(async (tx) => {
    if (!await canUseTeams(tx, input.userId, input.communityId)) return "unavailable";
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [input.communityId], includesDefault: false });
    const game = await scopedDb.game.findUnique({ where: { id: input.gameId }, select: { id: true } });
    if (!game) return "invalid_game";
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (await scopedDb.communityTeam.count({ where: { communityId: input.communityId, createdById: input.userId, createdAt: { gte: since } } }) >= 3) return "limit";
    const { userId, communityId, gameId, name, description, platform, maxMembers } = input;
    const team = await scopedDb.communityTeam.create({
      data: { communityId, gameId, createdById: userId, name, description, platform, maxMembers },
      select: { id: true },
    });
    await scopedDb.communityTeamMember.create({ data: { communityId: input.communityId, teamId: team.id, userId: input.userId } });
    return "created";
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  try {
    return await attempt();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return attempt();
    throw error;
  }
}

export async function joinCommunityTeam(userId: string, communityId: string, teamId: string): Promise<"joined" | "already" | "closed" | "full" | "missing" | "unavailable"> {
  if (await getCommunityTeamsCommunityId(userId) !== communityId) return "unavailable";
  const attempt = () => prisma.$transaction(async (tx) => {
    if (!await canUseTeams(tx, userId, communityId)) return "unavailable";
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    const team = await scopedDb.communityTeam.findFirst({ where: { id: teamId, communityId } });
    if (!team) return "missing";
    if (!team.isRecruiting) return "closed";
    if (await scopedDb.communityTeamMember.findUnique({ where: { teamId_userId: { teamId, userId } } })) return "already";
    if (await scopedDb.communityTeamMember.count({ where: { teamId, communityId, ...activeTeamMemberWhere(communityId) } }) >= team.maxMembers) return "full";
    await scopedDb.communityTeamMember.create({ data: { communityId, teamId, userId } });
    return "joined";
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  // Une seule relance sur conflit sérialisable (P2034) ; P2002 = déjà membre, à chaque tentative.
  for (let retry = 0; ; retry++) {
    try {
      return await attempt();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "already";
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && retry === 0) continue;
      throw error;
    }
  }
}

export async function leaveCommunityTeam(userId: string, communityId: string, teamId: string): Promise<"left" | "leader" | "missing" | "unavailable"> {
  if (await getCommunityTeamsCommunityId(userId) !== communityId) return "unavailable";
  return prisma.$transaction(async (tx) => {
    if (!await canUseTeams(tx, userId, communityId)) return "unavailable";
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    const team = await scopedDb.communityTeam.findFirst({ where: { id: teamId, communityId }, select: { createdById: true, createdBy: { select: { memberships: { where: { communityId, status: "ACTIVE" }, select: { id: true } } } } } });
    if (!team) return "missing";
    if (team.createdById === userId) return "leader";
    const deleted = await scopedDb.communityTeamMember.deleteMany({ where: { teamId, communityId, userId } });
    return deleted.count ? "left" : "missing";
  });
}

export async function setCommunityTeamRecruitment(userId: string, communityId: string, teamId: string, open: boolean): Promise<"saved" | "full" | "missing" | "unavailable"> {
  if (await getCommunityTeamsCommunityId(userId) !== communityId) return "unavailable";
  return prisma.$transaction(async (tx) => {
    if (!await canUseTeams(tx, userId, communityId)) return "unavailable";
    const scopedDb = scopedTransactionPrisma(tx, { communityIds: [communityId], includesDefault: false });
    const team = await scopedDb.communityTeam.findFirst({
      where: { id: teamId, communityId },
      select: {
        createdById: true,
        maxMembers: true,
        createdBy: { select: { memberships: { where: { communityId, status: "ACTIVE" }, select: { id: true } } } },
        members: { where: activeTeamMemberWhere(communityId), orderBy: { joinedAt: "asc" }, take: 1, select: { userId: true } },
        _count: { select: { members: { where: activeTeamMemberWhere(communityId) } } },
      },
    });
    if (!team) return "missing";
    const activeCreator = team.createdBy.memberships.length > 0;
    if (activeCreator ? team.createdById !== userId : team.members[0]?.userId !== userId) return "missing";
    if (open && team._count.members >= team.maxMembers) return "full";
    const updated = await scopedDb.communityTeam.updateMany({ where: { id: teamId, communityId }, data: { isRecruiting: open } });
    return updated.count ? "saved" : "missing";
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
