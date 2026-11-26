import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
if (!TEST_DATABASE_URL) console.warn("[community-teams] TEST_DATABASE_URL absente : tests PostgreSQL ignorés.");

describe.skipIf(!TEST_DATABASE_URL)("équipes communautaires : PostgreSQL isolé", () => {
  let db: import("@prisma/client").PrismaClient;
  let teams: typeof import("./community-teams");
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    teams = await import("./community-teams");
  });
  afterAll(async () => { await db?.$disconnect(); });
  beforeEach(async () => {
    await db.$executeRawUnsafe(`TRUNCATE "CommunityTeamMember", "CommunityTeam", "Membership", "User", "Game", "Community" CASCADE`);
    ids.community = (await db.community.create({ data: { slug: "tower-teams", name: "The Tower", status: "ACTIVE", communityTeamsEnabled: true } })).id;
    ids.other = (await db.community.create({ data: { slug: "other-teams", name: "Other", status: "ACTIVE", communityTeamsEnabled: true } })).id;
    for (const name of ["leader", "member", "racer", "otherMember"]) {
      ids[name] = (await db.user.create({ data: { discordId: name, discordName: name } })).id;
    }
    for (const [userId, communityId] of [[ids.leader, ids.community], [ids.member, ids.community], [ids.racer, ids.community], [ids.otherMember, ids.other]]) {
      await db.membership.create({ data: { userId, communityId, status: "ACTIVE", joinedAt: new Date() } });
    }
    ids.game = (await db.game.create({ data: { name: "Valheim", source: "MANUAL", addedById: ids.leader } })).id;
  });

  it("creates a project with its leader, enforces capacity under concurrent joins, and allows leaving", async () => {
    expect(await teams.getCommunityTeamsCommunityId(ids.leader)).toBe(ids.community);
    expect(await teams.createCommunityTeam({ userId: ids.leader, communityId: ids.community, gameId: ids.game, name: "Expédition", description: "Construire et explorer ensemble.", platform: "PC", maxMembers: 2 })).toBe("created");
    let [row] = await db.communityTeam.findMany({ where: { communityId: ids.community }, include: { members: true } });
    expect(row.members).toHaveLength(1);

    const joins = await Promise.all([
      teams.joinCommunityTeam(ids.member, ids.community, row.id),
      teams.joinCommunityTeam(ids.racer, ids.community, row.id),
    ]);
    expect(joins.filter((r) => r === "joined")).toHaveLength(1);
    expect(joins.filter((r) => r === "full")).toHaveLength(1);
    row = await db.communityTeam.findFirstOrThrow({ where: { id: row.id }, include: { members: true } });
    const joined = row.members.find((m) => m.userId !== ids.leader)!;
    expect(await teams.leaveCommunityTeam(joined.userId, ids.community, row.id)).toBe("left");
    expect(await teams.leaveCommunityTeam(ids.leader, ids.community, row.id)).toBe("confirm_dissolution");
    expect(await teams.leaveCommunityTeam(ids.leader, ids.community, row.id, { confirmDissolution: true })).toBe("dissolved_last_member");
    expect(await db.communityTeamMember.count({ where: { teamId: row.id } })).toBe(0);
  });

  it("limits teams to 8 and blocks joining or creating a second team", async () => {
    const input = { communityId: ids.community, gameId: ids.game, description: "Exploration sur la durée.", platform: "PC", maxMembers: 8 };
    expect(await teams.createCommunityTeam({ ...input, userId: ids.leader, name: "Équipe A" })).toBe("created");
    expect(await teams.createCommunityTeam({ ...input, userId: ids.leader, name: "Équipe B" })).toBe("already_team");
    expect(await teams.createCommunityTeam({ ...input, userId: ids.member, name: "Équipe B" })).toBe("created");
    const all = await db.communityTeam.findMany({ where: { communityId: ids.community }, orderBy: { name: "asc" } });
    expect(await teams.joinCommunityTeam(ids.leader, ids.community, all[1].id)).toBe("already_team");
    expect(await db.communityTeamMember.count({ where: { communityId: ids.community, userId: ids.leader } })).toBe(1);
  });

  it.each([0, 25])("compte les créations des dernières 24 h, même après dissolution (ancienne création : %i h)", async (oldHours) => {
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      await db.communityTeam.create({ data: { communityId: ids.community, gameId: ids.game,
        createdById: ids.leader, captainId: ids.leader, name: "Ancienne équipe " + i,
        description: "Projet historique sans membres.", platform: "PC", maxMembers: 4,
        isRecruiting: false, createdAt: new Date(now - (i === 0 ? oldHours : 1) * 3600000) } });
    }
    const result = await teams.createCommunityTeam({ userId: ids.leader, communityId: ids.community,
      gameId: ids.game, name: "Nouvelle tentative", description: "Projet collectif dans la limite.", platform: "PC", maxMembers: 4 });
    expect(result).toBe(oldHours === 0 ? "limit" : "created");
    expect(await db.communityTeam.count({ where: { communityId: ids.community } })).toBe(oldHours === 0 ? 3 : 4);
  });

  it("enforces seven days after a departure, including simultaneous admissions", async () => {
    const input = { communityId: ids.community, gameId: ids.game, description: "Projet d'équipe durable.", platform: "PC", maxMembers: 8 };
    expect(await teams.createCommunityTeam({ ...input, userId: ids.leader, name: "Équipe A" })).toBe("created");
    expect(await teams.createCommunityTeam({ ...input, userId: ids.member, name: "Équipe B" })).toBe("created");
    const first = await db.communityTeam.findFirstOrThrow({ where: { communityId: ids.community, createdById: ids.leader } });
    const second = await db.communityTeam.findFirstOrThrow({ where: { communityId: ids.community, createdById: ids.member } });
    expect(await teams.joinCommunityTeam(ids.racer, ids.community, first.id)).toBe("joined");
    expect(await teams.leaveCommunityTeam(ids.racer, ids.community, first.id)).toBe("left");
    expect(await teams.joinCommunityTeam(ids.racer, ids.community, second.id)).toBe("cooldown");
    await db.membership.update({
      where: { communityId_userId: { communityId: ids.community, userId: ids.racer } },
      data: { lastTeamLeftAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
    });
    const outcomes = await Promise.all([
      teams.joinCommunityTeam(ids.racer, ids.community, first.id),
      teams.joinCommunityTeam(ids.racer, ids.community, second.id),
    ]);
    expect(outcomes.filter((result) => result === "joined")).toHaveLength(1);
    expect(await db.communityTeamMember.count({ where: { communityId: ids.community, userId: ids.racer } })).toBe(1);
  });

  it("transfers leadership after thirty days only to the oldest active teammate", async () => {
    const input = { communityId: ids.community, gameId: ids.game, description: "Exploration longue et coopérative.", platform: "PC", maxMembers: 8 };
    expect(await teams.createCommunityTeam({ ...input, userId: ids.leader, name: "Vieille équipe" })).toBe("created");
    const [team] = await db.communityTeam.findMany({ where: { communityId: ids.community } });
    expect(await teams.joinCommunityTeam(ids.member, ids.community, team.id)).toBe("joined");
    expect(await teams.joinCommunityTeam(ids.racer, ids.community, team.id)).toBe("joined");
    await db.communityTeam.update({
      where: { id: team.id },
      data: { captainLastActivityAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
    });

    const { transferInactiveCommunityTeamCaptains } = await import("./community-team-handover");
    expect(await transferInactiveCommunityTeamCaptains(new Date(), true)).toMatchObject({ eligible: 1, transferred: 0 });
    expect((await db.communityTeam.findUniqueOrThrow({ where: { id: team.id } })).captainId).toBe(ids.leader);
    expect(await transferInactiveCommunityTeamCaptains(new Date(), false)).toMatchObject({ eligible: 1, transferred: 1 });
    expect((await db.communityTeam.findUniqueOrThrow({ where: { id: team.id } })).captainId).toBe(ids.member);
    expect(await transferInactiveCommunityTeamCaptains(new Date(), false)).toMatchObject({ transferred: 0 });
    expect((await db.communityTeam.findUniqueOrThrow({ where: { id: team.id } })).createdById).toBe(ids.leader);
  });

  it("identité visuelle (§11.2) : le capitaine choisit couleur et emblème, un autre membre est refusé", async () => {
    await teams.createCommunityTeam({ userId: ids.leader, communityId: ids.community, gameId: ids.game, name: "Les Dragons", description: "Une équipe aux couleurs vives.", platform: "PC", maxMembers: 4 });
    const [team] = await db.communityTeam.findMany({ where: { communityId: ids.community } });
    expect(await teams.joinCommunityTeam(ids.member, ids.community, team.id)).toBe("joined");
    expect(await teams.setCommunityTeamIdentity(ids.member, ids.community, team.id, { color: "#00ff00", emblem: "🐺" })).toBe("missing");
    expect(await teams.setCommunityTeamIdentity(ids.otherMember, ids.community, team.id, { color: "#00ff00", emblem: "🐺" })).toBe("unavailable");
    expect(await teams.setCommunityTeamIdentity(ids.leader, ids.community, team.id, { color: "#ff0000", emblem: "🐉" })).toBe("saved");
    let [listed] = await teams.listCommunityTeams(ids.member, ids.community);
    expect([listed.color, listed.emblem]).toEqual(["#ff0000", "🐉"]);
    expect(await teams.setCommunityTeamIdentity(ids.leader, ids.community, team.id, { color: null, emblem: null })).toBe("saved");
    [listed] = await teams.listCommunityTeams(ids.member, ids.community);
    expect([listed.color, listed.emblem]).toEqual([null, null]);
  });

  it("does not list or mutate a project from another community scope", async () => {
    await teams.createCommunityTeam({ userId: ids.leader, communityId: ids.community, gameId: ids.game, name: "Projet Tower", description: "Expédition réservée à The Tower.", platform: "PC", maxMembers: 4 });
    await expect(teams.listCommunityTeams(ids.otherMember, ids.community)).resolves.toHaveLength(0);
    await expect(teams.joinCommunityTeam(ids.otherMember, ids.community, "missing-team")).resolves.toBe("unavailable");
  });

  it("keeps the project visible after its leader leaves and lets an active teammate take over", async () => {
    await teams.createCommunityTeam({ userId: ids.leader, communityId: ids.community, gameId: ids.game, name: "Long voyage", description: "Explorer ensemble pendant plusieurs semaines.", platform: "PC", maxMembers: 2 });
    await db.membership.update({ where: { communityId_userId: { communityId: ids.community, userId: ids.leader } }, data: { status: "LEFT" } });
    const [team] = await teams.listCommunityTeams(ids.member, ids.community);
    expect(team._count.members).toBe(0);
    expect(await teams.setCommunityTeamRecruitment(ids.member, ids.community, team.id, false)).toBe("missing");
    await teams.joinCommunityTeam(ids.member, ids.community, team.id);
    expect(await teams.setCommunityTeamRecruitment(ids.member, ids.community, team.id, false)).toBe("saved");
    const [closedTeam] = await teams.listCommunityTeams(ids.member, ids.community);
    expect(closedTeam.isRecruiting).toBe(false);
  });

  it("only lets the oldest active teammate take over recruitment after the leader leaves", async () => {
    await teams.createCommunityTeam({ userId: ids.leader, communityId: ids.community, gameId: ids.game, name: "Cartographes", description: "Explorer les terres inconnues ensemble.", platform: "PC", maxMembers: 4 });
    const [team] = await db.communityTeam.findMany({ where: { communityId: ids.community } });
    await db.membership.update({ where: { communityId_userId: { communityId: ids.community, userId: ids.leader } }, data: { status: "LEFT" } });
    await teams.joinCommunityTeam(ids.member, ids.community, team.id);
    await teams.joinCommunityTeam(ids.racer, ids.community, team.id);
    await expect(teams.setCommunityTeamRecruitment(ids.racer, ids.community, team.id, false)).resolves.toBe("missing");
    await expect(teams.setCommunityTeamRecruitment(ids.member, ids.community, team.id, false)).resolves.toBe("saved");
  });

  it("applique le délai de 7 jours au capitaine qui dissout, pas aux autres membres", async () => {
    const input = { communityId: ids.community, gameId: ids.game, description: "Projet collectif à dissoudre proprement.", platform: "PC", maxMembers: 4 };
    expect(await teams.createCommunityTeam({ ...input, userId: ids.leader, name: "Équipe Dissolution" })).toBe("created");
    const team = await db.communityTeam.findFirstOrThrow({ where: { communityId: ids.community, createdById: ids.leader } });
    expect(await teams.joinCommunityTeam(ids.member, ids.community, team.id)).toBe("joined");

    expect(await teams.dissolveCommunityTeam(ids.leader, ids.community, team.id)).toBe("dissolved");
    expect(await db.communityTeamMember.count({ where: { teamId: team.id } })).toBe(0);

    expect(await teams.setCommunityTeamRecruitment(ids.leader, ids.community, team.id, true)).toBe("missing");
    expect((await db.communityTeam.findUniqueOrThrow({ where: { id: team.id } })).isRecruiting).toBe(false);
    expect(await db.communityTeamMember.count({ where: { teamId: team.id } })).toBe(0);

    const [leaderMembership, memberMembership] = await Promise.all([
      db.membership.findUniqueOrThrow({ where: { communityId_userId: { communityId: ids.community, userId: ids.leader } }, select: { lastTeamLeftAt: true } }),
      db.membership.findUniqueOrThrow({ where: { communityId_userId: { communityId: ids.community, userId: ids.member } }, select: { lastTeamLeftAt: true } }),
    ]);
    expect(leaderMembership.lastTeamLeftAt).toBeInstanceOf(Date);
    expect(memberMembership.lastTeamLeftAt).toBeNull();

    expect(await teams.createCommunityTeam({ ...input, userId: ids.leader, name: "Retour trop tôt" })).toBe("cooldown");
    expect(await teams.createCommunityTeam({ ...input, userId: ids.member, name: "Nouvelle équipe libre" })).toBe("created");
  });

  describe("départ volontaire du capitaine", () => {
    const input = () => ({ userId: ids.leader, communityId: ids.community, gameId: ids.game, name: "Passation", description: "Projet avec passation du capitaine.", platform: "PC", maxMembers: 5 });
    const setup = async () => {
      await teams.createCommunityTeam(input());
      return db.communityTeam.findFirstOrThrow({ where: { communityId: ids.community, createdById: ids.leader } });
    };
    const join = (userId: string, teamId: string, joinedAt: Date) =>
      db.communityTeamMember.create({ data: { communityId: ids.community, teamId, userId, joinedAt } });
    const expectLeft = async (userId: string, teamId: string) => {
      expect(await db.communityTeamMember.count({ where: { teamId, userId } })).toBe(0);
      const m = await db.membership.findUniqueOrThrow({ where: { communityId_userId: { communityId: ids.community, userId } }, select: { lastTeamLeftAt: true } });
      expect(m.lastTeamLeftAt).toBeInstanceOf(Date);
    };

    it("passe la main au plus ancien membre actif puis sort avec le délai de 7 jours", async () => {
      const team = await setup();
      await join(ids.racer, team.id, new Date("2030-01-02"));
      await join(ids.member, team.id, new Date("2030-01-03"));
      expect(await teams.leaveCommunityTeam(ids.leader, ids.community, team.id)).toBe("left");
      expect((await db.communityTeam.findUniqueOrThrow({ where: { id: team.id } })).captainId).toBe(ids.racer);
      await expectLeft(ids.leader, team.id);
      expect(await teams.createCommunityTeam({ ...input(), name: "Trop tôt" })).toBe("cooldown");
    });

    it("départage une égalité de joinedAt par userId", async () => {
      const team = await setup();
      const same = new Date("2030-01-02");
      await join(ids.racer, team.id, same);
      await join(ids.member, team.id, same);
      const [first] = [ids.racer, ids.member].sort();
      expect(await teams.leaveCommunityTeam(ids.leader, ids.community, team.id)).toBe("left");
      expect((await db.communityTeam.findUniqueOrThrow({ where: { id: team.id } })).captainId).toBe(first);
    });

    it("ignore les membres non actifs", async () => {
      const team = await setup();
      await join(ids.racer, team.id, new Date("2030-01-02"));
      await join(ids.member, team.id, new Date("2030-01-03"));
      await db.membership.update({ where: { communityId_userId: { communityId: ids.community, userId: ids.racer } }, data: { status: "LEFT" } });
      expect(await teams.leaveCommunityTeam(ids.leader, ids.community, team.id)).toBe("left");
      expect((await db.communityTeam.findUniqueOrThrow({ where: { id: team.id } })).captainId).toBe(ids.member);
    });

    it("demande confirmation puis dissout l'équipe quand le dernier membre actif la quitte", async () => {
      const team = await setup();
      expect(await teams.leaveCommunityTeam(ids.leader, ids.community, team.id)).toBe("confirm_dissolution");
      expect(await db.communityTeamMember.count({ where: { teamId: team.id } })).toBe(1);
      expect(await teams.leaveCommunityTeam(ids.leader, ids.community, team.id, { confirmDissolution: true })).toBe("dissolved_last_member");
      expect(await db.communityTeamMember.count({ where: { teamId: team.id } })).toBe(0);
      expect((await db.communityTeam.findUniqueOrThrow({ where: { id: team.id } })).isRecruiting).toBe(false);
      const membership = await db.membership.findUniqueOrThrow({ where: { communityId_userId: { communityId: ids.community, userId: ids.leader } }, select: { lastTeamLeftAt: true } });
      expect(membership.lastTeamLeftAt).toBeInstanceOf(Date);

      await join(ids.racer, team.id, new Date("2030-01-02"));
      await db.membership.update({ where: { communityId_userId: { communityId: ids.community, userId: ids.racer } }, data: { status: "LEFT" } });
      expect(await teams.leaveCommunityTeam(ids.leader, ids.community, team.id)).toBe("missing");
    });

    it("applique les blocages de dissolution au dernier membre", async () => {
      const team = await setup();
      await db.discordTeamSpace.create({ data: { teamId: team.id, communityId: ids.community,
        guildId: "guild-last", channelId: "chan-last", voiceChannelId: "voice-last" } });
      const report = await db.moderationReport.create({ data: { communityId: ids.community, guildId: "guild-last",
        channelId: "chan-last", messageId: "msg-last", authorDiscordId: "author", reporterDiscordId: "reporter",
        messageUrl: "https://discord.com/channels/guild-last/chan-last/msg-last", excerpt: "message signalé" } });
      expect(await teams.leaveCommunityTeam(ids.leader, ids.community, team.id, { confirmDissolution: true })).toBe("open_report_or_appeal");
      expect(await db.communityTeamMember.count({ where: { teamId: team.id } })).toBe(1);
      await db.moderationReport.update({ where: { id: report.id }, data: { closedAt: new Date() } });

      const definition = await db.towerChallengeDefinition.create({ data: { communityId: ids.community,
        title: "Défi", instructions: "Réaliser le défi.", rewardFloors: 1 } });
      await db.towerChallengeAttempt.create({ data: { communityId: ids.community, userId: ids.leader,
        teamId: team.id, definitionId: definition.id, requestKey: "req-last", title: "Défi",
        instructions: "Réaliser le défi.", rewardFloors: 1, assignedAt: new Date("2030-01-01T00:00:00Z"),
        expiresAt: new Date("2030-01-03T00:00:00Z") } });
      expect(await teams.leaveCommunityTeam(ids.leader, ids.community, team.id, { confirmDissolution: true })).toBe("active_challenges");
      expect(await db.communityTeamMember.count({ where: { teamId: team.id } })).toBe(1);
    });

    it("est atomique : un échec en fin de transaction annule la passation", async () => {
      const team = await setup();
      await join(ids.racer, team.id, new Date("2030-01-02"));
      await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION test_fail_membership() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'échec simulé'; END; $$ LANGUAGE plpgsql`);
      await db.$executeRawUnsafe(`CREATE TRIGGER test_fail_membership BEFORE UPDATE ON "Membership" FOR EACH ROW EXECUTE FUNCTION test_fail_membership()`);
      try {
        await expect(teams.leaveCommunityTeam(ids.leader, ids.community, team.id)).rejects.toThrow();
      } finally {
        await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_fail_membership ON "Membership"`);
        await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_fail_membership()`);
      }
      expect((await db.communityTeam.findUniqueOrThrow({ where: { id: team.id } })).captainId).toBe(ids.leader);
      expect(await db.communityTeamMember.count({ where: { teamId: team.id, userId: ids.leader } })).toBe(1);
    });
  });

  describe("blocage de dissolution par un signalement ou une contestation ouverte", () => {
    const setupTeam = async (suffix: string) => {
      await teams.createCommunityTeam({ userId: ids.leader, communityId: ids.community, gameId: ids.game,
        name: `Bloquée ${suffix}`, description: "Équipe dont la dissolution est protégée.", platform: "PC", maxMembers: 4 });
      const team = await db.communityTeam.findFirstOrThrow({ where: { communityId: ids.community, name: `Bloquée ${suffix}` } });
      await db.discordTeamSpace.create({ data: { teamId: team.id, communityId: ids.community,
        guildId: "guild-1", channelId: `chan-${suffix}`, voiceChannelId: `voice-${suffix}` } });
      return team;
    };

    it("refuse tant qu'un signalement sur un salon de l'équipe est ouvert, puis dissout après clôture", async () => {
      const team = await setupTeam("report");
      const report = await db.moderationReport.create({ data: { communityId: ids.community, guildId: "guild-1",
        channelId: "chan-report", messageId: "msg-1", authorDiscordId: "author", reporterDiscordId: "reporter",
        messageUrl: "https://discord.com/channels/guild-1/chan-report/msg-1", excerpt: "message signalé" } });

      expect(await teams.dissolveCommunityTeam(ids.leader, ids.community, team.id)).toBe("open_report_or_appeal");
      expect(await db.communityTeamMember.count({ where: { teamId: team.id } })).toBe(1);

      await db.moderationReport.update({ where: { id: report.id }, data: { closedAt: new Date() } });
      expect(await teams.dissolveCommunityTeam(ids.leader, ids.community, team.id)).toBe("dissolved");
      expect(await db.communityTeamMember.count({ where: { teamId: team.id } })).toBe(0);
    });

    it("refuse tant qu'une contestation Tower sur un défi de l'équipe est ouverte", async () => {
      const team = await setupTeam("appeal");
      const definition = await db.towerChallengeDefinition.create({ data: { communityId: ids.community,
        title: "Défi", instructions: "Réaliser le défi.", rewardFloors: 1 } });
      const attempt = await db.towerChallengeAttempt.create({ data: { communityId: ids.community,
        userId: ids.leader, teamId: team.id, definitionId: definition.id, requestKey: "req-appeal",
        title: "Défi", instructions: "Réaliser le défi.", rewardFloors: 1,
        assignedAt: new Date("2030-01-01T00:00:00Z"), expiresAt: new Date("2030-01-03T00:00:00Z"),
        status: "REJECTED", rejectedAt: new Date("2030-01-03T01:00:00Z") } });
      const appeal = await db.towerChallengeAppeal.create({ data: { communityId: ids.community,
        attemptId: attempt.id, authorUserId: ids.leader, reason: "Contestation du verdict.",
        dueAt: new Date("2030-01-08") } });

      expect(await teams.dissolveCommunityTeam(ids.leader, ids.community, team.id)).toBe("open_report_or_appeal");
      expect(await db.communityTeamMember.count({ where: { teamId: team.id } })).toBe(1);

      await db.towerChallengeAppeal.update({ where: { id: appeal.id }, data: { status: "UPHELD", decidedAt: new Date() } });
      expect(await teams.dissolveCommunityTeam(ids.leader, ids.community, team.id)).toBe("dissolved");
    });
  });

  it("prevents deleting a game from cascading into its community teams", async () => {
    await teams.createCommunityTeam({ userId: ids.leader, communityId: ids.community, gameId: ids.game, name: "Explorateurs", description: "Projet durable.", platform: "PC", maxMembers: 4 });

    await expect(db.game.delete({ where: { id: ids.game } })).rejects.toMatchObject({ code: "P2003" });
    await expect(db.communityTeam.count({ where: { gameId: ids.game } })).resolves.toBe(1);
  });
});
