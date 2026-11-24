import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const getCurrentUserMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/current-user", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true, RATE_LIMIT_MESSAGE: "limite" }));
vi.mock("@/lib/shared-rate-limit", () => ({ checkSharedRateLimit: async () => true }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

if (!TEST_DATABASE_URL) console.warn("[delegation-access.integration] TEST_DATABASE_URL absente — test ignoré.");

/**
 * Audit du 23/11/2026 (🟡 « Actions de délégation ») : un tiers NON MEMBRE, un membre d'un AUTRE serveur et un simple membre sans le
 * droit requis ne peuvent ni modifier la charte, ni créer ou supprimer une date du calendrier, ni gérer une équipe, ni lancer, annuler ou
 * supprimer un tournoi qu'ils n'ont pas créé. Chaque essai doit être refusé ET ne rien écrire (état relu en base).
 */
describe.skipIf(!TEST_DATABASE_URL)("actions de délégation : refus d'un tiers, sans écriture (Postgres)", () => {
  type Db = import("@prisma/client").PrismaClient;
  let db: Db;
  const COMMUNITY = "deleg-a";
  const OTHER = "deleg-b";
  const attackers = ["stranger", "outsider", "member"] as const;

  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };
  /** Appelle l'action ; une redirection (refus ou fin normale) est attendue, toute autre erreur remonte. */
  async function run(userId: string, action: (data: FormData) => Promise<unknown>, data: FormData) {
    getCurrentUserMock.mockResolvedValue({ id: userId, discordId: userId, discordName: userId });
    try { await action(data); } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("REDIRECT:")) throw error;
    }
  }

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as Db;
  });
  afterAll(async () => { await db?.$disconnect(); vi.unstubAllEnvs(); });

  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    await db.$executeRawUnsafe('TRUNCATE "Tournament", "CommunityTeam", "Membership", "Community", "User", "Game" CASCADE');
    await db.community.createMany({ data: [
      { id: COMMUNITY, slug: COMMUNITY, name: "Serveur A", status: "ACTIVE", fairPlayCharter: "Charte A", communityTeamsEnabled: true },
      { id: OTHER, slug: OTHER, name: "Serveur B", status: "ACTIVE", fairPlayCharter: "Charte B", communityTeamsEnabled: true },
    ] });
    const users: [string, string | null][] = [["owner", COMMUNITY], ["captain", COMMUNITY], ["member", COMMUNITY], ["successor", COMMUNITY], ["outsider", OTHER], ["stranger", null]];
    for (const [index, [id, active]] of users.entries()) {
      await db.user.create({ data: { id, discordId: "deleg-" + index, discordName: id, ...(active ? { activeCommunityId: active } : {}) } });
    }
    await db.membership.createMany({ data: [
      { userId: "owner", communityId: COMMUNITY, status: "ACTIVE", role: "ADMIN" },
      { userId: "captain", communityId: COMMUNITY, status: "ACTIVE", role: "MEMBER" },
      { userId: "member", communityId: COMMUNITY, status: "ACTIVE", role: "MEMBER" },
      { userId: "successor", communityId: COMMUNITY, status: "ACTIVE", role: "MEMBER" },
      { userId: "outsider", communityId: OTHER, status: "ACTIVE", role: "MEMBER" },
    ] });
    await db.game.create({ data: { id: "deleg-game", name: "Jeu délégation", source: "MANUAL", addedById: "owner" } });
  });

  it("charte : seuls OWNER et ADMIN du serveur actif l'écrivent", async () => {
    const { saveFairPlayCharterAction } = await import("./charte/actions");
    for (const attacker of attackers) {
      await run(attacker, saveFairPlayCharterAction, form({ charter: "Charte piratée", communityId: COMMUNITY }));
    }
    expect(await db.community.findUniqueOrThrow({ where: { id: COMMUNITY } })).toMatchObject({ fairPlayCharter: "Charte A" });
    expect(await db.community.findUniqueOrThrow({ where: { id: OTHER } })).toMatchObject({ fairPlayCharter: "Charte B" });
  });

  it("calendrier : date importante réservée au staff, suppression réservée au créateur, au staff ou à l'intéressé", async () => {
    const { createCommunityDateAction, deleteCommunityDateAction, saveCommunityBirthdayAction } = await import("./calendrier/actions");
    for (const attacker of attackers) {
      await run(attacker, createCommunityDateAction, form({ date: "2027-03-01", title: "Date piratée" }));
    }
    expect(await db.communityDate.count()).toBe(0);
    for (const attacker of ["stranger", "outsider"] as const) {
      await run(attacker, saveCommunityBirthdayAction, form({ date: "1999-04-02" }));
    }
    // « outsider » est membre actif de SON serveur : son anniversaire s'y enregistre, jamais dans le serveur A.
    expect(await db.communityDate.count({ where: { communityId: COMMUNITY } })).toBe(0);
    expect(await db.communityDate.count({ where: { memberId: "stranger" } })).toBe(0);
    await db.communityDate.deleteMany();

    await db.communityDate.createMany({ data: [
      { id: "deleg-important", communityId: COMMUNITY, createdById: "owner", kind: "IMPORTANT", title: "Tournoi annuel", date: new Date("2027-05-01") },
      { id: "deleg-birthday", communityId: COMMUNITY, createdById: "captain", memberId: "captain", kind: "BIRTHDAY", date: new Date("2000-06-06"), repeatsAnnually: true },
    ] });
    for (const attacker of attackers) {
      await run(attacker, deleteCommunityDateAction, form({ id: "deleg-important" }));
      await run(attacker, deleteCommunityDateAction, form({ id: "deleg-birthday" }));
    }
    expect(await db.communityDate.count()).toBe(2);
  });

  it("équipes : un tiers ne modifie, ne transfère ni ne dissout l'équipe d'un autre", async () => {
    await db.communityTeam.create({ data: {
      id: "deleg-team", communityId: COMMUNITY, gameId: "deleg-game", createdById: "captain", captainId: "captain",
      name: "Équipe A", description: "Équipe de test.", platform: "PC", maxMembers: 4, isRecruiting: true, color: "#ff0000", emblem: "🐉",
    } });
    await db.communityTeamMember.createMany({ data: [
      { communityId: COMMUNITY, teamId: "deleg-team", userId: "captain" },
      { communityId: COMMUNITY, teamId: "deleg-team", userId: "successor" },
    ] });
    const actions = await import("./equipes/actions");
    for (const attacker of attackers) {
      await run(attacker, actions.setCommunityTeamRecruitmentAction, form({ teamId: "deleg-team", open: "false" }));
      await run(attacker, actions.setCommunityTeamIdentityAction, form({ teamId: "deleg-team", color: "#00ff00", emblem: "🦊" }));
      await run(attacker, actions.transferCommunityTeamCaptainAction, form({ teamId: "deleg-team", successorId: attacker === "member" ? "member" : "successor" }));
      await run(attacker, actions.dissolveCommunityTeamAction, form({ teamId: "deleg-team", confirm: "DISSOLVE" }));
    }
    const team = await db.communityTeam.findUniqueOrThrow({ where: { id: "deleg-team" } });
    expect(team).toMatchObject({ captainId: "captain", isRecruiting: true, color: "#ff0000", emblem: "🐉" });
    expect(await db.communityTeamMember.count({ where: { teamId: "deleg-team" } })).toBe(2);
  });

  it("tournois : lancer, annuler et supprimer sont réservés au créateur ; un tiers ne s'inscrit pas", async () => {
    await db.tournament.createMany({ data: [
      { id: "deleg-reg", name: "Inscriptions", createdById: "captain", gameId: "deleg-game", maxPlayers: 4, communityId: COMMUNITY, status: "REGISTRATION" },
      { id: "deleg-run", name: "En cours", createdById: "captain", gameId: "deleg-game", maxPlayers: 4, communityId: COMMUNITY, status: "IN_PROGRESS" },
    ] });
    const actions = await import("./tournois/actions");
    for (const attacker of attackers) {
      await run(attacker, actions.launchTournamentAction, form({ tournamentId: "deleg-reg" }));
      await run(attacker, actions.cancelTournamentAction, form({ tournamentId: "deleg-run" }));
      await run(attacker, (data) => actions.deleteTournamentAction({ error: null }, data), form({ tournamentId: "deleg-reg" }));
    }
    for (const attacker of ["stranger", "outsider"] as const) {
      await run(attacker, actions.registerForTournamentAction, form({ tournamentId: "deleg-reg" }));
    }
    expect(await db.tournament.findUniqueOrThrow({ where: { id: "deleg-reg" } })).toMatchObject({ status: "REGISTRATION" });
    expect(await db.tournament.findUniqueOrThrow({ where: { id: "deleg-run" } })).toMatchObject({ status: "IN_PROGRESS" });
    expect(await db.tournamentParticipant.count()).toBe(0);
  });
});
