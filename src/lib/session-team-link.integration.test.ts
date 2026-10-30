import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
if (!TEST_DATABASE_URL) console.warn("[session-team-link] TEST_DATABASE_URL absente : tests PostgreSQL ignorés.");

describe.skipIf(!TEST_DATABASE_URL)("liaison facultative soirée-équipe : PostgreSQL isolé", () => {
  let db: import("@prisma/client").PrismaClient;
  let createVotingSessionInTransaction: typeof import("./session-creation").createVotingSessionInTransaction;
  let teams: typeof import("./community-teams");
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    ({ createVotingSessionInTransaction } = await import("./session-creation"));
    teams = await import("./community-teams");
  });
  afterAll(async () => { await db?.$disconnect(); });
  beforeEach(async () => {
    await db.$executeRawUnsafe(`TRUNCATE "SessionInvite", "Session", "CommunityTeamMember", "CommunityTeam", "Membership", "User", "Game", "Community" CASCADE`);
    ids.community = (await db.community.create({ data: { slug: "tower-session-link", name: "Tower", status: "ACTIVE", communityTeamsEnabled: true } })).id;
    ids.other = (await db.community.create({ data: { slug: "other-session-link", name: "Other", status: "ACTIVE", communityTeamsEnabled: true } })).id;
    for (const name of ["leader", "nonmember", "outsider"]) ids[name] = (await db.user.create({ data: { discordId: name, discordName: name } })).id;
    for (const [userId, communityId] of [[ids.leader, ids.community], [ids.nonmember, ids.community], [ids.outsider, ids.other]]) {
      await db.membership.create({ data: { userId, communityId, status: "ACTIVE", joinedAt: new Date() } });
    }
    ids.game = (await db.game.create({ data: { name: "Minecraft", source: "MANUAL", addedById: ids.leader } })).id;
    ids.team = (await db.communityTeam.create({ data: { communityId: ids.community, gameId: ids.game, createdById: ids.leader, name: "Expédition", description: "Aventure durable en équipe.", platform: "PC", maxMembers: 5 } })).id;
    await db.communityTeamMember.create({ data: { communityId: ids.community, teamId: ids.team, userId: ids.leader } });
  });

  const create = (createdById: string, communityId: string | null, communityTeamId?: string) => db.$transaction((tx) => createVotingSessionInTransaction(tx, {
    date: new Date("2026-12-01T20:00:00Z"), votingDeadline: new Date("2026-12-01T14:00:00Z"),
    customReminderMessage: null, reminderTimings: [1440, 120], notifiedUserIds: [], createdById,
    announceViaBot: false, communityId, ...(communityTeamId ? { communityTeamId } : {}),
  } as Parameters<typeof createVotingSessionInTransaction>[1]));

  it("attache la soirée au projet, la montre dans l'équipe au créateur, sans élargir la confidentialité", async () => {
    const session = await create(ids.leader, ids.community, ids.team);
    expect(session.communityTeamId).toBe(ids.team);
    const [leaderTeam] = await teams.listCommunityTeams(ids.leader, ids.community);
    expect(leaderTeam.sessions.map(({ id }) => id)).toContain(session.id);
    await db.communityTeamMember.create({ data: { communityId: ids.community, teamId: ids.team, userId: ids.nonmember } });
    const [memberTeam] = await teams.listCommunityTeams(ids.nonmember, ids.community);
    expect(memberTeam.sessions.map(({ id }) => id)).not.toContain(session.id);
    const legacy = await create(ids.leader, ids.community);
    expect(legacy.communityTeamId).toBeNull();
  });

  it("refuse une équipe d'une autre communauté et un utilisateur non membre de l'équipe", async () => {
    await expect(create(ids.leader, ids.other, ids.team)).rejects.toThrow();
    await expect(create(ids.nonmember, ids.community, ids.team)).rejects.toThrow();
    await db.community.update({ where: { id: ids.community }, data: { communityTeamsEnabled: false } });
    await expect(create(ids.leader, ids.community, ids.team)).rejects.toThrow();
    expect(await db.session.count()).toBe(0);
  });
});
