import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sessionFindUnique: vi.fn(),
  userFindMany: vi.fn(),
  sessionInviteFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: mocks.sessionFindUnique },
    user: { findMany: mocks.userFindMany },
    sessionInvite: { findMany: mocks.sessionInviteFindMany },
  },
}));
vi.mock("@/lib/community-isolation", () => ({
  communityIdFilter: vi.fn(),
  communityMemberUserWhere: vi.fn(async (communityId: string | null) => ({
    memberships: { some: { communityId, status: "ACTIVE", community: { status: "ACTIVE" } } },
  })),
  getIsolationScope: vi.fn(),
}));

import { filterByActiveSessionInvite } from "./session-access";

describe("filterByActiveSessionInvite", () => {
  beforeEach(() => {
    mocks.sessionFindUnique.mockReset().mockResolvedValue({ communityId: "community-b" });
    mocks.userFindMany.mockReset().mockResolvedValue([{ id: "creator" }, { id: "active" }, { id: "outside-candidates" }]);
    mocks.sessionInviteFindMany.mockReset();
  });

  it("relit membership et invitation ACTIVE dans une requête et ne retourne que les candidats", async () => {
    const candidates = [{ id: "creator" }, { id: "active" }, { id: "revoked" }];

    await expect(filterByActiveSessionInvite("session-1", "creator", candidates)).resolves.toEqual([
      { id: "creator" },
      { id: "active" },
    ]);

    expect(mocks.userFindMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["creator", "active", "revoked"] },
        AND: [
          { memberships: { some: { communityId: "community-b", status: "ACTIVE", community: { status: "ACTIVE" } } } },
          { OR: [{ id: "creator" }, { sessionInvitesReceived: { some: { sessionId: "session-1", status: "ACTIVE" } } }] },
        ],
      },
      select: { id: true },
    });
    expect(mocks.sessionInviteFindMany).not.toHaveBeenCalled();
    expect(mocks.sessionFindUnique).toHaveBeenCalledOnce();
  });

  it("refuse les invités sans invitation active et ne garde pas un créateur sans adhésion active", async () => {
    mocks.userFindMany.mockResolvedValue([{ id: "active-invited-member" }]);

    await expect(filterByActiveSessionInvite("session-1", "creator", [
      { id: "creator" },
      { id: "never-invited" },
      { id: "revoked-invite" },
      { id: "active-invited-member" },
    ])).resolves.toEqual([{ id: "active-invited-member" }]);

    expect(mocks.userFindMany.mock.calls[0][0].where.AND[1]).toEqual({
      OR: [{ id: "creator" }, { sessionInvitesReceived: { some: { sessionId: "session-1", status: "ACTIVE" } } }],
    });
  });

  it("ne fait aucune lecture lorsque la soirée est absente ou que la liste de candidats est vide", async () => {
    mocks.sessionFindUnique.mockResolvedValueOnce(null);
    await expect(filterByActiveSessionInvite("missing", "creator", [{ id: "guest" }])).resolves.toEqual([]);
    await expect(filterByActiveSessionInvite("session-1", "creator", [])).resolves.toEqual([]);
    expect(mocks.userFindMany).not.toHaveBeenCalled();
  });
});
