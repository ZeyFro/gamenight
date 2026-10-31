import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const url = process.env.TEST_DATABASE_URL;
const neonDomain = ["neon", "tech"].join(".");
const testDatabaseUrl = (databaseName: string, host = `ep-test.${neonDomain}`, ssl = true) =>
  `${["postgresql:", "//"].join("")}user:pass@${host}/${databaseName}${ssl ? "?sslmode=require" : ""}`;
const testDatabaseGuard = (value: string, allowedHost?: string, allowRemote = false) => {
  const database = new URL(value);
  if (database.hostname === "127.0.0.1") return;
  if (allowRemote && database.hostname.endsWith(`.${neonDomain}`) && database.hostname === allowedHost && database.pathname === "/tower_test" && database.searchParams.get("sslmode") === "require") return;
  throw new Error("Postgres isolé uniquement : Neon exige l'hôte explicitement autorisé, tower_test et sslmode=require");
};
const towerTestGuildId = "987654321098765432";
const clock = vi.hoisted(() => ({ now: new Date("2026-10-28T12:00:00Z") }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (url) testDatabaseGuard(url, process.env.TEST_DATABASE_HOST, process.env.TEST_DATABASE_ALLOW_REMOTE === "true");
  return { prisma: url ? new PrismaClient({ datasourceUrl: url }) : {} };
});
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/notification-executor-kick", () => ({ kickNotificationExecutor: vi.fn() }));
vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomInt: vi.fn(() => 0) };
});
if (!url) console.warn("[tower-challenge-storage] Postgres absent : intégrations ignorées.");

describe("garde de la base d'intégration Tower", () => {
  it("n'autorise que Postgres local ou l'hôte Neon explicitement allowlisté pour tower_test", () => {
    expect(() => testDatabaseGuard("postgresql://user:pass@127.0.0.1:5432/gamenight_test")).not.toThrow();
    const host = `ep-test.${neonDomain}`;
    expect(() => testDatabaseGuard(testDatabaseUrl("tower_test", host), host)).toThrow();
    expect(() => testDatabaseGuard(testDatabaseUrl("tower_test", host), host, true)).not.toThrow();
    expect(() => testDatabaseGuard(testDatabaseUrl("neondb", host), host)).toThrow();
    expect(() => testDatabaseGuard(testDatabaseUrl("tower_test", `ep-other.${neonDomain}`), host)).toThrow();
    expect(() => testDatabaseGuard(testDatabaseUrl("tower_test", host, false), host)).toThrow();
  });
});

