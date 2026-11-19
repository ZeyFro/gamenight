import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  community: vi.fn(),
  membership: vi.fn(),
  team: vi.fn(),
  attempt: vi.fn(),
  candidates: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/community-scoped-client", () => ({
  scopedTransactionPrisma: vi.fn(() => ({
    communityTeam: { findFirst: mocks.team },
    towerChallengeAttempt: { findFirst: mocks.attempt, findMany: mocks.candidates, upsert: mocks.upsert },
    towerChallengeDefinition: { findMany: mocks.candidates },
  })),
}));

import { getTeamDailyTowerChallenge } from "./tower-challenges";

const input = { communityId: "tower-community", userId: "user-a", teamId: "team-a" };

describe("commande équipe : garde horaire Europe/Paris", () => {
  beforeEach(() => {
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    mocks.transaction.mockReset().mockImplementation(async (work: (tx: unknown) => unknown) => work({ $queryRaw: mocks.community }));
    // withTower lit la communauté puis l'adhésion.
    mocks.community
      .mockReset()
      .mockResolvedValueOnce([{ status: "ACTIVE", towerChallengesEnabled: true }])
      .mockResolvedValue([{ status: "ACTIVE" }]);
    mocks.team.mockReset().mockResolvedValue({ id: "team-a", name: "Les grimpeurs", members: [{ userId: "user-a" }] });
    mocks.attempt.mockReset().mockResolvedValue(null);
    mocks.candidates.mockReset().mockResolvedValue([]);
    mocks.upsert.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("ne crée aucun défi d'équipe à 17:59:59 à Paris, été comme hiver", async () => {
    for (const instant of ["2026-11-19T16:59:59.000Z", "2026-07-14T15:59:59.000Z"]) {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(instant));
      expect(await getTeamDailyTowerChallenge(input)).toEqual({ status: "NOT_YET" });
      expect(mocks.candidates).not.toHaveBeenCalled();
      expect(mocks.upsert).not.toHaveBeenCalled();
      vi.useRealTimers();
      mocks.community
        .mockReset()
        .mockResolvedValueOnce([{ status: "ACTIVE", towerChallengesEnabled: true }])
        .mockResolvedValue([{ status: "ACTIVE" }]);
    }
  });

  it("attribue à partir de 18:00:00 à Paris en hiver", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T17:00:00.000Z"));
    expect(await getTeamDailyTowerChallenge(input)).toEqual({ status: "NO_CHALLENGE" });
    expect(mocks.candidates).toHaveBeenCalledOnce();
  });
});
