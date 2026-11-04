import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  community: vi.fn(),
  teams: vi.fn(),
  daily: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { $transaction: mocks.transaction },
}));
vi.mock("@/lib/community-scoped-client", () => ({
  scopedTransactionPrisma: vi.fn(() => ({ communityTeam: { findMany: mocks.teams } })),
}));
vi.mock("@/lib/tower-challenges", () => ({
  getTeamDailyTowerChallenge: mocks.daily,
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: mocks.error },
}));

import { assignDailyTowerTeamChallenges } from "./tower-team-daily";

describe("attribution quotidienne des défis équipe", () => {
  beforeEach(() => {
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    vi.stubEnv("TOWER_DISCORD_GUILD_ID", "553922938101825536");
    mocks.community.mockReset().mockResolvedValue({ id: "tower-community" });
    mocks.teams.mockReset().mockResolvedValue([
      { id: "team-a", communityId: "tower-community", members: [{ userId: "user-a" }] },
      { id: "team-b", communityId: "tower-community", members: [{ userId: "user-b" }] },
    ]);
    mocks.daily.mockReset().mockResolvedValue({ status: "TEAM_CHALLENGE" });
    mocks.error.mockReset();
    mocks.transaction.mockReset().mockImplementation(async (work) => work({ community: { findFirst: mocks.community } }));
  });
  afterEach(() => vi.unstubAllEnvs());

  it("ne fait rien si les défis Tower sont désactivés", async () => {
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "false");
    expect(await assignDailyTowerTeamChallenges(new Date(Date.now() + 5_000))).toEqual({ checked: 0, failed: 0 });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("ne contacte pas la base si le serveur Discord est invalide", async () => {
    vi.stubEnv("TOWER_DISCORD_GUILD_ID", "serveur-invalide");
    expect(await assignDailyTowerTeamChallenges(new Date(Date.now() + 5_000))).toEqual({ checked: 0, failed: 0 });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.daily).not.toHaveBeenCalled();
  });

  it("ne commence aucun travail quand le budget est déjà expiré", async () => {
    expect(await assignDailyTowerTeamChallenges(new Date(0))).toEqual({ checked: 0, failed: 0 });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.daily).not.toHaveBeenCalled();
  });

  it("n'attribue rien sans communauté active éligible", async () => {
    mocks.community.mockResolvedValue(null);
    expect(await assignDailyTowerTeamChallenges(new Date(Date.now() + 5_000))).toEqual({ checked: 0, failed: 0 });
    expect(mocks.teams).not.toHaveBeenCalled();
    expect(mocks.daily).not.toHaveBeenCalled();
  });

  it("arrête les attributions suivantes quand le budget expire pendant une équipe", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      mocks.daily.mockImplementationOnce(async () => {
        clock.mockReturnValue(6_000);
        return { status: "TEAM_CHALLENGE" };
      });
      expect(await assignDailyTowerTeamChallenges(new Date(6_000))).toEqual({ checked: 1, failed: 0 });
      expect(mocks.daily).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore();
    }
  });

  it("vérifie chaque équipe active avec un acteur membre", async () => {
    expect(await assignDailyTowerTeamChallenges(new Date(Date.now() + 5_000))).toEqual({ checked: 2, failed: 0 });
    expect(mocks.daily).toHaveBeenNthCalledWith(1, {
      communityId: "tower-community", userId: "user-a", teamId: "team-a",
    });
    expect(mocks.daily).toHaveBeenNthCalledWith(2, {
      communityId: "tower-community", userId: "user-b", teamId: "team-b",
    });
  });

  it("isole l'échec d'une équipe et poursuit les autres", async () => {
    mocks.daily.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ status: "TEAM_CHALLENGE" });
    expect(await assignDailyTowerTeamChallenges(new Date(Date.now() + 5_000))).toEqual({ checked: 1, failed: 1 });
    expect(mocks.error).toHaveBeenCalledOnce();
  });
});
