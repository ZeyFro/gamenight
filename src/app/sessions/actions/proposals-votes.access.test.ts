import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentUser,
  checkRateLimit,
  sessionFindUnique,
  proposalFindUnique,
  proposalCreate,
  voteFindUnique,
  voteCreate,
  isVotingOpen,
  canAccessSession,
  redirect,
  revalidatePath,
  awardXp,
  checkVotesCastBadges,
} = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  checkRateLimit: vi.fn(),
  sessionFindUnique: vi.fn(),
  proposalFindUnique: vi.fn(),
  proposalCreate: vi.fn(),
  voteFindUnique: vi.fn(),
  voteCreate: vi.fn(),
  isVotingOpen: vi.fn(),
  canAccessSession: vi.fn(),
  redirect: vi.fn((location: string) => {
    throw new Error(`REDIRECT:${location}`);
  }),
  revalidatePath: vi.fn(),
  awardXp: vi.fn(),
  checkVotesCastBadges: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit, RATE_LIMIT_ERROR_KEY: "rate_limited" }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/sessions", () => ({ isVotingOpen }));
vi.mock("@/lib/session-access", () => ({ canAccessSession }));
vi.mock("@/lib/xp-actions", () => ({ awardXp }));
vi.mock("@/lib/xp", () => ({ XP_AMOUNTS: { VOTE: 1 } }));
vi.mock("@/lib/badges", () => ({ checkVotesCastBadges }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: sessionFindUnique },
    proposal: { findUnique: proposalFindUnique, create: proposalCreate },
    vote: { findUnique: voteFindUnique, create: voteCreate, delete: vi.fn() },
  },
}));

import { proposeGame, toggleVote } from "./proposals-votes";

/**
 * Chantier confidentialité des soirées — proposer un jeu ou voter est
 * réservé au créateur et aux invités actifs d'une soirée. Ces tests
 * prouvent qu'un `sessionId`/`proposalId` RÉEL et VALIDE (jamais forgé)
 * ne suffit PAS à agir si l'appelant n'a pas d'accès — la vérification se
 * fait via `canAccessSession`, jamais déduite indirectement d'autre chose.
 */
describe("proposeGame / toggleVote — réservés au créateur et aux invités actifs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimit.mockReturnValue(true);
    isVotingOpen.mockReturnValue(true);
  });

  it("proposeGame : un utilisateur non invité (session réelle et ouverte au vote) ne peut rien proposer", async () => {
    getCurrentUser.mockResolvedValue({ id: "non-invite" });
    sessionFindUnique.mockResolvedValue({ status: "VOTING", date: new Date(), votingDeadline: null });
    canAccessSession.mockResolvedValue(false);

    const fd = new FormData();
    fd.set("sessionId", "session-reelle");
    fd.set("gameId", "game-1");
    await proposeGame(fd);

    expect(canAccessSession).toHaveBeenCalledWith("non-invite", "session-reelle");
    expect(proposalCreate).not.toHaveBeenCalled();
  });

  it("proposeGame : un invité actif peut proposer", async () => {
    getCurrentUser.mockResolvedValue({ id: "invite-actif" });
    sessionFindUnique.mockResolvedValue({ status: "VOTING", date: new Date(), votingDeadline: null });
    canAccessSession.mockResolvedValue(true);
    proposalCreate.mockResolvedValue({});

    const fd = new FormData();
    fd.set("sessionId", "session-reelle");
    fd.set("gameId", "game-1");
    await proposeGame(fd);

    expect(proposalCreate).toHaveBeenCalledWith({
      data: { sessionId: "session-reelle", gameId: "game-1", proposedById: "invite-actif" },
    });
  });

  it("toggleVote : un utilisateur non invité ne peut voter sur une proposition d'une soirée à laquelle il n'a pas accès", async () => {
    getCurrentUser.mockResolvedValue({ id: "non-invite" });
    proposalFindUnique.mockResolvedValue({
      sessionId: "session-reelle",
      session: { status: "VOTING", date: new Date(), votingDeadline: null },
    });
    canAccessSession.mockResolvedValue(false);

    const fd = new FormData();
    fd.set("proposalId", "proposal-1");
    const result = await toggleVote(fd);

    expect(canAccessSession).toHaveBeenCalledWith("non-invite", "session-reelle");
    expect(voteCreate).not.toHaveBeenCalled();
    // Réponse neutre (`ok: true`) même en cas de refus — jamais une fuite
    // d'information distinguant "refusé" de "rien à faire" pour le client
    // (même contrat que les autres branches no-op de cette action).
    expect(result).toEqual({ ok: true });
  });

  it("toggleVote : un invité actif peut voter", async () => {
    getCurrentUser.mockResolvedValue({ id: "invite-actif" });
    proposalFindUnique.mockResolvedValue({
      sessionId: "session-reelle",
      session: { status: "VOTING", date: new Date(), votingDeadline: null },
    });
    canAccessSession.mockResolvedValue(true);
    voteFindUnique.mockResolvedValue(null);
    voteCreate.mockResolvedValue({});

    const fd = new FormData();
    fd.set("proposalId", "proposal-1");
    await toggleVote(fd);

    expect(voteCreate).toHaveBeenCalledWith({ data: { proposalId: "proposal-1", userId: "invite-actif" } });
  });
});
