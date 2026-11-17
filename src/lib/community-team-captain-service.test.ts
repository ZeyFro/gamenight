import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ teamFindFirst: vi.fn(), membersFindMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    communityTeam: { findFirst: mocks.teamFindFirst },
    communityTeamMember: { findMany: mocks.membersFindMany },
  },
}));

import { canManageTeam, getTeamCaptain, transferTeamCaptain } from "./community-team-captain-service";
import { createMemoryCaptainStore } from "./community-team-captain-store";

const activeMember = (userId: string, name = userId) => ({
  userId,
  user: { discordName: name, memberships: [{ id: "m" }] },
});
const inactiveMember = (userId: string) => ({ userId, user: { discordName: userId, memberships: [] } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.teamFindFirst.mockResolvedValue({ id: "t1" });
  mocks.membersFindMany.mockResolvedValue([activeMember("creator", "Maxime"), activeMember("member", "Sarah")]);
});

describe("capitaine effectif", () => {
  it("utilise le créateur historique tant que captainId est absent", async () => {
    const store = createMemoryCaptainStore([{ teamId: "t1", createdById: "creator" }]);
    expect(await getTeamCaptain({ teamId: "t1", communityId: "c1" }, store)).toEqual({
      status: "found",
      captainId: "creator",
      captainName: "Maxime",
      source: "createdById",
    });
    expect(await canManageTeam({ teamId: "t1", communityId: "c1", userId: "member" }, store)).toBe(false);
  });

  it("suit captainId quand il désigne un membre actif", async () => {
    const store = createMemoryCaptainStore([{ teamId: "t1", createdById: "creator", captainId: "member" }]);
    expect(await getTeamCaptain({ teamId: "t1", communityId: "c1" }, store)).toMatchObject({
      status: "found",
      captainId: "member",
      source: "captainId",
    });
    expect(await canManageTeam({ teamId: "t1", communityId: "c1", userId: "member" }, store)).toBe(true);
    expect(await canManageTeam({ teamId: "t1", communityId: "c1", userId: "creator" }, store)).toBe(false);
  });

  it("ne retombe pas silencieusement sur le créateur si le capitaine est sorti", async () => {
    mocks.membersFindMany.mockResolvedValue([activeMember("creator"), inactiveMember("parti")]);
    const store = createMemoryCaptainStore([{ teamId: "t1", createdById: "creator", captainId: "parti" }]);
    expect(await getTeamCaptain({ teamId: "t1", communityId: "c1" }, store)).toEqual({
      status: "none",
      reason: "captain_not_member",
    });
  });

  it("ne désigne jamais le premier membre quand le créateur n'est plus actif", async () => {
    mocks.membersFindMany.mockResolvedValue([activeMember("member", "Sarah")]);
    const store = createMemoryCaptainStore([{ teamId: "t1", createdById: "creator" }]);
    expect(await getTeamCaptain({ teamId: "t1", communityId: "c1" }, store)).toEqual({ status: "none", reason: "no_captain" });
  });

  it("refuse une équipe absente", async () => {
    mocks.teamFindFirst.mockResolvedValue(null);
    const store = createMemoryCaptainStore([{ teamId: "t1", createdById: "creator" }]);
    expect(await getTeamCaptain({ teamId: "t1", communityId: "c1" }, store)).toEqual({ status: "missing" });
    expect(await transferTeamCaptain({ teamId: "t1", communityId: "c1", actorId: "creator", newCaptainUserId: "member" }, store)).toBe(
      "missing"
    );
  });
});

describe("passation", () => {
  it("est refusée sans source officielle, sans écrire createdById", async () => {
    const store = createMemoryCaptainStore([{ teamId: "t1", createdById: "creator" }], { supported: false });
    const result = await transferTeamCaptain(
      { teamId: "t1", communityId: "c1", actorId: "creator", newCaptainUserId: "member" },
      store
    );
    expect(result).toBe("captain_source_unavailable");
    expect(store.rows.get("t1")).toEqual({ teamId: "t1", createdById: "creator", captainId: null });
  });

  it("écrit captainId uniquement et laisse le créateur historique intact", async () => {
    const store = createMemoryCaptainStore([{ teamId: "t1", createdById: "creator" }]);
    const result = await transferTeamCaptain(
      { teamId: "t1", communityId: "c1", actorId: "creator", newCaptainUserId: "member" },
      store
    );
    expect(result).toBe("transferred");
    expect(store.rows.get("t1")).toEqual({ teamId: "t1", createdById: "creator", captainId: "member" });
  });

  it("refuse un acteur non capitaine, un successeur non membre et une passation à soi-même", async () => {
    const store = createMemoryCaptainStore([{ teamId: "t1", createdById: "creator" }]);
    expect(
      await transferTeamCaptain({ teamId: "t1", communityId: "c1", actorId: "member", newCaptainUserId: "creator" }, store)
    ).toBe("not_captain");
    expect(
      await transferTeamCaptain({ teamId: "t1", communityId: "c1", actorId: "creator", newCaptainUserId: "inconnu" }, store)
    ).toBe("not_member");
    expect(
      await transferTeamCaptain({ teamId: "t1", communityId: "c1", actorId: "creator", newCaptainUserId: "creator" }, store)
    ).toBe("same");
  });

  it("est idempotente : une seconde passation concurrente échoue sans écraser", async () => {
    const store = createMemoryCaptainStore([{ teamId: "t1", createdById: "creator" }]);
    const first = await transferTeamCaptain(
      { teamId: "t1", communityId: "c1", actorId: "creator", newCaptainUserId: "member" },
      store
    );
    const second = await transferTeamCaptain(
      { teamId: "t1", communityId: "c1", actorId: "creator", newCaptainUserId: "creator" },
      store
    );
    expect(first).toBe("transferred");
    expect(second).toBe("not_captain");
    expect(store.rows.get("t1")).toMatchObject({ createdById: "creator", captainId: "member" });
  });
});
