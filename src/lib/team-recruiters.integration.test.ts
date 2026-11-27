import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
if (!TEST_DATABASE_URL) console.warn("[team-recruiters] TEST_DATABASE_URL absente : tests PostgreSQL SKIPPÉS, recruteurs NON validés sur SQL réel.");

describe.skipIf(!TEST_DATABASE_URL)("recruteurs, cycle de vie des candidatures et invités : PostgreSQL isolé", () => {
  let db: import("@prisma/client").PrismaClient;
  let apps: typeof import("./team-applications");
  let recruiters: typeof import("./team-recruiters");
  let lifecycle: typeof import("./team-application-lifecycle");
  let teams: typeof import("./community-teams");
  const ids: Record<string, string> = {};
  const H = 3600_000;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    apps = await import("./team-applications");
    recruiters = await import("./team-recruiters");
    lifecycle = await import("./team-application-lifecycle");
    teams = await import("./community-teams");
  });
  afterAll(async () => { await db?.$disconnect(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.stubEnv("TEAM_APPLICATIONS_ENABLED", "true");
    vi.stubEnv("TEAM_RECRUITERS_ENABLED", "true");
    await db.$executeRawUnsafe(`TRUNCATE "NotificationDelivery", "NotificationEvent", "TeamTournamentGuest", "CommunityTeamRecruiter", "TeamApplication", "Tournament", "CommunityTeamMember", "CommunityTeam", "Membership", "User", "Game", "Community" CASCADE`);
    ids.community = (await db.community.create({ data: { slug: "tower-rec", name: "The Tower", status: "ACTIVE", communityTeamsEnabled: true } })).id;
    for (const name of ["leader", "r1", "r2", "r3", "ana", "bob", "guest", "banned"]) {
      ids[name] = (await db.user.create({ data: { discordId: name, discordName: name } })).id;
      await db.membership.create({ data: { userId: ids[name], communityId: ids.community, status: "ACTIVE", joinedAt: new Date() } });
    }
    ids.game = (await db.game.create({ data: { name: "Deadlock", source: "MANUAL", addedById: ids.leader } })).id;
    await teams.createCommunityTeam({ userId: ids.leader, communityId: ids.community, gameId: ids.game, name: "Expédition", description: "Construire et explorer ensemble.", platform: "PC", maxMembers: 8 });
    ids.team = (await db.communityTeam.findFirstOrThrow({ where: { communityId: ids.community } })).id;
    for (const name of ["r1", "r2", "r3"]) await teams.joinCommunityTeam(ids[name], ids.community, ids.team);
  });

  it("est inactif sans le drapeau et n'écrit rien", async () => {
    vi.stubEnv("TEAM_RECRUITERS_ENABLED", "false");
    expect(await recruiters.addTeamRecruiter(ids.leader, ids.community, { teamId: ids.team, userId: ids.r1 })).toBe("unavailable");
    expect(await db.communityTeamRecruiter.count()).toBe(0);
  });

  it("le capitaine nomme 2 recruteurs au plus ; un membre ordinaire ne nomme personne", async () => {
    expect(await recruiters.addTeamRecruiter(ids.r1, ids.community, { teamId: ids.team, userId: ids.r2 })).toBe("forbidden");
    expect(await recruiters.addTeamRecruiter(ids.leader, ids.community, { teamId: ids.team, userId: ids.r1 })).toBe("added");
    expect(await recruiters.addTeamRecruiter(ids.leader, ids.community, { teamId: ids.team, userId: ids.r1 })).toBe("already");
    expect(await recruiters.addTeamRecruiter(ids.leader, ids.community, { teamId: ids.team, userId: ids.r2 })).toBe("added");
    expect(await recruiters.addTeamRecruiter(ids.leader, ids.community, { teamId: ids.team, userId: ids.r3 })).toBe("limit");
    expect(await recruiters.addTeamRecruiter(ids.leader, ids.community, { teamId: ids.team, userId: ids.ana })).toBe("not_member");
    expect(await recruiters.addTeamRecruiter(ids.leader, ids.community, { teamId: ids.team, userId: ids.leader })).toBe("self_leader");
    expect(await db.communityTeamRecruiter.count()).toBe(2);
  });

  it("deux nominations simultanées ne dépassent jamais 2 recruteurs", async () => {
    const results = await Promise.all(["r1", "r2", "r3"].map(name => recruiters.addTeamRecruiter(ids.leader, ids.community, { teamId: ids.team, userId: ids[name] })));
    expect(await db.communityTeamRecruiter.count({ where: { teamId: ids.team } })).toBeLessThanOrEqual(2);
    expect(results.filter(result => result === "added").length).toBeLessThanOrEqual(2);
  });

  it("un recruteur voit et décide les candidatures ; un membre ordinaire non", async () => {
    await recruiters.addTeamRecruiter(ids.leader, ids.community, { teamId: ids.team, userId: ids.r1 });
    await apps.applyToTeam(ids.ana, ids.community, { teamId: ids.team, message: "Salut" });
    const [pending] = await apps.listPendingApplicationsForLeader(ids.r1, ids.community);
    expect(pending).toMatchObject({ applicant: { discordName: "ana" } });
    expect(await apps.listPendingApplicationsForLeader(ids.r2, ids.community)).toEqual([]);
    expect(await apps.decideTeamApplication(ids.r2, ids.community, pending.id, true)).toBe("forbidden");
    expect(await apps.decideTeamApplication(ids.r1, ids.community, pending.id, true)).toBe("accepted");
    expect(await db.teamApplication.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ status: "ACCEPTED", decidedById: ids.r1 });
    expect(await db.communityTeamMember.count({ where: { teamId: ids.team, userId: ids.ana } })).toBe(1);
  });

  it("un recruteur qui quitte l'équipe ou n'est plus actif perd son pouvoir", async () => {
    await recruiters.addTeamRecruiter(ids.leader, ids.community, { teamId: ids.team, userId: ids.r1 });
    await recruiters.addTeamRecruiter(ids.leader, ids.community, { teamId: ids.team, userId: ids.r2 });
    await apps.applyToTeam(ids.ana, ids.community, { teamId: ids.team, message: "Salut" });
    const [pending] = await apps.listPendingApplicationsForLeader(ids.leader, ids.community);
    expect(await teams.leaveCommunityTeam(ids.r1, ids.community, ids.team)).toBe("left");
    expect(await db.communityTeamRecruiter.count({ where: { userId: ids.r1 } })).toBe(0);
    expect(await apps.decideTeamApplication(ids.r1, ids.community, pending.id, true)).toBe("forbidden");
    await db.membership.update({ where: { communityId_userId: { communityId: ids.community, userId: ids.r2 } }, data: { status: "REMOVED" } });
    expect(await apps.decideTeamApplication(ids.r2, ids.community, pending.id, true)).toBe("unavailable");
  });

  it("deux acceptations simultanées ne dépassent jamais la taille maximale de l'équipe", async () => {
    await db.communityTeam.update({ where: { id: ids.team }, data: { maxMembers: 5 } });
    await recruiters.addTeamRecruiter(ids.leader, ids.community, { teamId: ids.team, userId: ids.r1 });
    await apps.applyToTeam(ids.ana, ids.community, { teamId: ids.team, message: "A" });
    await apps.applyToTeam(ids.bob, ids.community, { teamId: ids.team, message: "B" });
    const pending = await apps.listPendingApplicationsForLeader(ids.leader, ids.community);
    const outcomes = await Promise.all([
      apps.decideTeamApplication(ids.leader, ids.community, pending[0].id, true),
      apps.decideTeamApplication(ids.r1, ids.community, pending[1].id, true),
    ]);
    expect(await db.communityTeamMember.count({ where: { teamId: ids.team } })).toBeLessThanOrEqual(5);
    expect(outcomes.filter(outcome => outcome === "accepted").length).toBe(1);
    expect(outcomes.filter(outcome => outcome === "full").length).toBe(1);
  });

  it("relance une seule fois à 48 h puis expire à 7 jours, le candidat peut repostuler", async () => {
    await apps.applyToTeam(ids.ana, ids.community, { teamId: ids.team, message: "Salut" });
    const application = await db.teamApplication.findFirstOrThrow({ where: { applicantId: ids.ana } });
    const start = application.createdAt.getTime();

    expect(await lifecycle.runTeamApplicationLifecycle(new Date(start + 47 * H))).toMatchObject({ reminded: 0, expired: 0 });
    // File éteinte : la relance n'est pas consommée.
    expect(await lifecycle.runTeamApplicationLifecycle(new Date(start + 49 * H))).toMatchObject({ reminded: 0 });
    expect((await db.teamApplication.findUniqueOrThrow({ where: { id: application.id } })).reminderSentAt).toBeNull();

    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_TOKEN", "faux-jeton");
    expect(await lifecycle.runTeamApplicationLifecycle(new Date(start + 49 * H))).toMatchObject({ reminded: 1, expired: 0 });
    expect(await lifecycle.runTeamApplicationLifecycle(new Date(start + 60 * H))).toMatchObject({ reminded: 0, expired: 0 });
    const notices = await db.notificationDelivery.findMany({ where: { event: { eventType: "TEAM_APPLICATION_NOTIFY" } }, select: { recipientKey: true, channel: true } });
    expect(notices).toEqual([{ recipientKey: `user:${ids.leader}`, channel: "DISCORD_DM" }]);

    expect(await lifecycle.runTeamApplicationLifecycle(new Date(start + 7 * 24 * H))).toMatchObject({ expired: 1 });
    expect(await db.teamApplication.findUniqueOrThrow({ where: { id: application.id } })).toMatchObject({ status: "EXPIRED" });
    expect(await apps.listPendingApplicationsForLeader(ids.leader, ids.community)).toEqual([]);

    expect(await apps.applyToTeam(ids.ana, ids.community, { teamId: ids.team, message: "Encore moi" })).toBe("applied");
    expect(await db.teamApplication.findUniqueOrThrow({ where: { id: application.id } })).toMatchObject({ status: "PENDING", reminderSentAt: null });
  });

  it("le MP de candidature va au capitaine et aux recruteurs seulement", async () => {
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_TOKEN", "faux-jeton");
    await recruiters.addTeamRecruiter(ids.leader, ids.community, { teamId: ids.team, userId: ids.r1 });
    await apps.applyToTeam(ids.ana, ids.community, { teamId: ids.team, message: "Salut" });
    const { notifyApproversOfApplication } = await import("./team-application-approvers");
    await notifyApproversOfApplication(ids.community, ids.team, ids.ana);
    await notifyApproversOfApplication(ids.community, ids.team, ids.ana);
    const rows = await db.notificationDelivery.findMany({ where: { event: { eventType: "TEAM_APPLICATION_NOTIFY" } }, select: { recipientKey: true } });
    expect(rows.map(row => row.recipientKey).sort()).toEqual([`user:${ids.leader}`, `user:${ids.r1}`].sort());
  });

  it("C077 — parcours complet : 2 recruteurs, relance 48 h, expiration 7 j, plafond 8 et invité de tournoi", async () => {
    expect(await recruiters.addTeamRecruiter(ids.leader, ids.community, { teamId: ids.team, userId: ids.r1 })).toBe("added");
    expect(await recruiters.addTeamRecruiter(ids.leader, ids.community, { teamId: ids.team, userId: ids.r2 })).toBe("added");
    expect(await recruiters.addTeamRecruiter(ids.leader, ids.community, { teamId: ids.team, userId: ids.r3 })).toBe("limit");

    expect(await apps.applyToTeam(ids.ana, ids.community, { teamId: ids.team, message: "Recrutement" })).toBe("applied");
    const [pending] = await apps.listPendingApplicationsForLeader(ids.r1, ids.community);
    expect(await apps.decideTeamApplication(ids.r1, ids.community, pending.id, true)).toBe("accepted");

    const tournament = await db.tournament.create({ data: { name: "Coupe C077", createdById: ids.leader, gameId: ids.game, maxPlayers: 8, communityId: ids.community } });
    expect(await teams.createCommunityTeam({ userId: ids.guest, communityId: ids.community, gameId: ids.game, name: "Autre équipe", description: "Une autre aventure ensemble.", platform: "PC", maxMembers: 4 })).toBe("created");
    expect(await recruiters.inviteTeamGuest(ids.leader, ids.community, { teamId: ids.team, tournamentId: tournament.id, userId: ids.guest })).toBe("invited");
    const [invitation] = await recruiters.listMyGuestInvitations(ids.guest, ids.community);
    expect(await recruiters.respondToTeamGuestInvitation(ids.guest, ids.community, invitation.id, true)).toBe("accepted");

    for (const name of ["fill1", "fill2"]) {
      const user = await db.user.create({ data: { discordId: name, discordName: name } });
      await db.membership.create({ data: { userId: user.id, communityId: ids.community, status: "ACTIVE", joinedAt: new Date() } });
      expect(await teams.joinCommunityTeam(user.id, ids.community, ids.team)).toBe("joined");
    }
    expect(await apps.applyToTeam(ids.bob, ids.community, { teamId: ids.team, message: "Dernière place" })).toBe("applied");
    const bobApplication = await db.teamApplication.findFirstOrThrow({ where: { applicantId: ids.bob, status: "PENDING" } });
    const fill = await db.user.create({ data: { discordId: "fill3", discordName: "fill3" } });
    await db.membership.create({ data: { userId: fill.id, communityId: ids.community, status: "ACTIVE", joinedAt: new Date() } });
    expect(await teams.joinCommunityTeam(fill.id, ids.community, ids.team)).toBe("joined");
    expect(await db.communityTeamMember.count({ where: { teamId: ids.team } })).toBe(8);
    expect(await apps.decideTeamApplication(ids.leader, ids.community, bobApplication.id, true)).toBe("full");

    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_TOKEN", "faux-jeton");
    const start = bobApplication.createdAt.getTime();
    expect(await lifecycle.runTeamApplicationLifecycle(new Date(start + 49 * H))).toMatchObject({ reminded: 1, expired: 0 });
    const notices = await db.notificationDelivery.findMany({ where: { event: { eventType: "TEAM_APPLICATION_NOTIFY" } }, select: { recipientKey: true } });
    expect(notices.map((notice) => notice.recipientKey).sort()).toEqual([`user:${ids.leader}`, `user:${ids.r1}`, `user:${ids.r2}`].sort());
    expect(await lifecycle.runTeamApplicationLifecycle(new Date(start + 7 * 24 * H + H))).toMatchObject({ expired: 1 });
    expect((await db.teamApplication.findUniqueOrThrow({ where: { id: bobApplication.id } })).status).toBe("EXPIRED");
  });

  describe("invités de tournoi", () => {
    beforeEach(async () => {
      ids.tournament = (await db.tournament.create({ data: { name: "Coupe", createdById: ids.leader, gameId: ids.game, maxPlayers: 8, communityId: ids.community } })).id;
    });

    it("invite un joueur d'une autre équipe, qui accepte sans quitter la sienne", async () => {
      await teams.createCommunityTeam({ userId: ids.guest, communityId: ids.community, gameId: ids.game, name: "Autre équipe", description: "Une autre aventure ensemble.", platform: "PC", maxMembers: 4 });
      expect(await recruiters.inviteTeamGuest(ids.r1, ids.community, { teamId: ids.team, tournamentId: ids.tournament, userId: ids.guest })).toBe("forbidden");
      expect(await recruiters.inviteTeamGuest(ids.leader, ids.community, { teamId: ids.team, tournamentId: ids.tournament, userId: ids.guest })).toBe("invited");
      expect(await recruiters.inviteTeamGuest(ids.leader, ids.community, { teamId: ids.team, tournamentId: ids.tournament, userId: ids.guest })).toBe("already_guest");
      expect(await recruiters.inviteTeamGuest(ids.leader, ids.community, { teamId: ids.team, tournamentId: ids.tournament, userId: ids.r1 })).toBe("already_member");
      const [invitation] = await recruiters.listMyGuestInvitations(ids.guest, ids.community);
      expect(invitation).toMatchObject({ status: "INVITED", team: { name: "Expédition" } });
      expect(await recruiters.respondToTeamGuestInvitation(ids.ana, ids.community, invitation.id, true)).toBe("missing");
      expect(await recruiters.respondToTeamGuestInvitation(ids.guest, ids.community, invitation.id, true)).toBe("accepted");
      expect(await db.communityTeamMember.count({ where: { userId: ids.guest, communityId: ids.community } })).toBe(1);
      expect(await db.communityTeamMember.count({ where: { userId: ids.guest, teamId: ids.team } })).toBe(0);
    });

    it("refuse un tournoi lancé, un joueur inactif, un roster complet ; révocation réservée au capitaine", async () => {
      await db.membership.update({ where: { communityId_userId: { communityId: ids.community, userId: ids.banned } }, data: { status: "REMOVED" } });
      expect(await recruiters.inviteTeamGuest(ids.leader, ids.community, { teamId: ids.team, tournamentId: ids.tournament, userId: ids.banned })).toBe("not_active");
      expect(await recruiters.inviteTeamGuest(ids.leader, ids.community, { teamId: ids.team, tournamentId: ids.tournament, userId: ids.guest })).toBe("invited");
      const guestRow = await db.teamTournamentGuest.findFirstOrThrow();
      expect(await recruiters.revokeTeamGuest(ids.r1, ids.community, guestRow.id)).toBe("forbidden");
      expect(await recruiters.revokeTeamGuest(ids.leader, ids.community, guestRow.id)).toBe("revoked");
      expect(await recruiters.inviteTeamGuest(ids.leader, ids.community, { teamId: ids.team, tournamentId: ids.tournament, userId: ids.guest })).toBe("invited");
      await db.tournament.update({ where: { id: ids.tournament }, data: { status: "IN_PROGRESS" } });
      expect(await recruiters.inviteTeamGuest(ids.leader, ids.community, { teamId: ids.team, tournamentId: ids.tournament, userId: ids.bob })).toBe("tournament_closed");
      expect(await recruiters.respondToTeamGuestInvitation(ids.guest, ids.community, guestRow.id, true)).toBe("missing");
    });
  });

  it("demande le retrait des accès d'un membre dont l'appartenance au serveur n'est plus active", async () => {
    await db.discordTeamSpace.create({ data: { teamId: ids.team, communityId: ids.community, guildId: "100000000000000001", channelId: "100000000000000002", voiceChannelId: "100000000000000003", roleId: "100000000000000004" } });
    await db.membership.update({ where: { communityId_userId: { communityId: ids.community, userId: ids.r3 } }, data: { status: "LEFT", leftAt: new Date() } });
    const report = await lifecycle.runTeamApplicationLifecycle(new Date());
    expect(report.accessRequests).toBe(1);
  });
});
