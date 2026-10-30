import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ membershipFindUnique: vi.fn(), resolveActiveCommunityId: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/community-isolation", () => ({ resolveActiveCommunityId: mocks.resolveActiveCommunityId }));
vi.mock("@/lib/community-scoped-client", () => ({ getScopedPrisma: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { membership: { findUnique: mocks.membershipFindUnique }, $transaction: mocks.transaction } }));

import { getCommunityTeamsCommunityId, joinCommunityTeam } from "./community-teams";

describe("community teams access", () => {
  beforeEach(() => vi.clearAllMocks());

  it("only resolves an active community with membership and its feature enabled", async () => {
    mocks.resolveActiveCommunityId.mockResolvedValue("community-1");
    mocks.membershipFindUnique.mockResolvedValue({ status: "ACTIVE", community: { status: "ACTIVE", communityTeamsEnabled: true } });
    await expect(getCommunityTeamsCommunityId("user-1")).resolves.toBe("community-1");

    mocks.membershipFindUnique.mockResolvedValue({ status: "ACTIVE", community: { status: "ACTIVE", communityTeamsEnabled: false } });
    await expect(getCommunityTeamsCommunityId("user-1")).resolves.toBeNull();
    mocks.membershipFindUnique.mockResolvedValue(null);
    await expect(getCommunityTeamsCommunityId("user-1")).resolves.toBeNull();
    mocks.resolveActiveCommunityId.mockResolvedValue(null);
    await expect(getCommunityTeamsCommunityId("user-1")).resolves.toBeNull();
  });

  it("joinCommunityTeam : P2002 à la relance après P2034 → already (pas de 500)", async () => {
    mocks.resolveActiveCommunityId.mockResolvedValue("community-1");
    mocks.membershipFindUnique.mockResolvedValue({ status: "ACTIVE", community: { status: "ACTIVE", communityTeamsEnabled: true } });
    const known = (code: string) => new Prisma.PrismaClientKnownRequestError("x", { code, clientVersion: "test" });
    mocks.transaction.mockRejectedValueOnce(known("P2034")).mockRejectedValueOnce(known("P2002"));
    await expect(joinCommunityTeam("user-1", "community-1", "team-1")).resolves.toBe("already");
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });

  it("joinCommunityTeam : deux P2034 → l’erreur remonte après une seule relance", async () => {
    mocks.resolveActiveCommunityId.mockResolvedValue("community-1");
    mocks.membershipFindUnique.mockResolvedValue({ status: "ACTIVE", community: { status: "ACTIVE", communityTeamsEnabled: true } });
    const known = (code: string) => new Prisma.PrismaClientKnownRequestError("x", { code, clientVersion: "test" });
    mocks.transaction.mockRejectedValue(known("P2034"));
    await expect(joinCommunityTeam("user-1", "community-1", "team-1")).rejects.toMatchObject({ code: "P2034" });
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });
});
