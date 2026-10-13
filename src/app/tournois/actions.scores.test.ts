import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUser, checkRateLimit, declareWinner, findUnique, redirect, revalidatePath } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  checkRateLimit: vi.fn(),
  declareWinner: vi.fn(),
  findUnique: vi.fn(),
  redirect: vi.fn((location: string) => {
    throw new Error(`REDIRECT:${location}`);
  }),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/tournaments", () => ({
  declareWinner,
  cancelTournament: vi.fn(),
  deleteTournament: vi.fn(),
  generateBracket: vi.fn(),
  buildBracketInTransaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { tournamentMatch: { findUnique }, game: { findUnique: vi.fn() }, user: { findMany: vi.fn() } } }));
vi.mock("@/lib/badges", () => ({ checkTournamentBadges: vi.fn() }));
vi.mock("@/lib/discord", () => ({ postToDiscord: vi.fn(), ACCENT_COLOR: 0 }));
vi.mock("@/lib/app-url", () => ({ resolveAbsoluteUrl: vi.fn() }));
vi.mock("@/lib/discord-bot-config", () => ({ getTournamentAnnounceConfig: vi.fn(() => null) }));
vi.mock("@/lib/tournament-announce", () => ({
  enqueueTournamentCreationDeliveries: vi.fn(),
  enqueueTournamentThreadMember: vi.fn(),
  resyncTournamentThreadMembers: vi.fn(),
}));

import { declareWinnerAction } from "./actions";

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("declareWinnerAction (scores)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue({ id: "u1" });
    checkRateLimit.mockReturnValue(true);
    declareWinner.mockResolvedValue({ ok: true, tournamentDone: false });
    findUnique.mockResolvedValue({ tournamentId: "t1" });
  });
  afterEach(() => vi.unstubAllEnvs());

  const withScores = { matchId: "m1", winnerId: "u1", score1: "3", score2: "1" };

  it("flag éteint : les scores sont ignorés", async () => {
    await declareWinnerAction(form(withScores));
    expect(declareWinner).toHaveBeenCalledWith("m1", "u1", "u1", undefined);
  });

  it("flag éteint : des scores invalides n'empêchent pas la déclaration", async () => {
    await declareWinnerAction(form({ ...withScores, score2: "" }));
    expect(declareWinner).toHaveBeenCalledWith("m1", "u1", "u1", undefined);
  });

  it("flag allumé : les scores sont transmis", async () => {
    vi.stubEnv("TOURNAMENT_SCORES_ENABLED", "true");
    await declareWinnerAction(form(withScores));
    expect(declareWinner).toHaveBeenCalledWith("m1", "u1", "u1", { score1: 3, score2: 1 });
  });

  it("flag allumé, sans score : déclaration simple", async () => {
    vi.stubEnv("TOURNAMENT_SCORES_ENABLED", "true");
    await declareWinnerAction(form({ matchId: "m1", winnerId: "u1", score1: "", score2: "" }));
    expect(declareWinner).toHaveBeenCalledWith("m1", "u1", "u1", undefined);
  });

  it("flag allumé : un score seul est refusé sans appeler declareWinner", async () => {
    vi.stubEnv("TOURNAMENT_SCORES_ENABLED", "true");
    await expect(declareWinnerAction(form({ ...withScores, score2: "" }))).rejects.toThrow("REDIRECT:");
    expect(declareWinner).not.toHaveBeenCalled();
  });

  it("flag allumé : scores incohérents avec le gagnant -> redirection avec message", async () => {
    vi.stubEnv("TOURNAMENT_SCORES_ENABLED", "true");
    declareWinner.mockResolvedValue({ ok: false, tournamentDone: false, error: "x" });
    await expect(declareWinnerAction(form(withScores))).rejects.toThrow("REDIRECT:/tournois/t1?error=scores");
  });
});
