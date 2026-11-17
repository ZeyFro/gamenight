import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  teamFindFirst: vi.fn(),
  memberFindUnique: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    communityTeam: { findFirst: mocks.teamFindFirst, updateMany: mocks.updateMany },
    communityTeamMember: { findUnique: mocks.memberFindUnique },
  },
}));

import { canManageTeam, getTeamCaptain, transferTeamCaptain } from "./community-team-captain-service";

const active = { communityId: "community-1", user: { memberships: [{ id: "m" }] } };
const inactive = { communityId: "community-1", user: { memberships: [] } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.teamFindFirst.mockResolvedValue({ createdById: "captain", createdBy: { discordName: "Maxime" }, maxMembers: 6 });
  mocks.memberFindUnique.mockResolvedValue(active);
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe("capitainerie", () => {
  it("lit le capitaine officiel (créateur actif) et refuse un membre ordinaire", async () => {
    expect(await getTeamCaptain({ teamId: "t1", communityId: "community-1" })).toEqual({
      status: "found",
      captainId: "captain",
      captainName: "Maxime",
    });
    expect(await canManageTeam({ teamId: "t1", communityId: "community-1", userId: "captain" })).toBe(true);
    expect(await canManageTeam({ teamId: "t1", communityId: "community-1", userId: "member" })).toBe(false);
  });

  it("ne désigne personne quand le créateur n’est plus membre actif (jamais le premier membre)", async () => {
    mocks.memberFindUnique.mockResolvedValue(inactive);
    expect(await getTeamCaptain({ teamId: "t1", communityId: "community-1" })).toEqual({ status: "none" });
    expect(await transferTeamCaptain({ teamId: "t1", communityId: "community-1", actorId: "member", newCaptainUserId: "other" })).toBe(
      "unavailable"
    );
  });

  it("transfère au capitaine désigné, de façon idempotente", async () => {
    mocks.teamFindFirst.mockResolvedValueOnce({ createdById: "captain" }).mockResolvedValueOnce({ createdById: "captain" });
    expect(
      await transferTeamCaptain({ teamId: "t1", communityId: "community-1", actorId: "captain", newCaptainUserId: "captain" })
    ).toBe("same");

    const result = await transferTeamCaptain({
      teamId: "t1",
      communityId: "community-1",
      actorId: "captain",
      newCaptainUserId: "member",
    });
    expect(result).toBe("transferred");
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: "t1", communityId: "community-1", createdById: "captain" },
      data: { createdById: "member" },
    });

    // Rejeu : l'acteur n'est plus capitaine, aucune écriture supplémentaire.
    mocks.teamFindFirst.mockResolvedValue({ createdById: "member" });
    expect(
      await transferTeamCaptain({ teamId: "t1", communityId: "community-1", actorId: "captain", newCaptainUserId: "captain" })
    ).toBe("not_captain");
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
  });

  it("refuse un capitaine qui n’appartient pas à l’équipe", async () => {
    mocks.memberFindUnique.mockImplementation(async ({ where }: { where: { teamId_userId: { userId: string } } }) =>
      where.teamId_userId.userId === "captain" ? active : null
    );
    expect(
      await transferTeamCaptain({ teamId: "t1", communityId: "community-1", actorId: "captain", newCaptainUserId: "inconnu" })
    ).toBe("not_member");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("refuse une équipe absente ou un acteur non capitaine", async () => {
    mocks.teamFindFirst.mockResolvedValue(null);
    expect(await getTeamCaptain({ teamId: "t1", communityId: "community-1" })).toEqual({ status: "missing" });
    mocks.teamFindFirst.mockResolvedValue({ createdById: "captain", createdBy: { discordName: null }, maxMembers: 6 });
    expect(
      await transferTeamCaptain({ teamId: "t1", communityId: "community-1", actorId: "member", newCaptainUserId: "other" })
    ).toBe("not_captain");
  });
});
