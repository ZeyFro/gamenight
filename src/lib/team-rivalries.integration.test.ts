import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Rivalités entre équipes et « Intéressé » — intégration Postgres (CI uniquement, jamais en local : base partagée).
 * Nécessite `TEST_DATABASE_URL`. Suite entièrement SKIPPÉE si absente.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const mocks = vi.hoisted(() => ({ createNotification: vi.fn(async () => undefined) }));

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});
vi.mock("@/lib/notifications", () => ({ createNotification: mocks.createNotification }));

if (!TEST_DATABASE_URL) {
  console.warn("[team-rivalries.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE. Les défis, confirmations par les deux capitaines et intérêts ne sont PAS validés par cette exécution.");
}

describe.skipIf(!TEST_DATABASE_URL)("rivalités et intérêt (intégration Postgres)", () => {
  let db: import("@prisma/client").PrismaClient;
  let rivalries: typeof import("./team-rivalries");
  let interest: typeof import("./instant-session-interest");
  let communityId: string;
  let gameId: string;
  const H = 3_600_000;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as import("@prisma/client").PrismaClient;
    rivalries = await import("./team-rivalries");
    interest = await import("./instant-session-interest");
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("TEAM_RIVALRIES_ENABLED", "true");
    await db.$executeRawUnsafe(`TRUNCATE "TeamChallenge", "InstantSessionInterest", "InstantSessionPresenceInterval", "InstantSession", "CommunityTeamMember", "CommunityTeam", "Game", "User" CASCADE`);
    const community = await db.community.upsert({
      where: { slug: "default" },
      create: { slug: "default", name: "Défaut", status: "ACTIVE", communityTeamsEnabled: true },
      update: { status: "ACTIVE", communityTeamsEnabled: true },
      select: { id: true },
    });
    communityId = community.id;
    const seed = await db.user.create({ data: { discordId: `seed-${++counter}`, discordName: "seed" } });
    gameId = (await db.game.create({ data: { name: "Valheim", source: "MANUAL", addedById: seed.id } })).id;
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  let counter = 0;
  async function makeUser() {
    const id = `user-${++counter}`;
    const user = await db.user.create({ data: { discordId: id, discordName: id } });
    await db.membership.create({ data: { communityId, userId: user.id, status: "ACTIVE" } });
    return user;
  }
  async function makeTeam(captainId: string, withMate = true) {
    const team = await db.communityTeam.create({
      data: { communityId, gameId, createdById: captainId, captainId, name: `Équipe ${++counter}`, description: "Une équipe de test", platform: "PC", maxMembers: 4 },
    });
    await db.communityTeamMember.create({ data: { communityId, teamId: team.id, userId: captainId } });
    if (withMate) {
      const mate = await makeUser();
      await db.communityTeamMember.create({ data: { communityId, teamId: team.id, userId: mate.id } });
    }
    return team;
  }
  async function scene() {
    const capA = await makeUser();
    const capB = await makeUser();
    const teamA = await makeTeam(capA.id);
    const teamB = await makeTeam(capB.id);
    return { capA, capB, teamA, teamB };
  }
  const propose = (userId: string, challengerTeamId: string, opponentTeamId: string) =>
    rivalries.proposeChallenge(userId, communityId, { challengerTeamId, opponentTeamId });

  describe("défi", () => {
    it("seul le capitaine propose, jamais contre sa propre équipe, un seul défi ouvert par paire", async () => {
      const { capA, capB, teamA, teamB } = await scene();
      const mate = (await db.communityTeamMember.findFirstOrThrow({ where: { teamId: teamA.id, userId: { not: capA.id } } })).userId;
      expect(await propose(mate, teamA.id, teamB.id)).toEqual({ ok: false, reason: "forbidden" });
      expect(await propose(capA.id, teamA.id, teamA.id)).toEqual({ ok: false, reason: "same_team" });
      expect(await propose(capA.id, teamA.id, teamB.id)).toEqual({ ok: true });
      expect(mocks.createNotification).toHaveBeenCalledExactlyOnceWith({
        communityId,
        userId: capB.id,
        type: "REMINDER",
        title: "Défi d'une autre équipe",
        message: `${teamA.name} défie ${teamB.name}. Réponds depuis la fiche de ton équipe.`,
      });
      expect(await propose(capA.id, teamA.id, teamB.id)).toEqual({ ok: false, reason: "pair_open" });
      expect(mocks.createNotification).toHaveBeenCalledTimes(1);
    });

    it("flag éteint : tout est refusé", async () => {
      const { capA, teamA, teamB } = await scene();
      vi.stubEnv("TEAM_RIVALRIES_ENABLED", "");
      expect(await propose(capA.id, teamA.id, teamB.id)).toEqual({ ok: false, reason: "disabled" });
      expect(await db.teamChallenge.count()).toBe(0);
    });

    it("le défi n'est accepté que par le capitaine ADVERSE (ni le proposant, ni un coéquipier)", async () => {
      const { capA, capB, teamA, teamB } = await scene();
      await propose(capA.id, teamA.id, teamB.id);
      const challenge = await db.teamChallenge.findFirstOrThrow();
      expect(await rivalries.respondToChallenge(capA.id, communityId, challenge.id, "ACCEPT")).toEqual({ ok: false, reason: "forbidden" });
      const mateB = (await db.communityTeamMember.findFirstOrThrow({ where: { teamId: teamB.id, userId: { not: capB.id } } })).userId;
      expect(await rivalries.respondToChallenge(mateB, communityId, challenge.id, "ACCEPT")).toEqual({ ok: false, reason: "forbidden" });
      expect(await rivalries.respondToChallenge(capB.id, communityId, challenge.id, "ACCEPT")).toEqual({ ok: true });
      expect((await db.teamChallenge.findUniqueOrThrow({ where: { id: challenge.id } })).status).toBe("ACCEPTED");
      expect(mocks.createNotification).toHaveBeenNthCalledWith(2, {
        communityId,
        userId: capA.id,
        type: "REMINDER",
        title: "Défi accepté",
        message: `${teamB.name} a accepté le défi de ${teamA.name}.`,
      });
      expect(await rivalries.respondToChallenge(capB.id, communityId, challenge.id, "DECLINE")).toEqual({ ok: false, reason: "not_proposed" });
    });

    it("une proposition échue ne peut plus être acceptée et passe EXPIRED à la lecture", async () => {
      const { capA, capB, teamA, teamB } = await scene();
      await propose(capA.id, teamA.id, teamB.id);
      const challenge = await db.teamChallenge.findFirstOrThrow();
      await db.teamChallenge.update({ where: { id: challenge.id }, data: { expiresAt: new Date(Date.now() - H) } });
      expect(await rivalries.respondToChallenge(capB.id, communityId, challenge.id, "ACCEPT")).toEqual({ ok: false, reason: "expired" });
      await rivalries.getTeamRivalries(capA.id, communityId, teamA.id);
      expect((await db.teamChallenge.findUniqueOrThrow({ where: { id: challenge.id } })).status).toBe("EXPIRED");
    });

    it("un refus clôt le défi ; le proposant peut annuler avant tout résultat", async () => {
      const { capA, capB, teamA, teamB } = await scene();
      await propose(capA.id, teamA.id, teamB.id);
      const first = await db.teamChallenge.findFirstOrThrow();
      expect(await rivalries.respondToChallenge(capB.id, communityId, first.id, "DECLINE")).toEqual({ ok: true });
      expect(await propose(capA.id, teamA.id, teamB.id)).toEqual({ ok: true });
      const second = await db.teamChallenge.findFirstOrThrow({ where: { status: "PROPOSED" } });
      expect(await rivalries.cancelChallenge(capB.id, communityId, second.id)).toEqual({ ok: false, reason: "forbidden" });
      expect(await rivalries.cancelChallenge(capA.id, communityId, second.id)).toEqual({ ok: true });
    });
  });

  describe("résultat confirmé par les deux capitaines", () => {
    async function accepted() {
      const ctx = await scene();
      await propose(ctx.capA.id, ctx.teamA.id, ctx.teamB.id);
      const challenge = await db.teamChallenge.findFirstOrThrow();
      await rivalries.respondToChallenge(ctx.capB.id, communityId, challenge.id, "ACCEPT");
      return { ...ctx, challengeId: challenge.id };
    }

    it("déclaré par A, confirmé par B : défi terminé et bilan mis à jour des deux côtés", async () => {
      const { capA, capB, teamA, teamB, challengeId } = await accepted();
      expect(await rivalries.reportChallengeResult(capA.id, communityId, challengeId, "CHALLENGER_WON")).toEqual({ ok: true });
      expect((await db.teamChallenge.findUniqueOrThrow({ where: { id: challengeId } })).status).toBe("RESULT_REPORTED");
      // Avant confirmation, rien n'est compté.
      expect((await rivalries.getTeamRivalries(capA.id, communityId, teamA.id))?.record.played).toBe(0);
      expect(await rivalries.answerChallengeResult(capB.id, communityId, challengeId, "CONFIRM")).toEqual({ ok: true });
      expect(mocks.createNotification).toHaveBeenNthCalledWith(3, {
        communityId,
        userId: capB.id,
        type: "REMINDER",
        title: "Résultat à confirmer",
        message: `${teamA.name} a déclaré le résultat de votre défi. Confirme-le ou conteste-le.`,
      });
      expect(mocks.createNotification).toHaveBeenNthCalledWith(4, {
        communityId,
        userId: capA.id,
        type: "REMINDER",
        title: "Résultat confirmé",
        message: `${teamB.name} a confirmé le résultat du défi.`,
      });
      const done = await db.teamChallenge.findUniqueOrThrow({ where: { id: challengeId } });
      expect(done).toMatchObject({ status: "COMPLETED", outcome: "CHALLENGER_WON" });
      expect((await rivalries.getTeamRivalries(capA.id, communityId, teamA.id))?.record).toEqual({ played: 1, wins: 1, losses: 0, draws: 0 });
      expect((await rivalries.getTeamRivalries(capB.id, communityId, teamB.id))?.record).toEqual({ played: 1, wins: 0, losses: 1, draws: 0 });
    });

    it("le déclarant ne peut pas confirmer son propre résultat", async () => {
      const { capA, challengeId } = await accepted();
      await rivalries.reportChallengeResult(capA.id, communityId, challengeId, "DRAW");
      expect(await rivalries.answerChallengeResult(capA.id, communityId, challengeId, "CONFIRM")).toEqual({ ok: false, reason: "same_team" });
      expect((await db.teamChallenge.findUniqueOrThrow({ where: { id: challengeId } })).status).toBe("RESULT_REPORTED");
    });

    it("l'autre capitaine peut déclarer en premier ; un tiers ne peut ni déclarer ni confirmer", async () => {
      const { capB, challengeId } = await accepted();
      const stranger = await makeUser();
      const strangerTeam = await makeTeam(stranger.id);
      void strangerTeam;
      expect(await rivalries.reportChallengeResult(stranger.id, communityId, challengeId, "DRAW")).toEqual({ ok: false, reason: "forbidden" });
      expect(await rivalries.reportChallengeResult(capB.id, communityId, challengeId, "OPPONENT_WON")).toEqual({ ok: true });
      expect(await rivalries.answerChallengeResult(stranger.id, communityId, challengeId, "CONFIRM")).toEqual({ ok: false, reason: "forbidden" });
    });

    it("contestation : le résultat est rejeté, redéclarable, et le compteur monte", async () => {
      const { capA, capB, teamA, challengeId } = await accepted();
      await rivalries.reportChallengeResult(capA.id, communityId, challengeId, "CHALLENGER_WON");
      expect(await rivalries.answerChallengeResult(capB.id, communityId, challengeId, "DISPUTE")).toEqual({ ok: true });
      const reset = await db.teamChallenge.findUniqueOrThrow({ where: { id: challengeId } });
      expect(reset).toMatchObject({ status: "ACCEPTED", reportedOutcome: null, reportedByTeamId: null, disputeCount: 1, outcome: null });
      expect((await rivalries.getTeamRivalries(capA.id, communityId, teamA.id))?.record.played).toBe(0);
      expect(await rivalries.reportChallengeResult(capB.id, communityId, challengeId, "OPPONENT_WON")).toEqual({ ok: true });
      expect(await rivalries.answerChallengeResult(capA.id, communityId, challengeId, "CONFIRM")).toEqual({ ok: true });
      expect((await db.teamChallenge.findUniqueOrThrow({ where: { id: challengeId } })).outcome).toBe("OPPONENT_WON");
    });

    it("pas de résultat sur un défi non accepté, ni valeur inconnue", async () => {
      const { capA, teamA, teamB } = await scene();
      await propose(capA.id, teamA.id, teamB.id);
      const challenge = await db.teamChallenge.findFirstOrThrow();
      expect(await rivalries.reportChallengeResult(capA.id, communityId, challenge.id, "DRAW")).toEqual({ ok: false, reason: "not_accepted" });
      expect(await rivalries.reportChallengeResult(capA.id, communityId, challenge.id, "HACK")).toEqual({ ok: false, reason: "invalid" });
    });
  });

  describe("fiche d'équipe", () => {
    it("liste l'historique avec les actions possibles pour le seul capitaine", async () => {
      const { capA, capB, teamA, teamB } = await scene();
      await propose(capA.id, teamA.id, teamB.id);
      const asCaptainB = await rivalries.getTeamRivalries(capB.id, communityId, teamB.id);
      expect(asCaptainB?.history[0]).toMatchObject({ role: "opponent", canRespond: true, canCancel: false });
      const mateA = (await db.communityTeamMember.findFirstOrThrow({ where: { teamId: teamA.id, userId: { not: capA.id } } })).userId;
      const asMate = await rivalries.getTeamRivalries(mateA, communityId, teamA.id);
      expect(asMate?.isCaptain).toBe(false);
      expect(asMate?.history[0]).toMatchObject({ canRespond: false, canCancel: false, canReport: false });
    });

    it("un membre d'une autre communauté ne voit rien", async () => {
      const { teamA } = await scene();
      const other = await db.community.create({ data: { slug: `autre-${++counter}`, name: "Autre", status: "ACTIVE", communityTeamsEnabled: true } });
      const outsider = await db.user.create({ data: { discordId: `out-${++counter}`, discordName: "out" } });
      await db.membership.create({ data: { communityId: other.id, userId: outsider.id, status: "ACTIVE" } });
      expect(await rivalries.getTeamRivalries(outsider.id, communityId, teamA.id)).toBeNull();
    });
  });

  describe("Jouer maintenant : Intéressé", () => {
    async function makeInstant(creatorId: string, expiresInMs = 2 * H) {
      const now = new Date();
      return db.instantSession.create({
        data: { communityId: null, createdById: creatorId, gameId, createdAt: now, expiresAt: new Date(now.getTime() + expiresInMs) },
      });
    }

    it("marque et efface son intérêt ; idempotent", async () => {
      const creator = await makeUser();
      const player = await makeUser();
      const session = await makeInstant(creator.id);
      expect(await interest.markInstantSessionInterest(session.id, player.id, new Date(0))).toEqual({ ok: true });
      expect(await interest.markInstantSessionInterest(session.id, player.id, new Date(0))).toEqual({ ok: true });
      expect(mocks.createNotification).toHaveBeenCalledExactlyOnceWith({
        communityId: null,
        userId: creator.id,
        type: "REMINDER",
        title: "Quelqu'un est intéressé",
        message: "Un joueur est intéressé par ta soirée « Jouer maintenant ».",
      });
      expect(await db.instantSessionInterest.count()).toBe(1);
      const listed = await interest.listInstantSessionInterest(session.id, player.id);
      expect(listed.viewerIsInterested).toBe(true);
      expect(listed.interested.map((row) => row.userId)).toEqual([player.id]);
      expect(await interest.clearInstantSessionInterest(session.id, player.id)).toBe(true);
      expect(await db.instantSessionInterest.count()).toBe(0);
    });

    it("refuse le créateur, un participant présent, une session terminée ou échue", async () => {
      const creator = await makeUser();
      const player = await makeUser();
      const session = await makeInstant(creator.id);
      expect(await interest.markInstantSessionInterest(session.id, creator.id, new Date(0))).toEqual({ ok: false, reason: "creator" });
      await db.instantSessionPresenceInterval.create({ data: { instantSessionId: session.id, userId: player.id, startedAt: new Date() } });
      expect(await interest.markInstantSessionInterest(session.id, player.id, new Date(0))).toEqual({ ok: false, reason: "participant" });
      const ended = await makeInstant(creator.id);
      await db.instantSession.update({ where: { id: ended.id }, data: { status: "ENDED", endedAt: new Date() } });
      const other = await makeUser();
      expect(await interest.markInstantSessionInterest(ended.id, other.id, new Date(0))).toEqual({ ok: false, reason: "ended" });
      const stale = await makeInstant(creator.id, -H);
      expect(await interest.markInstantSessionInterest(stale.id, other.id)).toEqual({ ok: false, reason: "ended" });
    });

    it("C084 — défi confirmé par les deux capitaines, puis trois intéressés dont un rejoint", async () => {
      const { capA, capB, teamA, teamB } = await scene();
      await propose(capA.id, teamA.id, teamB.id);
      const challenge = await db.teamChallenge.findFirstOrThrow();
      expect(await rivalries.respondToChallenge(capB.id, communityId, challenge.id, "ACCEPT")).toEqual({ ok: true });
      expect(await rivalries.reportChallengeResult(capA.id, communityId, challenge.id, "CHALLENGER_WON")).toEqual({ ok: true });
      expect(await rivalries.answerChallengeResult(capB.id, communityId, challenge.id, "CONFIRM")).toEqual({ ok: true });
      expect(await db.teamChallenge.findUniqueOrThrow({ where: { id: challenge.id } })).toMatchObject({ status: "COMPLETED", outcome: "CHALLENGER_WON" });
      expect((await rivalries.getTeamRivalries(capA.id, communityId, teamA.id))?.record).toEqual({ played: 1, wins: 1, losses: 0, draws: 0 });
      expect((await rivalries.getTeamRivalries(capB.id, communityId, teamB.id))?.record).toEqual({ played: 1, wins: 0, losses: 1, draws: 0 });
      expect((await rivalries.getTeamRivalries(capB.id, communityId, teamB.id))?.history[0]).toMatchObject({ role: "opponent" });

      const creator = await makeUser();
      const players = [await makeUser(), await makeUser(), await makeUser()];
      const session = await makeInstant(creator.id);
      await db.instantSessionPresenceInterval.create({ data: { instantSessionId: session.id, userId: creator.id, startedAt: new Date() } });
      for (const player of players) expect(await interest.markInstantSessionInterest(session.id, player.id, new Date(0))).toEqual({ ok: true });
      const listed = await interest.listInstantSessionInterest(session.id, players[1].id);
      expect(listed.interested.map((row) => row.userId).sort()).toEqual(players.map((player) => player.id).sort());
      expect(listed.viewerIsInterested).toBe(true);

      const { joinInstantSession } = await import("./instant-sessions");
      expect((await joinInstantSession(session.id, players[1].id)).ok).toBe(true);
      const after = await interest.listInstantSessionInterest(session.id, players[0].id);
      expect(after.interested.map((row) => row.userId).sort()).toEqual([players[0].id, players[2].id].sort());
      expect(after.viewerIsInterested).toBe(true);
    });

    it("rejoindre efface l'intérêt", async () => {
      const { joinInstantSession } = await import("./instant-sessions");
      const creator = await makeUser();
      const player = await makeUser();
      const session = await makeInstant(creator.id);
      await db.instantSessionPresenceInterval.create({ data: { instantSessionId: session.id, userId: creator.id, startedAt: new Date() } });
      await interest.markInstantSessionInterest(session.id, player.id, new Date(0));
      expect((await joinInstantSession(session.id, player.id)).ok).toBe(true);
      expect(await db.instantSessionInterest.count()).toBe(0);
    });

    it("flag éteint : aucun intérêt enregistré", async () => {
      const creator = await makeUser();
      const player = await makeUser();
      const session = await makeInstant(creator.id);
      vi.stubEnv("TEAM_RIVALRIES_ENABLED", "");
      expect(await interest.markInstantSessionInterest(session.id, player.id, new Date(0))).toEqual({ ok: false, reason: "disabled" });
      expect(await db.instantSessionInterest.count()).toBe(0);
    });
  });
});
