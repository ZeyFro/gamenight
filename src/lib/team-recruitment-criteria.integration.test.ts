import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
if (!TEST_DATABASE_URL) console.warn("[team-recruitment-criteria] TEST_DATABASE_URL absente : tests PostgreSQL SKIPPÉS, critères de recrutement NON validés sur SQL réel.");

const criteria = (teamId: string, override: Record<string, unknown> = {}) => ({
  teamId, goals: ["DETENTE", "COMPETITIF"] as ("DETENTE" | "COMPETITIF")[], minLevel: "INTERMEDIAIRE" as const, mic: "REQUIRED" as const,
  slots: ["WEEKEND_EVENING"] as "WEEKEND_EVENING"[], platforms: ["PC"], note: "Soirs de week-end",
  ...override,
});

describe.skipIf(!TEST_DATABASE_URL)("critères de recrutement d'équipe : PostgreSQL isolé", () => {
  let db: import("@prisma/client").PrismaClient;
  let lib: typeof import("./team-recruitment-criteria");
  let teams: typeof import("./community-teams");
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    lib = await import("./team-recruitment-criteria");
    teams = await import("./community-teams");
  });
  afterAll(async () => { await db?.$disconnect(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.stubEnv("TEAM_RECRUITMENT_CRITERIA_ENABLED", "true");
    await db.$executeRawUnsafe(`TRUNCATE "TeamRecruitmentCriteria", "CommunityTeamMember", "CommunityTeam", "Membership", "User", "Game", "Community" CASCADE`);
    ids.community = (await db.community.create({ data: { slug: "tower-criteria", name: "The Tower", status: "ACTIVE", communityTeamsEnabled: true } })).id;
    ids.other = (await db.community.create({ data: { slug: "other-criteria", name: "Other", status: "ACTIVE", communityTeamsEnabled: true } })).id;
    for (const name of ["captain", "member", "outsider"]) {
      ids[name] = (await db.user.create({ data: { discordId: name, discordName: name } })).id;
    }
    for (const [userId, communityId] of [[ids.captain, ids.community], [ids.member, ids.community], [ids.outsider, ids.other]]) {
      await db.membership.create({ data: { userId, communityId, status: "ACTIVE", joinedAt: new Date() } });
    }
    ids.game = (await db.game.create({ data: { name: "Valheim", source: "MANUAL", addedById: ids.captain } })).id;
    await teams.createCommunityTeam({ userId: ids.captain, communityId: ids.community, gameId: ids.game, name: "Expédition", description: "Construire et explorer ensemble.", platform: "PC", maxMembers: 4 });
    ids.team = (await db.communityTeam.findFirstOrThrow({ where: { communityId: ids.community } })).id;
    await teams.joinCommunityTeam(ids.member, ids.community, ids.team);
  });

  it("est inactif sans le drapeau : rien n'est lu ni écrit", async () => {
    vi.stubEnv("TEAM_RECRUITMENT_CRITERIA_ENABLED", "false");
    expect(await lib.getTeamRecruitmentCriteriaCommunityId(ids.captain)).toBeNull();
    expect(await lib.saveTeamRecruitmentCriteria(ids.captain, ids.community, criteria(ids.team))).toBe("unavailable");
    expect(await db.teamRecruitmentCriteria.count()).toBe(0);
    expect((await lib.listTeamRecruitmentCriteria(ids.captain, ids.community, [ids.team])).size).toBe(0);
  });

  it("le capitaine enregistre puis modifie ses critères (une seule ligne)", async () => {
    expect(await lib.saveTeamRecruitmentCriteria(ids.captain, ids.community, criteria(ids.team))).toBe("saved");
    expect(await lib.saveTeamRecruitmentCriteria(ids.captain, ids.community, criteria(ids.team, { mic: "PREFERRED", platforms: ["PC", "PS5"] }))).toBe("saved");
    expect(await db.teamRecruitmentCriteria.count()).toBe(1);
    const read = await lib.listTeamRecruitmentCriteria(ids.member, ids.community, [ids.team]);
    expect(read.get(ids.team)).toEqual({
      goals: ["DETENTE", "COMPETITIF"], minLevel: "INTERMEDIAIRE", mic: "PREFERRED", slots: ["WEEKEND_EVENING"], platforms: ["PC", "PS5"], note: "Soirs de week-end",
    });
  });

  it("un membre simple ne peut pas modifier les critères", async () => {
    expect(await lib.saveTeamRecruitmentCriteria(ids.member, ids.community, criteria(ids.team))).toBe("forbidden");
    expect(await db.teamRecruitmentCriteria.count()).toBe(0);
  });

  it("suit le capitanat : après transmission, l'ancien capitaine perd la main", async () => {
    expect(await teams.transferCommunityTeamCaptain(ids.captain, ids.community, ids.team, ids.member)).toBe("transferred");
    expect(await lib.saveTeamRecruitmentCriteria(ids.captain, ids.community, criteria(ids.team))).toBe("forbidden");
    expect(await lib.saveTeamRecruitmentCriteria(ids.member, ids.community, criteria(ids.team))).toBe("saved");
  });

  it("des critères vides suppriment la ligne", async () => {
    await lib.saveTeamRecruitmentCriteria(ids.captain, ids.community, criteria(ids.team));
    const empty = criteria(ids.team, { goals: [], minLevel: null, mic: null, slots: [], platforms: [], note: null });
    expect(await lib.saveTeamRecruitmentCriteria(ids.captain, ids.community, empty)).toBe("cleared");
    expect(await db.teamRecruitmentCriteria.count()).toBe(0);
    expect((await lib.listTeamRecruitmentCriteria(ids.captain, ids.community, [ids.team])).size).toBe(0);
  });

  it("isole les communautés : équipe inconnue ou membre d'un autre serveur", async () => {
    expect(await lib.saveTeamRecruitmentCriteria(ids.captain, ids.community, criteria("inconnue"))).toBe("missing");
    expect(await lib.saveTeamRecruitmentCriteria(ids.outsider, ids.community, criteria(ids.team))).toBe("unavailable");
    await lib.saveTeamRecruitmentCriteria(ids.captain, ids.community, criteria(ids.team));
    expect((await lib.listTeamRecruitmentCriteria(ids.outsider, ids.community, [ids.team])).size).toBe(0);
    expect((await lib.listTeamRecruitmentCriteria(ids.outsider, ids.other, [ids.team])).size).toBe(0);
  });

  it("la suppression de l'équipe supprime ses critères en cascade", async () => {
    await lib.saveTeamRecruitmentCriteria(ids.captain, ids.community, criteria(ids.team));
    await db.communityTeamMember.deleteMany({ where: { teamId: ids.team } });
    await db.communityTeam.delete({ where: { id: ids.team } });
    expect(await db.teamRecruitmentCriteria.count()).toBe(0);
  });
});
