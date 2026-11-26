import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  queueEnabled: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/community-scoped-client", () => ({
  scopedPrisma: () => ({
    communityTeam: { findFirst: mocks.findFirst },
    communityTeamMember: { findMany: mocks.findMany },
  }),
}));
vi.mock("@/lib/discord-team-space-queue", () => ({
  enqueueTeamSpaceSync: mocks.enqueue,
  teamSpaceQueueEnabled: mocks.queueEnabled,
}));

import {
  listTeamMemberDiscordIds,
  requestTeamSpaceAfterDissolution,
  requestTeamSpaceMemberSync,
  requestTeamSpaceProvision,
  requestTeamSpaceProvisionForCreator,
} from "./discord-team-space-hooks";

const DISCORD_A = "100000000000000021";
const DISCORD_B = "100000000000000022";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queueEnabled.mockReturnValue(true);
  mocks.enqueue.mockResolvedValue("queued");
  mocks.findFirst.mockResolvedValue({ id: "team-1" });
  mocks.findMany.mockResolvedValue([{ user: { discordId: DISCORD_A } }, { user: { discordId: null } }]);
});

describe("accroches d'espace d'équipe — aucun appel Discord, uniquement la file", () => {
  it("ne lit rien et n'enfile rien quand les verrous sont fermés", async () => {
    mocks.queueEnabled.mockReturnValue(false);
    await requestTeamSpaceProvision({ communityId: "c1", teamId: "team-1" });
    await requestTeamSpaceProvisionForCreator({ communityId: "c1", userId: "user-1" });
    await requestTeamSpaceMemberSync({ communityId: "c1", teamId: "team-1", discordId: DISCORD_A });
    await requestTeamSpaceAfterDissolution({ communityId: "c1", teamId: "team-1", formerMemberDiscordIds: [DISCORD_A] });
    expect(await listTeamMemberDiscordIds("c1", "team-1")).toEqual([]);
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("provisionne une équipe créée, par identifiant ou par créateur (équipe la plus récente)", async () => {
    await requestTeamSpaceProvision({ communityId: "c1", teamId: "team-1" });
    expect(mocks.enqueue).toHaveBeenCalledWith({ intent: "provision", communityId: "c1", teamId: "team-1" });

    mocks.enqueue.mockClear();
    await requestTeamSpaceProvisionForCreator({ communityId: "c1", userId: "user-1" });
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { communityId: "c1", createdById: "user-1" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    expect(mocks.enqueue).toHaveBeenCalledWith({ intent: "provision", communityId: "c1", teamId: "team-1" });

    mocks.enqueue.mockClear();
    mocks.findFirst.mockResolvedValue(null);
    await requestTeamSpaceProvisionForCreator({ communityId: "c1", userId: "user-1" });
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("n'enfile pas de provision si la recherche de l'équipe échoue", async () => {
    mocks.findFirst.mockRejectedValue(new Error("db_down"));
    await expect(requestTeamSpaceProvisionForCreator({ communityId: "c1", userId: "user-1" })).resolves.toBeUndefined();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("synchronise l'adhésion et le départ d'un seul membre, jamais sans identifiant Discord", async () => {
    await requestTeamSpaceMemberSync({ communityId: "c1", teamId: "team-1", discordId: null });
    expect(mocks.enqueue).not.toHaveBeenCalled();

    await requestTeamSpaceMemberSync({ communityId: "c1", teamId: "team-1", discordId: DISCORD_A });
    expect(mocks.enqueue).toHaveBeenCalledWith({ intent: "member", communityId: "c1", teamId: "team-1", discordId: DISCORD_A });
  });

  it("après dissolution : enfile la suppression réelle avec l'acteur, sans toucher aux autres équipes", async () => {
    await requestTeamSpaceAfterDissolution({
      communityId: "c1",
      teamId: "team-1",
      actorUserId: "user-1",
      formerMemberDiscordIds: [DISCORD_A, DISCORD_B],
    });
    expect(mocks.enqueue.mock.calls.map((call) => call[0])).toEqual([
      { intent: "delete", communityId: "c1", teamId: "team-1", actorUserId: "user-1" },
    ]);
  });

  it("lit les identifiants Discord des membres avant dissolution, en ignorant les comptes non liés", async () => {
    expect(await listTeamMemberDiscordIds("c1", "team-1")).toEqual([DISCORD_A]);
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { teamId: "team-1", communityId: "c1" },
      select: { user: { select: { discordId: true } } },
      take: 50,
    });

    mocks.findMany.mockRejectedValue(new Error("db_down"));
    expect(await listTeamMemberDiscordIds("c1", "team-1")).toEqual([]);
  });
});