describe.skipIf(!url)("défis solo et votes persistants", () => {
  let db: import("@prisma/client").PrismaClient;
  let api: typeof import("./tower-challenges");
  const author = { communityId: "tower-a", userId: "tower-author" };
  const members = ["tower-author", "tower-a1", "tower-a2", "tower-a3", "tower-a4", "tower-outsider"];
  const claimInput = (n = 1) => ({ ...author, requestKey: "tower-claim-key-" + String(n).padStart(8, "0") });
  const proof = (attemptId: string) => ({
    ...author, attemptId, proofText: "Voici ma réalisation.",
    proofChannelId: "123456789012345678", proofMessageId: "223456789012345678", publicationConsent: true,
  });
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    api = await import("./tower-challenges");
    vi.spyOn(Date, "now").mockImplementation(() => clock.now.getTime());
  });
  afterAll(async () => { await db?.$disconnect(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    clock.now = new Date("2026-10-28T12:00:00Z");
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    vi.stubEnv("TOWER_DISCORD_ANNOUNCE_ENABLED", "false");
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    await db.notificationEvent.deleteMany({ where: { communityId: { in: ["tower-a", "tower-b"] } } });
    await db.towerSeasonVoteBallot.deleteMany({ where: { communityId: { in: ["tower-a", "tower-b"] } } });
    await db.towerSeasonVote.deleteMany({ where: { communityId: { in: ["tower-a", "tower-b"] } } });
    await db.towerChallengeAttempt.deleteMany({ where: { communityId: { in: ["tower-a", "tower-b"] } } });
    await db.communityTeamMember.deleteMany({ where: { communityId: { in: ["tower-a", "tower-b"] } } });
    await db.communityTeam.deleteMany({ where: { communityId: { in: ["tower-a", "tower-b"] } } });
    await db.game.deleteMany({ where: { id: "tower-team-game" } });
    await db.towerChallengeDefinition.deleteMany({ where: { communityId: { in: ["tower-a", "tower-b"] } } });
    await db.towerChallengeProgress.deleteMany({ where: { communityId: { in: ["tower-a", "tower-b"] } } });
    await db.membership.deleteMany({ where: { communityId: { in: ["tower-a", "tower-b"] } } });
    await db.community.deleteMany({ where: { id: { in: ["tower-a", "tower-b"] } } });
    await db.user.deleteMany({ where: { OR: [{ id: { in: members } }, { discordId: "333333333333333333" }] } });
    await db.community.createMany({ data: ["tower-a", "tower-b"].map(id => ({
      id, slug: id, name: id, status: "ACTIVE", towerChallengesEnabled: true,
    })) });
    await db.user.createMany({ data: members.map(id => ({ id, discordId: id, discordName: id })) });
    await db.membership.createMany({ data: members.map(userId => ({
      communityId: userId === "tower-outsider" ? "tower-b" : "tower-a", userId, status: "ACTIVE",
    })) });
    await db.towerChallengeDefinition.createMany({ data: ["tower-a", "tower-b"].map(communityId => ({
      id: communityId + "-easy", communityId, title: "Création libre",
      instructions: "Réalise une création dans le jeu de ton choix.", rewardFloors: 1, active: true,
    })) });
  });
  async function claim(n = 1) {
    const result = await api.claimSoloTowerChallenge(claimInput(n));
    expect(result.status).toBe("CLAIMED");
    if (result.status !== "CLAIMED") throw new Error("Attribution attendue");
    return result.attemptId;
  }
  async function submitted(n = 1) {
    const id = await claim(n);
    expect((await api.submitTowerChallengeProof(proof(id))).status).toBe("SUBMITTED");
    return id;
  }
  async function vote(id: string, userId: string, approve: boolean) {
    return api.voteTowerChallenge({ communityId: "tower-a", userId, attemptId: id, approve });
  }
  async function approve(id: string) {
    for (const userId of ["tower-a1", "tower-a2", "tower-a3"]) expect((await vote(id, userId, true)).status).toBe("VOTED");
  }
  const settle = (attemptId: string) => api.settleTowerChallenge({ ...author, attemptId });

  it("évite de répéter un défi déjà joué tant qu'un défi accessible reste", async () => {
    await db.towerChallengeDefinition.createMany({ data: ["tower-a-second", "tower-a-third"].map(id => ({
      id, communityId: "tower-a", title: id, instructions: "Un autre défi.", rewardFloors: 1, active: true,
    })) });
    const ids: string[] = [];
    for (let n = 1; n <= 4; n++) {
      ids.push(await claim(n));
      if (n < 4) clock.now = new Date(clock.now.getTime() + 12 * 3600000);
    }
    const rows = await Promise.all(ids.map(id => db.towerChallengeAttempt.findUniqueOrThrow({
      where: { id }, select: { definitionId: true },
    })));
    expect(new Set(rows.slice(0, 3).map(row => row.definitionId)).size).toBe(3);
    expect(new Set(rows.slice(0, 3).map(row => row.definitionId)).has(rows[3].definitionId)).toBe(true);
  });

  it("ouvre un vote communautaire unique après la clôture du trimestre, depuis le top actif", async () => {
    await db.towerChallengeAttempt.createMany({ data: ["tower-a1", "tower-a2"].map((userId, index) => ({
      id: "season-finalist-" + index, communityId: "tower-a", userId, definitionId: "tower-a-easy",
      requestKey: "season-finalist-" + index, title: "Défi saison", instructions: "À réaliser",
      rewardFloors: index + 2, assignedAt: new Date("2026-04-02T12:00:00Z"),
      expiresAt: new Date("2026-04-04T12:00:00Z"), status: "APPROVED" as const,
      submittedAt: new Date("2026-04-03T12:00:00Z"), proofText: "Preuve", proofChannelId: "123456789012345678",
      proofMessageId: "223456789012345678", publicationConsent: true,
      rewardedAt: new Date("2026-04-03T13:00:00Z"),
    })) });
    clock.now = new Date("2026-07-01T12:00:00Z");
    expect((await api.getTowerSeasonVote(author)).status).toBe("VOTE_OPEN");
    const first = await api.getTowerSeasonVote(author);
    if (first.status !== "VOTE_OPEN") throw new Error("Scrutin attendu ouvert");
    const replay = await api.getTowerSeasonVote(author);
    expect(first).toMatchObject({ status: "VOTE_OPEN", season: { active: false }, closesAt: new Date("2026-07-03T12:00:00Z") });
    expect(replay).toMatchObject({ status: "VOTE_OPEN", voteId: first.voteId });
    expect(first.candidates.map(candidate => candidate.userId)).toEqual(["tower-a2", "tower-a1"]);
    expect(await db.towerSeasonVote.count({ where: { communityId: "tower-a" } })).toBe(1);
    expect(await api.castTowerSeasonVote({ ...author, voteId: first.voteId, candidateUserId: "tower-a2" })).toMatchObject({ status: "SEASON_VOTE_SAVED" });
    const duplicateBallots = await Promise.all([1, 2].map(() =>
      api.castTowerSeasonVote({ communityId: "tower-a", userId: "tower-a3", voteId: first.voteId, candidateUserId: "tower-a1" })));
    expect(duplicateBallots.map(result => result.status).sort()).toEqual(["SEASON_VOTE_ALREADY_CAST", "SEASON_VOTE_SAVED"]);
    expect(await api.castTowerSeasonVote({ communityId: "tower-a", userId: "tower-a2", voteId: first.voteId, candidateUserId: "tower-a2" })).toMatchObject({ status: "SEASON_VOTE_SELF" });
    clock.now = new Date("2026-07-03T13:00:00Z");
    const closed = await api.getTowerSeasonVote(author);
    if (closed.status !== "VOTE_CLOSED") throw new Error("Scrutin attendu clôturé");
    expect(closed.candidates.find(candidate => candidate.userId === "tower-a2")?.votes).toBe(1);
    expect(await db.towerSeasonVoteBallot.count({ where: { communityId: "tower-a" } })).toBe(2);
  });
  it("ouvre le vote du trimestre achevé même pendant l'année scolaire active", async () => {
    await db.towerChallengeAttempt.createMany({ data: ["tower-a1", "tower-a2"].map((userId, index) => ({
      id: "season-boundary-" + index, communityId: "tower-a", userId, definitionId: "tower-a-easy",
      requestKey: "season-boundary-" + index, title: "Défi trimestre", instructions: "À réaliser",
      rewardFloors: index + 2, assignedAt: new Date("2026-09-02T12:00:00Z"),
      expiresAt: new Date("2026-09-04T12:00:00Z"), status: "APPROVED" as const,
      submittedAt: new Date("2026-09-03T12:00:00Z"), proofText: "Preuve",
      proofChannelId: "123456789012345678", proofMessageId: "223456789012345678",
      publicationConsent: true, rewardedAt: new Date("2026-09-03T13:00:00Z"),
    })) });
    clock.now = new Date("2027-01-01T12:00:00Z");
    const opened = await api.getTowerSeasonVote(author);
    if (opened.status !== "VOTE_OPEN") throw new Error("Scrutin du trimestre terminé attendu");
    expect(opened.season.name).toContain("Trimestre 1");
    expect(opened.season.active).toBe(false);
    expect(opened.closesAt).toEqual(new Date("2027-01-03T12:00:00Z"));

    clock.now = new Date("2027-01-02T12:00:00Z");
    const stillOpen = await api.getTowerSeasonVote(author);
    expect(stillOpen).toMatchObject({ status: "VOTE_OPEN", voteId: opened.voteId });
    clock.now = new Date("2027-01-03T12:00:00Z");
    const closed = await api.getTowerSeasonVote(author);
    expect(closed).toMatchObject({ status: "VOTE_CLOSED", voteId: opened.voteId });
  });

  it("attribue une seule fois sous doubles clics et conserve la fenêtre de 48 h", async () => {
    const results = await Promise.all([api.claimSoloTowerChallenge(claimInput()), api.claimSoloTowerChallenge(claimInput())]);
    expect(results.every(r => r.status === "CLAIMED")).toBe(true);
    expect(await db.towerChallengeAttempt.count()).toBe(1);
    const row = await db.towerChallengeAttempt.findFirstOrThrow();
    expect(row.expiresAt.getTime() - row.assignedAt.getTime()).toBe(48 * 3600000);
    expect((await api.claimSoloTowerChallenge(claimInput(2))).status).toBe("COOLDOWN");
    clock.now = new Date("2026-10-29T00:00:00Z");
    expect((await api.claimSoloTowerChallenge(claimInput(2))).status).toBe("CLAIMED");
  });
  it("n'offre pas deux défis quand les clés concurrentes diffèrent", async () => {
    const results = await Promise.all([api.claimSoloTowerChallenge(claimInput(1)), api.claimSoloTowerChallenge(claimInput(2))]);
    expect(results.map(r => r.status).sort()).toEqual(["CLAIMED", "COOLDOWN"]);
    expect(await db.towerChallengeAttempt.count()).toBe(1);
  });
  it("fige le défi et son gain au tirage, même si le catalogue change", async () => {
    const id = await submitted();
    await db.towerChallengeDefinition.update({ where: { id: "tower-a-easy" }, data: { title: "Modifié", rewardFloors: 3 } });
    await approve(id);
    clock.now = new Date("2026-10-29T12:00:00Z");
    expect(await settle(id)).toMatchObject({ status: "APPROVED", rewardFloors: 1 });
    expect((await db.towerChallengeAttempt.findUniqueOrThrow({ where: { id } })).title).toBe("Création libre");
  });
  it("permet une preuve sans consentement au partage général", async () => {
    const id = await claim();
    expect(await api.submitTowerChallengeProof({ ...proof(id), publicationConsent: false })).toMatchObject({ status: "SUBMITTED", replayed: false });
    expect((await db.towerChallengeAttempt.findUniqueOrThrow({ where: { id } })).publicationConsent).toBe(false);
  });
  it("refuse la preuve à 48 h exactement", async () => {
    const id = await claim();
    clock.now = new Date("2026-10-30T12:00:00Z");
    expect((await api.submitTowerChallengeProof(proof(id))).status).toBe("EXPIRED");
    expect(await db.towerChallengeVote.count()).toBe(0);
  });
  it("un dépôt rejoué ne change ni la preuve ni la fermeture du vote", async () => {
    const id = await submitted();
    clock.now = new Date("2026-10-28T13:00:00Z");
    expect(await api.submitTowerChallengeProof(proof(id))).toMatchObject({ status: "SUBMITTED", replayed: true });
    expect((await api.submitTowerChallengeProof({ ...proof(id), proofText: "Autre preuve" })).status).toBe("CONFLICT");
    expect((await db.towerChallengeAttempt.findUniqueOrThrow({ where: { id } })).submittedAt?.toISOString()).toBe("2026-10-28T12:00:00.000Z");
  });
  it("interdit le vote pour soi, les doublons et les votes tardifs", async () => {
    const id = await submitted();
    expect((await vote(id, "tower-author", true)).status).toBe("SELF_VOTE");
    const responses = await Promise.all([vote(id, "tower-a1", true), vote(id, "tower-a1", true)]);
    expect(responses.every(r => r.status === "VOTED")).toBe(true);
    expect(await db.towerChallengeVote.count()).toBe(1);
    expect((await vote(id, "tower-a1", false)).status).toBe("ALREADY_VOTED");
    clock.now = new Date("2026-10-29T12:00:00Z");
    expect((await vote(id, "tower-a2", true)).status).toBe("CLOSED");
  });
  it("une clôture concurrente récompense une seule fois", async () => {
    const id = await submitted();
    expect((await vote(id, "tower-a1", true)).status).toBe("VOTED");
    expect((await vote(id, "tower-a2", true)).status).toBe("VOTED");
    expect((await vote(id, "tower-a3", false)).status).toBe("VOTED");
    expect((await settle(id)).status).toBe("OPEN");
    clock.now = new Date("2026-10-29T12:00:00Z");
    const results = await Promise.all([settle(id), settle(id)]);
    expect(results.every(r => r.status === "APPROVED")).toBe(true);
    expect((await db.towerChallengeProgress.findUniqueOrThrow({ where: { communityId_userId: author } })).floorsClimbed).toBe(BigInt(1));
    expect(await db.towerChallengeAttempt.count({ where: { rewardedAt: { not: null } } })).toBe(1);
  });
  it("attribue un seul défi quotidien par équipe et crédite ses participants sous le quota solo/équipe partagé", async () => {
    await db.community.update({ where: { id: "tower-a" }, data: { communityTeamsEnabled: true } });
    const game = await db.game.create({ data: { id: "tower-team-game", name: "Tower Team Game", source: "MANUAL", addedById: "tower-author" } });
    const team = await db.communityTeam.create({ data: {
      id: "tower-team-a", communityId: "tower-a", gameId: game.id, createdById: "tower-author",
      name: "Les grimpeurs", description: "Défis partagés", platform: "PC", maxMembers: 5,
    } });
    await db.communityTeamMember.createMany({ data: ["tower-author", "tower-a1"].map(userId => ({
      communityId: "tower-a", teamId: team.id, userId,
    })) });
    await db.towerChallengeDefinition.create({ data: {
      id: "tower-a-team", communityId: "tower-a", mode: "TEAM", title: "Le défi collectif",
      instructions: "Jouez ensemble.", rewardFloors: 2, active: true,
    } });
    const first = await api.getTeamDailyTowerChallenge({ ...author, teamId: team.id });
    const second = await api.getTeamDailyTowerChallenge({ communityId: "tower-a", userId: "tower-a1", teamId: team.id });
    expect(first.status).toBe("TEAM_CHALLENGE");
    if (first.status !== "TEAM_CHALLENGE" || second.status !== "TEAM_CHALLENGE") throw new Error("Défi partagé attendu");
    expect(second.attempt.id).toBe(first.attempt.id);
    expect(first.pendingReward).toBe(false);
    expect(await db.towerChallengeAttempt.count({ where: { teamId: team.id } })).toBe(1);
    expect((await api.joinTowerTeamChallenge({ ...author, attemptId: first.attempt.id })).status).toBe("JOINED");
    expect((await api.joinTowerTeamChallenge({ communityId: "tower-a", userId: "tower-a1", attemptId: first.attempt.id })).status).toBe("JOINED");
    expect((await api.submitTowerChallengeProof(proof(first.attempt.id))).status).toBe("SUBMITTED");
    expect((await api.voteTowerChallenge({ communityId: "tower-a", userId: "tower-a1", attemptId: first.attempt.id, approve: true })).status).toBe("SELF_VOTE");
    for (const userId of ["tower-a2", "tower-a3", "tower-a4"]) {
      expect((await api.voteTowerChallenge({ communityId: "tower-a", userId, attemptId: first.attempt.id, approve: true })).status).toBe("VOTED");
    }
    await db.towerChallengeAttempt.createMany({ data: ["2026-10-29T09:00:00Z", "2026-10-29T10:00:00Z"].map((rewardedAt, index) => ({
      id: "solo-cap-" + index, communityId: "tower-a", userId: "tower-author", definitionId: "tower-a-easy",
      requestKey: "solo-cap-" + index, title: "Réussite solo", instructions: "Déjà validée.", rewardFloors: 1,
      assignedAt: new Date("2026-10-28T00:00:00Z"), expiresAt: new Date("2026-10-30T00:00:00Z"),
      status: "APPROVED" as const, rewardedAt: new Date(rewardedAt),
    })) });
    clock.now = new Date("2026-10-29T12:00:00Z");
    expect(await api.settleTowerChallenge({ ...author, attemptId: first.attempt.id })).toMatchObject({
      status: "APPROVED", rewardedMembers: 1, pendingRewards: 1, userRewarded: false,
    });
    expect((await db.towerChallengeProgress.findUniqueOrThrow({ where: { communityId_userId: { communityId: "tower-a", userId: "tower-a1" } } })).floorsClimbed).toBe(BigInt(2));
    expect((await db.towerChallengeProgress.findUnique({ where: { communityId_userId: author } }))?.floorsClimbed ?? BigInt(0)).toBe(BigInt(0));
    clock.now = new Date("2026-10-30T12:00:00Z");
    expect(await api.settleTowerChallenge({ ...author, attemptId: first.attempt.id })).toMatchObject({
      status: "APPROVED", rewardedMembers: 1, pendingRewards: 0, userRewarded: true, replayed: true,
    });
    expect((await db.towerChallengeProgress.findUniqueOrThrow({ where: { communityId_userId: author } })).floorsClimbed).toBe(BigInt(2));
    expect(await db.towerChallengeAttemptParticipant.count({ where: { attemptId: first.attempt.id, rewardedAt: { not: null } } })).toBe(2);
  });
  it("laisse une preuve en attente après 24 h si le quorum de trois votes manque", async () => {
    const id = await submitted();
    await vote(id, "tower-a1", true); await vote(id, "tower-a2", false);
    clock.now = new Date("2026-10-29T12:00:00Z");
    expect(await settle(id)).toMatchObject({ status: "OPEN", approvals: 1, rejections: 1 });
    expect((await db.towerChallengeAttempt.findUniqueOrThrow({ where: { id } })).status).toBe("SUBMITTED");
    expect((await db.towerChallengeProgress.findUniqueOrThrow({ where: { communityId_userId: author } })).floorsClimbed).toBe(BigInt(0));
  });
  it("refuse une égalité après le quorum et ne récompense pas l'étage", async () => {
    const id = await submitted();
    for (const [userId, approve] of [
      ["tower-a1", true], ["tower-a2", true], ["tower-a3", false], ["tower-a4", false],
    ] as const) expect((await vote(id, userId, approve)).status).toBe("VOTED");
    clock.now = new Date("2026-10-29T12:00:00Z");
    expect(await settle(id)).toMatchObject({ status: "REJECTED" });
    expect(await db.towerChallengeVote.count({ where: { attemptId: id } })).toBe(4);
    expect((await db.towerChallengeAttempt.findUniqueOrThrow({ where: { id } })).status).toBe("REJECTED");
    expect((await db.towerChallengeProgress.findUniqueOrThrow({ where: { communityId_userId: author } })).floorsClimbed).toBe(BigInt(0));
  });
  it("laisse une preuve sans bulletin en attente après 24 heures faute de quorum", async () => {
    vi.stubEnv("TOWER_DISCORD_GUILD_ID", towerTestGuildId);
    await db.community.update({ where: { id: "tower-a" }, data: { discordGuildId: towerTestGuildId } });
    const id = await submitted();
    clock.now = new Date("2026-10-29T12:00:00Z");
    const summary = await api.settleDueTowerChallenges(new Date(clock.now.getTime() + 5000));
    expect(summary.processed).toBe(0);
    expect((await api.settleTowerChallenge({ ...author, attemptId: id })).status).toBe("OPEN");
    const attempt = await db.towerChallengeAttempt.findUniqueOrThrow({ where: { id } });
    expect(attempt.status).toBe("SUBMITTED");
    expect(attempt.rewardedAt).toBeNull();
    expect((await db.towerChallengeProgress.findUniqueOrThrow({ where: { communityId_userId: author } })).floorsClimbed).toBe(BigInt(0));
  });
  it("refuse le membre externe, le membre retiré et la communauté suspendue", async () => {
    const id = await submitted();
    expect((await api.voteTowerChallenge({ communityId: "tower-a", userId: "tower-outsider", attemptId: id, approve: true })).status).toBe("UNAVAILABLE");
    expect((await api.submitTowerChallengeProof({ ...proof(id), communityId: "tower-b" })).status).toBe("UNAVAILABLE");
    await db.membership.update({ where: { communityId_userId: author }, data: { status: "LEFT" } });
    expect((await settle(id)).status).toBe("UNAVAILABLE");
    await db.community.update({ where: { id: "tower-a" }, data: { status: "SUSPENDED" } });
    expect((await vote(id, "tower-a1", true)).status).toBe("UNAVAILABLE");
  });
  it("bloque la troisième récompense du jour même sous concurrence", async () => {
    const first = await submitted(1); await approve(first);
    clock.now = new Date("2026-10-29T00:00:00Z");
    const second = await submitted(2); await approve(second);
    clock.now = new Date("2026-10-29T12:00:00Z");
    const third = await submitted(3); await approve(third);
    clock.now = new Date("2026-10-30T12:00:00Z");
    const results = await Promise.all([settle(first), settle(second), settle(third)]);
    expect(results.filter(r => r.status === "APPROVED")).toHaveLength(2);
    expect(results.filter(r => r.status === "DAILY_LIMIT")).toHaveLength(1);
    expect((await db.towerChallengeProgress.findUniqueOrThrow({ where: { communityId_userId: author } })).floorsClimbed).toBe(BigInt(2));
  });
  it("refuse les boutons périmés si un drapeau est OFF", async () => {
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "false");
    expect((await api.claimSoloTowerChallenge(claimInput())).status).toBe("DISABLED");
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    await db.community.update({ where: { id: "tower-a" }, data: { towerChallengesEnabled: false } });
    expect((await api.claimSoloTowerChallenge(claimInput())).status).toBe("UNAVAILABLE");
    expect(await db.towerChallengeAttempt.count()).toBe(0);
  });

  it("crée un participant Discord sans lui donner de pouvoir staff", async () => {
    await db.community.update({ where: { id: "tower-a" }, data: { discordGuildId: towerTestGuildId } });
    const origin = { guildId: towerTestGuildId, discordId: "333333333333333333", username: "Nouveau joueur" };
    const resolved = await api.resolveTowerDiscordActor(origin);
    expect(resolved).toMatchObject({ communityId: "tower-a" });
    const person = await db.user.findUniqueOrThrow({ where: { discordId: origin.discordId } });
    expect(person.role).toBe("USER");
    expect(await db.membership.findUniqueOrThrow({ where: { communityId_userId: { communityId: "tower-a", userId: person.id } } })).toMatchObject({ status: "ACTIVE", role: "MEMBER" });
    expect(await api.resolveTowerDiscordActor(origin)).toEqual(resolved);
    expect(await db.user.count({ where: { discordId: origin.discordId } })).toBe(1);
  });
  it("ne réactive pas une appartenance retirée et ne crée rien si le module est éteint", async () => {
    await db.community.update({ where: { id: "tower-a" }, data: { discordGuildId: towerTestGuildId } });
    const origin = { guildId: towerTestGuildId, discordId: "333333333333333333", username: "Nouveau" };
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "false");
    expect(await api.resolveTowerDiscordActor(origin)).toBeNull();
    expect(await db.user.count({ where: { discordId: origin.discordId } })).toBe(0);
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    const resolved = await api.resolveTowerDiscordActor(origin);
    if (!resolved) throw new Error("Participant attendu");
    await db.membership.update({ where: { communityId_userId: resolved }, data: { status: "REMOVED" } });
    expect(await api.resolveTowerDiscordActor(origin)).toBeNull();
    expect((await db.membership.findUniqueOrThrow({ where: { communityId_userId: resolved } })).status).toBe("REMOVED");
  });
  it("présente uniquement les défis du membre et sérialise son étage sans BigInt brut", async () => {
    const id = await claim();
    expect(await api.getTowerChallengeState({ ...author, attemptId: id })).toMatchObject({ status: "STATE", floor: "1", attempts: [{ id }] });
    expect(await api.getTowerChallengeState({ communityId: "tower-a", userId: "tower-a1", attemptId: id })).toMatchObject({ status: "STATE", attempts: [] });
    const state = await api.getTowerChallengeState(author);
    expect(() => JSON.stringify(state)).not.toThrow();
  });

  it("met en file une seule preuve et une seule réussite sans appel Discord", async () => {
    vi.stubEnv("TOWER_DISCORD_ANNOUNCE_ENABLED", "true");
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "true");
    vi.stubEnv("TOWER_DISCORD_GUILD_ID", towerTestGuildId);
    vi.stubEnv("TOWER_DISCORD_CHANNEL_ID", "123456789012345678");
    vi.stubEnv("TOWER_DISCORD_GENERAL_CHANNEL_ID", "444444444444444444");
    await db.community.update({ where: { id: "tower-a" }, data: { discordGuildId: towerTestGuildId } });
    const id = await submitted();
    await api.submitTowerChallengeProof(proof(id));
    const event = await db.notificationEvent.findFirstOrThrow({ where: { sourceId: id, eventType: "TOWER_PROOF_SUBMITTED" } });
    expect(await db.notificationEvent.count({ where: { sourceId: id, eventType: "TOWER_PROOF_SUBMITTED" } })).toBe(1);
    const delivery = await db.notificationDelivery.findFirstOrThrow({ where: { eventId: event.id } });
    const { towerChallengeAnnounceResolver } = await import("./tower-challenge-announcements");
    const input = { event, delivery: delivery as unknown as import("./notification-executor").ResolveInput["delivery"], now: clock.now };
    expect(await towerChallengeAnnounceResolver.resolve(input)).toMatchObject({
      eligible: true, action: { kind: "send_channel_message_verified", channelId: "123456789012345678", message: { allowedMentions: { parse: [] }, components: expect.any(Array) } },
    });
    vi.stubEnv("TOWER_DISCORD_ANNOUNCE_ENABLED", "false");
    expect(await towerChallengeAnnounceResolver.resolve(input)).toMatchObject({ eligible: false });
    vi.stubEnv("TOWER_DISCORD_ANNOUNCE_ENABLED", "true");
    await approve(id);
    clock.now = new Date("2026-10-29T12:00:00Z");
    await Promise.all([settle(id), settle(id)]);
    const success = await db.notificationEvent.findFirstOrThrow({ where: { sourceId: id, eventType: "TOWER_CHALLENGE_APPROVED" } });
    expect(await db.notificationEvent.count({ where: { sourceId: id, eventType: "TOWER_CHALLENGE_APPROVED" } })).toBe(1);
    const successDelivery = await db.notificationDelivery.findFirstOrThrow({ where: { eventId: success.id } });
    expect(await towerChallengeAnnounceResolver.resolve({ event: success, delivery: successDelivery as unknown as typeof input.delivery, now: clock.now })).toMatchObject({
      eligible: true, action: { kind: "send_channel_message_verified", channelId: "444444444444444444", message: { allowedMentions: { parse: [] } } },
    });
  });
  it("clôture automatiquement à 24 h une seule fois et laisse sans quorum en attente", async () => {
    vi.stubEnv("TOWER_DISCORD_GUILD_ID", towerTestGuildId);
    await db.community.update({ where: { id: "tower-a" }, data: { discordGuildId: towerTestGuildId } });
    const id = await submitted();
    await approve(id);
    const other = { communityId: "tower-a", userId: "tower-a1" };
    const second = await api.claimSoloTowerChallenge({ ...other, requestKey: "tower-another-key-000001" });
    if (second.status !== "CLAIMED") throw new Error("Second défi attendu");
    await api.submitTowerChallengeProof({ ...proof(second.attemptId), ...other });
    clock.now = new Date("2026-10-29T11:59:59Z");
    const beforeClose = await api.settleDueTowerChallenges(new Date(clock.now.getTime() + 5000));
    expect(beforeClose.processed).toBe(0);
    expect((await db.towerChallengeAttempt.findUniqueOrThrow({ where: { id } })).status).toBe("SUBMITTED");
    clock.now = new Date("2026-10-29T12:00:00Z");
    const summaries = await Promise.all([
      api.settleDueTowerChallenges(new Date(clock.now.getTime() + 5000)),
      api.settleDueTowerChallenges(new Date(clock.now.getTime() + 5000)),
    ]);
    expect((await db.towerChallengeAttempt.findUniqueOrThrow({ where: { id } })).status).toBe("APPROVED");
    expect((await db.towerChallengeAttempt.findUniqueOrThrow({ where: { id: second.attemptId } })).status).toBe("SUBMITTED");
    expect(summaries.reduce((total, summary) => total + summary.processed, 0)).toBeGreaterThanOrEqual(1);
    expect(summaries.every(summary => summary.failed === 0)).toBe(true);
    expect(await db.towerChallengeAttempt.count({ where: { rewardedAt: { not: null } } })).toBe(1);
    expect((await db.towerChallengeProgress.findUniqueOrThrow({ where: { communityId_userId: author } })).floorsClimbed).toBe(BigInt(1));
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "false");
    expect(await api.settleDueTowerChallenges(new Date(clock.now.getTime() + 5000))).toMatchObject({ processed: 0 });
  });
  it("importe le pack de départ une seule fois sans réactiver un défi désactivé", async () => {
    await db.community.update({ where: { id: "tower-a" }, data: { discordGuildId: towerTestGuildId } });
    const first = await api.importSoloTowerChallengeStarterPack({ guildId: towerTestGuildId });
    expect(first).toEqual({ status: "IMPORTED", added: 12, alreadyPresent: 0 });

    const starterChallenge = await db.towerChallengeDefinition.findFirstOrThrow({
      where: { communityId: "tower-a", title: "Le guide touristique du chaos" },
      select: { id: true },
    });
    await db.towerChallengeDefinition.update({ where: { id: starterChallenge.id }, data: { active: false } });
    const second = await api.importSoloTowerChallengeStarterPack({ guildId: towerTestGuildId });
    expect(second).toEqual({ status: "IMPORTED", added: 0, alreadyPresent: 12 });
    expect(await db.towerChallengeDefinition.count({ where: { communityId: "tower-a", mode: "SOLO" } })).toBe(13);
    expect(await db.towerChallengeDefinition.findFirstOrThrow({
      where: { communityId: "tower-a", title: "Le guide touristique du chaos" },
      select: { active: true },
    })).toEqual({ active: false });
  });

});

