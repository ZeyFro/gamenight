import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_PROPOSALS_PER_SESSION, PROPOSAL_LIMIT_MESSAGE } from "@/lib/session-proposal-limit";
import { VOTE_XP_CAP_PER_SESSION } from "@/lib/xp";

/**
 * Audit du 23/11/2026, constat 1.10 : au plus MAX_PROPOSALS_PER_SESSION propositions par soirée et au plus
 * VOTE_XP_CAP_PER_SESSION gains d'XP « VOTE » par membre et par soirée (décompte dans le ledger XpEvent). Suite SKIPPÉE sans
 * `TEST_DATABASE_URL` (Postgres jetable en 127.0.0.1, jamais Neon).
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const { currentUser } = vi.hoisted(() => ({ currentUser: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((location: string) => {
    throw new Error(`REDIRECT:${location}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: currentUser }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true, RATE_LIMIT_ERROR_KEY: "rate_limited" }));
// Jamais de vraie notification Discord depuis un test : ni annonce de niveau, ni badge (hors sujet ici).
vi.mock("@/lib/discord-level-up", () => ({ announceLevelUp: vi.fn(async () => undefined) }));
vi.mock("@/lib/badges", () => ({ checkVotesCastBadges: vi.fn(async () => undefined) }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : ({} as unknown) };
});

if (!TEST_DATABASE_URL) {
  console.warn("[proposals-votes.caps.integration.test] TEST_DATABASE_URL absente - suite SKIPPÉE : les plafonds de vote ne sont PAS validés sur Postgres.");
}

describe.skipIf(!TEST_DATABASE_URL)("plafonds de propositions et d'XP de vote (intégration Postgres)", () => {
  let db: import("@prisma/client").PrismaClient;
  let actions: typeof import("./proposals-votes");
  let n = 0;
  const uniq = (label: string) => `${label}-${++n}`;
  let communityId: string;
  let votantId: string;

  beforeAll(async () => {
    expect(new URL(TEST_DATABASE_URL!).hostname).toBe("127.0.0.1");
    db = (await import("@/lib/prisma")).prisma as unknown as import("@prisma/client").PrismaClient;
    actions = await import("./proposals-votes");
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(`TRUNCATE "SessionVeto", "Vote", "Proposal", "Session", "UserGame", "Game", "User", "Community" CASCADE`);
    (await import("@/lib/default-community")).resetDefaultCommunityIdCache();
    communityId = (await db.community.create({ data: { slug: "default", name: "default", status: "ACTIVE" } })).id;
    const user = await db.user.create({ data: { discordId: uniq("votant"), discordName: "votant" } });
    await db.membership.create({ data: { userId: user.id, communityId, status: "ACTIVE", role: "MEMBER" } });
    votantId = user.id;
    currentUser.mockResolvedValue({ id: votantId });
  });

  /** Soirée en cours de vote créée par le votant (accès garanti, sans invitation). */
  const makeSession = () =>
    db.session.create({
      data: { date: new Date("2027-06-06T20:00:00Z"), createdById: votantId, status: "VOTING", communityId },
    });
  const makeGame = () =>
    db.game.create({ data: { name: uniq("jeu"), source: "MANUAL", minPlayers: 1, maxPlayers: null, addedById: votantId } });
  /** Propose via l'action réelle (donc soumise au plafond). */
  async function propose(sessionId: string) {
    const game = await makeGame();
    const fd = new FormData();
    fd.set("sessionId", sessionId);
    fd.set("gameId", game.id);
    return actions.proposeGame(fd);
  }
  /** Ajoute `count` propositions directement en base (état hérité d'avant le plafond, ou autre chemin de création). */
  async function seedProposals(sessionId: string, count: number) {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const game = await makeGame();
      ids.push((await db.proposal.create({ data: { sessionId, gameId: game.id, proposedById: votantId } })).id);
    }
    return ids;
  }
  const vote = (proposalId: string) => {
    const fd = new FormData();
    fd.set("proposalId", proposalId);
    return actions.toggleVote(fd);
  };
  const voteGains = (sessionProposalIds?: string[]) =>
    db.xpEvent.count({
      where: { userId: votantId, reason: "VOTE", ...(sessionProposalIds ? { sourceId: { in: sessionProposalIds } } : {}) },
    });

  describe("propositions par soirée", () => {
    it("les 10 premières sont acceptées, la 11ᵉ est refusée avec un message français, et rien n'est créé", async () => {
      const session = await makeSession();
      for (let i = 1; i <= MAX_PROPOSALS_PER_SESSION; i++) expect(await propose(session.id)).toEqual({ ok: true });
      expect(await db.proposal.count({ where: { sessionId: session.id } })).toBe(MAX_PROPOSALS_PER_SESSION);

      const refused = await propose(session.id);
      expect(refused).toEqual({ ok: false, error: PROPOSAL_LIMIT_MESSAGE });
      expect(await db.proposal.count({ where: { sessionId: session.id } })).toBe(MAX_PROPOSALS_PER_SESSION);
    });

    it("le plafond est propre à chaque soirée", async () => {
      const [a, b] = [await makeSession(), await makeSession()];
      for (let i = 1; i <= MAX_PROPOSALS_PER_SESSION; i++) await propose(a.id);
      expect((await propose(a.id)).ok).toBe(false);
      expect(await propose(b.id)).toEqual({ ok: true });
    });

    it("retirer une proposition libère une place", async () => {
      const session = await makeSession();
      for (let i = 1; i <= MAX_PROPOSALS_PER_SESSION; i++) await propose(session.id);
      const first = await db.proposal.findFirstOrThrow({ where: { sessionId: session.id }, orderBy: { createdAt: "asc" } });
      const fd = new FormData();
      fd.set("proposalId", first.id);
      fd.set("sessionId", session.id);
      await actions.withdrawProposalAction(fd);
      expect(await propose(session.id)).toEqual({ ok: true });
      expect(await db.proposal.count({ where: { sessionId: session.id } })).toBe(MAX_PROPOSALS_PER_SESSION);
    });

    it("des ajouts simultanés ne dépassent jamais le plafond (verrou de la soirée)", async () => {
      const session = await makeSession();
      const results = await Promise.all(Array.from({ length: MAX_PROPOSALS_PER_SESSION + 3 }, () => propose(session.id)));
      expect(await db.proposal.count({ where: { sessionId: session.id } })).toBe(MAX_PROPOSALS_PER_SESSION);
      expect(results.filter((r) => r.ok)).toHaveLength(MAX_PROPOSALS_PER_SESSION);
      expect(results.filter((r) => !r.ok)).toHaveLength(3);
    });
  });

  describe("gains d'XP « VOTE » par soirée", () => {
    it("soirée normale (10 propositions, 10 votes) : chaque vote rapporte de l'XP, comme avant", async () => {
      const session = await makeSession();
      const ids = await seedProposals(session.id, MAX_PROPOSALS_PER_SESSION);
      for (const id of ids) await vote(id);
      expect(await voteGains(ids)).toBe(MAX_PROPOSALS_PER_SESSION);
      expect(await db.vote.count({ where: { userId: votantId } })).toBe(MAX_PROPOSALS_PER_SESSION);
    });

    it("le 11ᵉ vote d'une soirée ne rapporte plus d'XP, mais le vote est bien enregistré", async () => {
      const session = await makeSession();
      const ids = await seedProposals(session.id, VOTE_XP_CAP_PER_SESSION + 1);
      for (const id of ids) expect(await vote(id)).toEqual({ ok: true });
      expect(await db.vote.count({ where: { userId: votantId } })).toBe(VOTE_XP_CAP_PER_SESSION + 1);
      expect(await voteGains(ids)).toBe(VOTE_XP_CAP_PER_SESSION);
      expect(await db.xpEvent.count({ where: { userId: votantId, reason: "VOTE", sourceId: ids[ids.length - 1] } })).toBe(0);
      const stats = await db.communityMemberStats.findFirstOrThrow({ where: { userId: votantId } });
      const gained = await db.xpEvent.aggregate({ where: { userId: votantId, reason: "VOTE" }, _sum: { amount: true } });
      expect(stats.xpTotal).toBe(gained._sum.amount);
    });

    it("dévoter puis revoter ne recrédite rien (idempotent, sous comme au plafond)", async () => {
      const session = await makeSession();
      const ids = await seedProposals(session.id, VOTE_XP_CAP_PER_SESSION + 1);
      for (const id of ids) await vote(id);
      for (const id of [ids[0], ids[ids.length - 1]]) {
        await vote(id); // dévote
        await vote(id); // revote
      }
      expect(await voteGains(ids)).toBe(VOTE_XP_CAP_PER_SESSION);
    });

    it("le plafond est propre à la soirée : voter dans une autre soirée rapporte encore de l'XP", async () => {
      const [a, b] = [await makeSession(), await makeSession()];
      const idsA = await seedProposals(a.id, VOTE_XP_CAP_PER_SESSION + 1);
      for (const id of idsA) await vote(id);
      const [autre] = await seedProposals(b.id, 1);
      await vote(autre);
      expect(await voteGains(idsA)).toBe(VOTE_XP_CAP_PER_SESSION);
      expect(await voteGains([autre])).toBe(1);
    });

    it("le plafond est propre au membre : un autre votant garde ses gains", async () => {
      const session = await makeSession();
      const ids = await seedProposals(session.id, VOTE_XP_CAP_PER_SESSION + 1);
      for (const id of ids) await vote(id);
      const autre = await db.user.create({ data: { discordId: uniq("autre"), discordName: "autre" } });
      await db.membership.create({ data: { userId: autre.id, communityId, status: "ACTIVE", role: "MEMBER" } });
      await db.sessionInvite.create({ data: { sessionId: session.id, userId: autre.id, invitedById: votantId, status: "ACTIVE" } });
      currentUser.mockResolvedValue({ id: autre.id });
      await vote(ids[0]);
      expect(await db.xpEvent.count({ where: { userId: autre.id, reason: "VOTE" } })).toBe(1);
    });

    it("proposer, voter puis retirer en boucle ne contourne pas le plafond (les gains d'une proposition retirée comptent)", async () => {
      const session = await makeSession();
      const retraits = [];
      for (let i = 1; i <= VOTE_XP_CAP_PER_SESSION + 1; i++) {
        await propose(session.id);
        const proposal = await db.proposal.findFirstOrThrow({ where: { sessionId: session.id }, orderBy: { createdAt: "desc" } });
        await vote(proposal.id);
        const fd = new FormData();
        fd.set("proposalId", proposal.id);
        fd.set("sessionId", session.id);
        await actions.withdrawProposalAction(fd);
        retraits.push(proposal.id);
      }
      expect(await db.proposal.count({ where: { sessionId: session.id } })).toBe(0);
      expect(await voteGains(retraits)).toBe(VOTE_XP_CAP_PER_SESSION);
    });

    it("des votes simultanés ne dépassent jamais le plafond (verrou de la ligne de stats)", async () => {
      const session = await makeSession();
      const ids = await seedProposals(session.id, VOTE_XP_CAP_PER_SESSION + 3);
      await Promise.all(ids.map((id) => vote(id)));
      expect(await db.vote.count({ where: { userId: votantId } })).toBe(VOTE_XP_CAP_PER_SESSION + 3);
      expect(await voteGains(ids)).toBe(VOTE_XP_CAP_PER_SESSION);
    });
  });
});
