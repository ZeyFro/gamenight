import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
if (!TEST_DATABASE_URL) console.warn("[team-applications] TEST_DATABASE_URL absente : tests PostgreSQL SKIPPÉS, candidatures NON validées sur SQL réel.");

describe.skipIf(!TEST_DATABASE_URL)("candidatures d'équipe : PostgreSQL isolé", () => {
  let db: import("@prisma/client").PrismaClient;
  let apps: typeof import("./team-applications");
  let teams: typeof import("./community-teams");
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    apps = await import("./team-applications");
    teams = await import("./community-teams");
  });
  afterAll(async () => { await db?.$disconnect(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.stubEnv("TEAM_APPLICATIONS_ENABLED", "true");
    await db.$executeRawUnsafe(`TRUNCATE "TeamApplication", "CommunityTeamMember", "CommunityTeam", "Membership", "User", "Game", "Community" CASCADE`);
    ids.community = (await db.community.create({ data: { slug: "tower-apps", name: "The Tower", status: "ACTIVE", communityTeamsEnabled: true } })).id;
    ids.other = (await db.community.create({ data: { slug: "other-apps", name: "Other", status: "ACTIVE", communityTeamsEnabled: true } })).id;
    for (const name of ["leader", "ana", "bob", "outsider"]) {
      ids[name] = (await db.user.create({ data: { discordId: name, discordName: name } })).id;
    }
    for (const [userId, communityId] of [[ids.leader, ids.community], [ids.ana, ids.community], [ids.bob, ids.community], [ids.outsider, ids.other]]) {
      await db.membership.create({ data: { userId, communityId, status: "ACTIVE", joinedAt: new Date() } });
    }
    ids.game = (await db.game.create({ data: { name: "Valheim", source: "MANUAL", addedById: ids.leader } })).id;
    await teams.createCommunityTeam({ userId: ids.leader, communityId: ids.community, gameId: ids.game, name: "Expédition", description: "Construire et explorer ensemble.", platform: "PC", maxMembers: 3 });
    ids.team = (await db.communityTeam.findFirstOrThrow({ where: { communityId: ids.community } })).id;
  });

  it("est inactif sans le drapeau", async () => {
    vi.stubEnv("TEAM_APPLICATIONS_ENABLED", "false");
    expect(await apps.getTeamApplicationsCommunityId(ids.ana)).toBeNull();
    expect(await apps.applyToTeam(ids.ana, ids.community, { teamId: ids.team, message: "Salut" })).toBe("unavailable");
    expect(await db.teamApplication.count()).toBe(0);
  });

  it("dépose une candidature, refuse le doublon, puis accepte : le candidat devient membre", async () => {
    expect(await apps.applyToTeam(ids.ana, ids.community, { teamId: ids.team, message: "Salut" })).toBe("applied");
    expect(await apps.applyToTeam(ids.ana, ids.community, { teamId: ids.team, message: "Encore" })).toBe("pending");
    const [pending] = await apps.listPendingApplicationsForLeader(ids.leader, ids.community);
    expect(pending).toMatchObject({ message: "Salut", applicant: { discordName: "ana" } });
    expect(await apps.listPendingApplicationsForLeader(ids.bob, ids.community)).toEqual([]);

    expect(await apps.decideTeamApplication(ids.ana, ids.community, pending.id, true)).toBe("forbidden");
    expect(await apps.decideTeamApplication(ids.leader, ids.community, pending.id, true)).toBe("accepted");
    expect(await db.communityTeamMember.count({ where: { teamId: ids.team, userId: ids.ana } })).toBe(1);
    expect(await db.teamApplication.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ status: "ACCEPTED", decidedById: ids.leader });
    expect(await apps.decideTeamApplication(ids.leader, ids.community, pending.id, true)).toBe("missing");
    expect(await apps.applyToTeam(ids.ana, ids.community, { teamId: ids.team, message: "Re" })).toBe("already_member");
  });

  it("refuse puis permet de repostuler ; le retrait est réservé au candidat", async () => {
    await apps.applyToTeam(ids.ana, ids.community, { teamId: ids.team, message: "Salut" });
    const [pending] = await apps.listPendingApplicationsForLeader(ids.leader, ids.community);
    expect(await apps.decideTeamApplication(ids.leader, ids.community, pending.id, false)).toBe("declined");
    expect(await db.communityTeamMember.count({ where: { teamId: ids.team, userId: ids.ana } })).toBe(0);
    expect(await apps.applyToTeam(ids.ana, ids.community, { teamId: ids.team, message: "Nouveau message" })).toBe("applied");
    expect(await db.teamApplication.count()).toBe(1);
    expect(await apps.withdrawTeamApplication(ids.bob, ids.community, pending.id)).toBe("missing");
    expect(await apps.withdrawTeamApplication(ids.ana, ids.community, pending.id)).toBe("withdrawn");
    expect(await apps.listMyTeamApplications(ids.ana, ids.community)).toMatchObject([{ status: "WITHDRAWN" }]);
  });

  it("laisse la candidature en attente quand l'équipe est complète ou fermée", async () => {
    await apps.applyToTeam(ids.ana, ids.community, { teamId: ids.team, message: "A" });
    await apps.applyToTeam(ids.bob, ids.community, { teamId: ids.team, message: "B" });
    const pending = await apps.listPendingApplicationsForLeader(ids.leader, ids.community);
    await db.communityTeam.update({ where: { id: ids.team }, data: { isRecruiting: false } });
    expect(await apps.decideTeamApplication(ids.leader, ids.community, pending[0].id, true)).toBe("closed");
    await db.communityTeam.update({ where: { id: ids.team }, data: { isRecruiting: true, maxMembers: 2 } });
    expect(await apps.decideTeamApplication(ids.leader, ids.community, pending[0].id, true)).toBe("accepted");
    expect(await apps.decideTeamApplication(ids.leader, ids.community, pending[1].id, true)).toBe("full");
    expect(await db.teamApplication.count({ where: { status: "PENDING" } })).toBe(1);
  });

  it("refuse de postuler quand le recrutement est fermé ou l'équipe complète", async () => {
    await db.communityTeam.update({ where: { id: ids.team }, data: { isRecruiting: false } });
    expect(await apps.applyToTeam(ids.ana, ids.community, { teamId: ids.team, message: "Salut" })).toBe("closed");
    await db.communityTeam.update({ where: { id: ids.team }, data: { isRecruiting: true, maxMembers: 1 } });
    expect(await apps.applyToTeam(ids.ana, ids.community, { teamId: ids.team, message: "Salut" })).toBe("full");
  });

  it("isole les communautés : un membre d'un autre serveur ne voit ni ne dépose rien ici", async () => {
    expect(await apps.applyToTeam(ids.outsider, ids.community, { teamId: ids.team, message: "Salut" })).toBe("unavailable");
    expect(await apps.applyToTeam(ids.ana, ids.community, { teamId: "inconnue", message: "Salut" })).toBe("missing");
    await apps.applyToTeam(ids.ana, ids.community, { teamId: ids.team, message: "Salut" });
    expect(await apps.listMyTeamApplications(ids.outsider, ids.other)).toEqual([]);
    expect(await apps.listPendingApplicationsForLeader(ids.outsider, ids.community)).toEqual([]);
    const [pending] = await apps.listPendingApplicationsForLeader(ids.leader, ids.community);
    expect(await apps.decideTeamApplication(ids.outsider, ids.community, pending.id, true)).toBe("unavailable");
  });

  it("une candidature d'un membre qui a quitté la communauté n'est plus proposée au responsable", async () => {
    await apps.applyToTeam(ids.ana, ids.community, { teamId: ids.team, message: "Salut" });
    await db.membership.update({ where: { communityId_userId: { communityId: ids.community, userId: ids.ana } }, data: { status: "LEFT" } });
    expect(await apps.listPendingApplicationsForLeader(ids.leader, ids.community)).toEqual([]);
  });
});
