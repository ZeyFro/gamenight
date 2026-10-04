import { beforeEach, describe, expect, it, vi } from "vitest";

const { prisma } = vi.hoisted(() => ({
  prisma: {
    session: { findUnique: vi.fn(), findMany: vi.fn() },
    superlativeVote: { findMany: vi.fn() },
    proposal: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma }));
vi.mock("@/lib/wallclock", () => ({ wallClockNow: vi.fn() }));
vi.mock("@/lib/xp-actions", () => ({ awardXp: vi.fn() }));
vi.mock("@/lib/discord-session-awards", () => ({ announceSessionAwards: vi.fn() }));
vi.mock("@/lib/badges", () => ({ checkSuperlativesWonBadges: vi.fn() }));
vi.mock("@/lib/pronostics", () => ({ resolvePronostics: vi.fn() }));
vi.mock("@/lib/xp-bets", () => ({ resolveBets: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotifications: vi.fn() }));

import {
  forceFinalizeSuperlativeVoting,
  getPendingSuperlativeVoteSessionIds,
  getWinningProposalParticipants,
  isCarryOrMvpCategory,
} from "./superlative-voting";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isCarryOrMvpCategory", () => {
  it.each(["MVP de la soirée", "Le Carry", "carry du jour", "Super MVP", "CARRY"])(
    "%j est une catégorie Carry/MVP",
    (name) => {
      expect(isCarryOrMvpCategory(name)).toBe(true);
    }
  );

  it.each(["Le plus drôle", "Rage quit", ""])("%j n'en est pas une", (name) => {
    expect(isCarryOrMvpCategory(name)).toBe(false);
  });
});

describe("getWinningProposalParticipants", () => {
  it("renvoie les utilisateurs ayant voté pour la proposition gagnante", async () => {
    prisma.proposal.findFirst.mockResolvedValue({
      votes: [{ user: { id: "u1" } }, { user: { id: "u2" } }],
    });
    expect(await getWinningProposalParticipants("s1", "g1")).toEqual([{ id: "u1" }, { id: "u2" }]);
    expect(prisma.proposal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionId: "s1", gameId: "g1" } })
    );
  });

  it("renvoie [] si la proposition n'existe pas", async () => {
    prisma.proposal.findFirst.mockResolvedValue(null);
    expect(await getWinningProposalParticipants("s1", "g1")).toEqual([]);
  });
});

describe("getPendingSuperlativeVoteSessionIds", () => {
  it("liste vide : aucune requête", async () => {
    expect(await getPendingSuperlativeVoteSessionIds("u1", [])).toEqual(new Set());
    expect(prisma.session.findMany).not.toHaveBeenCalled();
  });

  it("aucune session DONE avec vote ouvert : ensemble vide", async () => {
    prisma.session.findMany.mockResolvedValue([]);
    expect(await getPendingSuperlativeVoteSessionIds("u1", ["s1"])).toEqual(new Set());
    expect(prisma.superlativeVote.findMany).not.toHaveBeenCalled();
  });

  it("retient les sessions où l'utilisateur est participant et n'a pas encore voté", async () => {
    prisma.session.findMany.mockResolvedValue([
      { id: "s1", decidedGameId: "g1" }, // participant, pas voté → en attente
      { id: "s2", decidedGameId: "g2" }, // déjà voté → exclue
      { id: "s3", decidedGameId: "g3" }, // pas participant → exclue
    ]);
    prisma.superlativeVote.findMany.mockResolvedValue([{ sessionId: "s2" }]);
    prisma.proposal.findFirst.mockImplementation(
      async ({ where }: { where: { sessionId: string } }) => ({
        votes: where.sessionId === "s3" ? [{ user: { id: "autre" } }] : [{ user: { id: "u1" } }],
      })
    );

    expect(await getPendingSuperlativeVoteSessionIds("u1", ["s1", "s2", "s3"])).toEqual(
      new Set(["s1"])
    );
  });
});

describe("forceFinalizeSuperlativeVoting — sorties anticipées", () => {
  it.each([
    ["session introuvable", null],
    ["session pas DONE", { status: "OPEN", superlativeVotingClosed: false }],
    ["vote déjà clos", { status: "DONE", superlativeVotingClosed: true }],
  ])("%s : ne finalise rien", async (_label, session) => {
    prisma.session.findUnique.mockResolvedValue(session);
    await forceFinalizeSuperlativeVoting("s1");
    expect(prisma.session.findUnique).toHaveBeenCalledTimes(1);
  });
});
