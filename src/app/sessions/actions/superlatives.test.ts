import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  user: vi.fn(),
  rate: vi.fn(),
  access: vi.fn(),
  session: vi.fn(),
  scopedDb: vi.fn(),
  participants: vi.fn(),
  voteCount: vi.fn(),
  categories: vi.fn(),
  createVotes: vi.fn(),
  finalize: vi.fn(),
  revalidate: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: m.rate }));
vi.mock("@/lib/session-access", () => ({ canAccessSession: m.access }));
vi.mock("@/lib/community-scoped-client", () => ({ getScopedPrisma: m.scopedDb }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    superlativeVote: { count: m.voteCount, createMany: m.createVotes },
    superlativeCategory: { findMany: m.categories },
  },
}));
vi.mock("@/lib/superlative-voting", () => ({
  finalizeSuperlativeVotingIfDue: m.finalize,
  forceFinalizeSuperlativeVoting: vi.fn(),
  getWinningProposalParticipants: m.participants,
}));

import { submitSuperlativeVotesAction } from "./superlatives";

const categories = ["mvp", "fun", "clutch"];

function form(votes: Record<string, string>) {
  const data = new FormData();
  data.set("sessionId", "s1");
  for (const [category, userId] of Object.entries(votes)) data.set(`vote-${category}`, userId);
  return data;
}

beforeEach(() => {
  vi.resetAllMocks();
  m.user.mockResolvedValue({ id: "alice" });
  m.rate.mockReturnValue(true);
  m.access.mockResolvedValue(true);
  m.scopedDb.mockResolvedValue({ session: { findUnique: m.session } });
  m.session.mockResolvedValue({ status: "DONE", decidedGameId: "game", superlativeVotingClosed: false });
  m.participants.mockResolvedValue([{ id: "alice" }, { id: "bob" }, { id: "cara" }]);
  m.voteCount.mockResolvedValue(0);
  m.categories.mockResolvedValue(categories.map((id) => ({ id })));
  m.createVotes.mockResolvedValue({ count: categories.length });
  m.finalize.mockResolvedValue(undefined);
  m.redirect.mockImplementation((path: string) => { throw new Error(`REDIRECT:${path}`); });
});

describe("submitSuperlativeVotesAction", () => {
  it("enregistre en une opération un vote valide pour chaque catégorie active", async () => {
    await expect(submitSuperlativeVotesAction(form({ mvp: "bob", fun: "cara", clutch: "bob" })))
      .rejects.toThrow("REDIRECT:/sessions/s1/vote-superlatifs");

    expect(m.createVotes).toHaveBeenCalledWith({ data: categories.map((categoryId) => ({
      sessionId: "s1", categoryId, voterUserId: "alice", votedForUserId: categoryId === "fun" ? "cara" : "bob",
    })) });
    expect(m.finalize).toHaveBeenCalledWith("s1");
    expect(m.revalidate).toHaveBeenCalledWith("/sessions/s1/vote-superlatifs");
  });

  it.each([
    { reason: "vote manquant", votes: { mvp: "bob", fun: "cara" } },
    { reason: "auto-vote", votes: { mvp: "bob", fun: "alice", clutch: "bob" } },
    { reason: "personne hors de la soirée", votes: { mvp: "bob", fun: "cara", clutch: "stranger" } },
  ])("rejette tout le formulaire si une catégorie contient un $reason", async ({ votes }) => {
    await submitSuperlativeVotesAction(form(votes));

    expect(m.createVotes).not.toHaveBeenCalled();
    expect(m.finalize).not.toHaveBeenCalled();
    expect(m.revalidate).not.toHaveBeenCalled();
  });

  it("refuse un deuxième envoi sans créer de vote partiel", async () => {
    m.voteCount.mockResolvedValue(1);

    await submitSuperlativeVotesAction(form({ mvp: "bob", fun: "cara", clutch: "bob" }));

    expect(m.createVotes).not.toHaveBeenCalled();
  });
});
