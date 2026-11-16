import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), community: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/lib/community-isolation", () => ({ resolveActiveCommunityId: mocks.community }));
vi.mock("@/lib/community-scoped-client", () => ({ scopedTransactionPrisma: vi.fn() }));

import { getTowerPersonalProgress, getTowerProgressForProfile } from "./tower-personal-progress";

describe("progression Tower pour une fiche de profil : coût nul tant que la Tour est éteinte", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, "", "false", "TRUE", "1"])("drapeau %o : aucune requête, pas même la communauté active", async value => {
    if (value === undefined) vi.stubEnv("TOWER_CHALLENGES_ENABLED", "");
    else vi.stubEnv("TOWER_CHALLENGES_ENABLED", value);
    expect(await getTowerProgressForProfile("viewer", "member")).toBeNull();
    expect(await getTowerPersonalProgress({ viewerId: "viewer", memberId: "member", communityId: "c" })).toEqual({ status: "DISABLED" });
    expect(mocks.community).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("sans communauté active, ne lit rien", async () => {
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    mocks.community.mockResolvedValue(null);
    expect(await getTowerProgressForProfile("viewer", "member")).toBeNull();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("ne renvoie une progression que pour le statut PROGRESS, dans la communauté active du lecteur", async () => {
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    mocks.community.mockResolvedValue("community");
    mocks.transaction.mockResolvedValueOnce({ status: "UNAVAILABLE" });
    expect(await getTowerProgressForProfile("viewer", "member")).toBeNull();
    const progress = { status: "PROGRESS", floorsClimbed: "30", completedSeasons: 0, rank: "Ranker", next: null };
    mocks.transaction.mockResolvedValueOnce(progress);
    expect(await getTowerProgressForProfile("viewer", "member")).toBe(progress);
    expect(mocks.community).toHaveBeenCalledWith("viewer");
  });

  it("refuse des identifiants invalides avant toute lecture", async () => {
    vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
    for (const input of [null, {}, { viewerId: "a", memberId: "", communityId: "c" }, { viewerId: "a", memberId: "b", communityId: "x".repeat(192) }]) {
      expect(await getTowerPersonalProgress(input)).toEqual({ status: "INVALID" });
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
