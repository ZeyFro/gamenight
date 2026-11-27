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
  let criteria: typeof import("./team-recruitment-criteria");
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    apps = await import("./team-applications");
    teams = await import("./community-teams");
    criteria = await import("./team-recruitment-criteria");
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

  it("l'acceptation hérite de la règle une équipe par joueur : la candidature reste en attente", async () => {
    await apps.applyToTeam(ids.ana, ids.community, { teamId: ids.team, message: "Salut" });
    await teams.createCommunityTeam({ userId: ids.bob, communityId: ids.community, gameId: ids.game, name: "Autre équipe", description: "Une autre aventure ensemble.", platform: "PC", maxMembers: 4 });
    const other = await db.communityTeam.findFirstOrThrow({ where: { communityId: ids.community, createdById: ids.bob } });
    expect(await teams.joinCommunityTeam(ids.ana, ids.community, other.id)).toBe("joined");
    const [pending] = await apps.listPendingApplicationsForLeader(ids.leader, ids.community);
    expect(await apps.decideTeamApplication(ids.leader, ids.community, pending.id, true)).toBe("already_team");
    expect(await db.teamApplication.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ status: "PENDING" });
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

  it("parcours C030/C031 : créer, découvrir, candidater, accepter et lire une fiche complète", async () => {
    vi.stubEnv("TEAM_RECRUITMENT_CRITERIA_ENABLED", "true");
    expect(await teams.setCommunityTeamIdentity(ids.leader, ids.community, ids.team, { color: "#123456", emblem: "🛡️" })).toBe("saved");
    expect(await criteria.saveTeamRecruitmentCriteria(ids.leader, ids.community, {
      teamId: ids.team,
      goals: ["DETENTE", "PROGRESSION"],
      minLevel: "INTERMEDIAIRE",
      mic: "PREFERRED",
      slots: ["WEEKDAY_EVENING", "WEEKEND_EVENING"],
      platforms: ["PC", "PS5"],
      note: "Deux soirs par semaine, ambiance détendue.",
    })).toBe("saved");

    const discovered = await teams.listCommunityTeams(ids.ana, ids.community);
    const card = discovered.find((team) => team.id === ids.team)!;
    expect(card).toMatchObject({
      name: "Expédition",
      description: "Construire et explorer ensemble.",
      platform: "PC",
      maxMembers: 3,
      color: "#123456",
      emblem: "🛡️",
      captainId: ids.leader,
      game: { name: "Valheim" },
    });
    expect(card.members.map((member) => member.user.discordName)).toEqual(["leader"]);
    expect(card._count.members).toBe(1);
    const view = (await criteria.listTeamRecruitmentCriteria(ids.ana, ids.community, [ids.team])).get(ids.team)!;
    expect(view).toMatchObject({
      goals: ["DETENTE", "PROGRESSION"],
      minLevel: "INTERMEDIAIRE",
      mic: "PREFERRED",
      slots: ["WEEKDAY_EVENING", "WEEKEND_EVENING"],
      platforms: ["PC", "PS5"],
      note: "Deux soirs par semaine, ambiance détendue.",
    });

    expect(await apps.applyToTeam(ids.ana, ids.community, { teamId: ids.team, message: "Dispo le soir, micro ok." })).toBe("applied");
    const [pending] = await apps.listPendingApplicationsForLeader(ids.leader, ids.community);
    expect(await apps.decideTeamApplication(ids.leader, ids.community, pending.id, true)).toBe("accepted");
    const after = await teams.listCommunityTeams(ids.ana, ids.community);
    expect(after.find((team) => team.id === ids.team)?._count.members).toBe(2);
    expect(await db.communityTeamMember.findFirstOrThrow({ where: { teamId: ids.team, userId: ids.ana } })).toBeTruthy();
  });

  it("C030 — un recruteur accepte la candidature, un autre joueur rejoint et un étranger est refusé", async () => {
    vi.stubEnv("TEAM_RECRUITERS_ENABLED", "true");
    const recruiter = await db.user.create({ data: { discordId: "recruiter", discordName: "recruiter" } });
    await db.membership.create({ data: { communityId: ids.community, userId: recruiter.id, status: "ACTIVE", joinedAt: new Date() } });
    await db.communityTeam.update({ where: { id: ids.team }, data: { maxMembers: 5 } });
    expect(await teams.joinCommunityTeam(recruiter.id, ids.community, ids.team)).toBe("joined");
    const teamRecruiters = await import("./team-recruiters");
    expect(await teamRecruiters.addTeamRecruiter(ids.leader, ids.community, { teamId: ids.team, userId: recruiter.id })).toBe("added");

    expect(await teams.listCommunityTeams(ids.ana, ids.community)).toHaveLength(1);
    expect(await apps.applyToTeam(ids.ana, ids.community, { teamId: ids.team, message: "Je découvre l'équipe." })).toBe("applied");
    const [pending] = await apps.listPendingApplicationsForLeader(recruiter.id, ids.community);
    expect(pending).toMatchObject({ applicant: { discordName: "ana" } });
    expect(await apps.decideTeamApplication(recruiter.id, ids.community, pending.id, true)).toBe("accepted");

    expect(await teams.joinCommunityTeam(ids.bob, ids.community, ids.team)).toBe("joined");
    expect(await teams.joinCommunityTeam(ids.outsider, ids.community, ids.team)).not.toBe("joined");
    const card = (await teams.listCommunityTeams(ids.bob, ids.community)).find((team) => team.id === ids.team)!;
    expect(card.members.map((member) => member.user.discordName).sort()).toEqual(["ana", "bob", "leader", "recruiter"]);
    expect(card._count.members).toBe(4);
  });

  it("C031 — la fiche complète expose identité, critères, membres actifs et rendez-vous à un autre membre", async () => {
    vi.stubEnv("TEAM_RECRUITMENT_CRITERIA_ENABLED", "true");
    expect(await teams.setCommunityTeamIdentity(ids.leader, ids.community, ids.team, { color: "#0f766e", emblem: "🛡️" })).toBe("saved");
    expect(await criteria.saveTeamRecruitmentCriteria(ids.leader, ids.community, {
      teamId: ids.team,
      goals: ["DETENTE", "PROGRESSION"],
      minLevel: "INTERMEDIAIRE",
      mic: "PREFERRED",
      slots: ["WEEKEND_EVENING"],
      platforms: ["PC"],
      note: "Un rendez-vous par semaine.",
    })).toBe("saved");
    expect(await teams.joinCommunityTeam(ids.ana, ids.community, ids.team)).toBe("joined");
    expect(await teams.joinCommunityTeam(ids.bob, ids.community, ids.team)).toBe("joined");
    expect(await teams.leaveCommunityTeam(ids.bob, ids.community, ids.team)).toBe("left");

    const session = await db.session.create({
      data: {
        communityId: ids.community,
        communityTeamId: ids.team,
        createdById: ids.leader,
        date: new Date(Date.now() + 48 * 3_600_000),
        status: "SCHEDULED",
      },
    });
    await db.sessionInvite.create({ data: { sessionId: session.id, userId: ids.ana, invitedById: ids.leader } });

    const card = (await teams.listCommunityTeams(ids.ana, ids.community)).find((team) => team.id === ids.team)!;
    expect(card).toMatchObject({
      name: "Expédition",
      description: "Construire et explorer ensemble.",
      color: "#0f766e",
      emblem: "🛡️",
      captainId: ids.leader,
      captain: { discordName: "leader" },
      game: { name: "Valheim" },
    });
    expect(card.members.map((member) => member.user.discordName)).toEqual(["leader", "ana"]);
    expect(card.sessions).toHaveLength(1);
    expect(card.sessions[0]).toMatchObject({ id: session.id, status: "SCHEDULED" });

    const view = (await criteria.listTeamRecruitmentCriteria(ids.ana, ids.community, [ids.team])).get(ids.team)!;
    expect(view).toMatchObject({
      goals: ["DETENTE", "PROGRESSION"],
      minLevel: "INTERMEDIAIRE",
      mic: "PREFERRED",
      slots: ["WEEKEND_EVENING"],
      platforms: ["PC"],
      note: "Un rendez-vous par semaine.",
    });
  });

  it("une candidature d'un membre qui a quitté la communauté n'est plus proposée au responsable", async () => {
    await apps.applyToTeam(ids.ana, ids.community, { teamId: ids.team, message: "Salut" });
    await db.membership.update({ where: { communityId_userId: { communityId: ids.community, userId: ids.ana } }, data: { status: "LEFT" } });
    expect(await apps.listPendingApplicationsForLeader(ids.leader, ids.community)).toEqual([]);
  });
});
