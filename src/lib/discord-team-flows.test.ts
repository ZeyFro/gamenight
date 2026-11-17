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
    // Aucun modèle XP/étages n'existe dans ce faux client : si un parcours
    // touchait la progression, le test échouerait au lieu de passer inaperçu.
  },
}));

import { transferTeamCaptain, getTeamCaptain } from "./community-team-captain-service";
import {
  createMemorySpaceLinkStore,
  provisionTeamSpace,
  syncTeamSpaceMember,
  type TeamSpaceDiscordApi,
} from "./discord-team-space-service";

const GUILD = "100000000000000001";
const TEAM = "team_1";
const CAPTAIN_DISCORD = "100000000000000011";
const MEMBER_DISCORD = "100000000000000012";
const OUTSIDER_DISCORD = "100000000000000099";

const enabled = { DISCORD_TEAM_SPACES_ENABLED: "true" } as unknown as NodeJS.ProcessEnv;

const active = { communityId: "community-1", user: { memberships: [{ id: "m" }] } };

function teamRow(members = [CAPTAIN_DISCORD, MEMBER_DISCORD]) {
  return {
    id: TEAM,
    name: "Les Dragons",
    communityId: "community-1",
    createdById: "captain",
    community: { discordGuildId: GUILD },
    members: members.map((discordId, index) => ({
      userId: index === 0 ? "captain" : discordId === MEMBER_DISCORD ? "member" : "outsider",
      user: { discordId, memberships: [{ id: "m" }] },
    })),
  };
}

function fakeApi() {
  let roleSeq = 0;
  let channelSeq = 0;
  const created = { roles: 0, channels: 0 };
  const api: TeamSpaceDiscordApi = {
    snapshot: async () => ({
      channels: [],
      roles: [],
    }),
    createRole: async () => {
      created.roles += 1;
      roleSeq += 1;
      return `role-${roleSeq}`;
    },
    createChannel: async () => {
      created.channels += 1;
      channelSeq += 1;
      return `chan-${channelSeq}`;
    },
    renameChannel: async () => undefined,
    addMemberRole: async () => undefined,
    removeMemberRole: async () => undefined,
  };
  return { api, created };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.teamFindFirst.mockResolvedValue(teamRow());
  mocks.memberFindUnique.mockResolvedValue(active);
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe("recette des parcours d'équipe", () => {
  it("A — crée l'équipe puis un seul espace, même en rejouant", async () => {
    const { api, created } = fakeApi();
    const store = createMemorySpaceLinkStore();
    const first = await provisionTeamSpace({ teamId: TEAM, communityId: "community-1", api, store, env: enabled });
    expect(first.status).toBe("created");
    const replay = await provisionTeamSpace({ teamId: TEAM, communityId: "community-1", api, store, env: enabled });
    expect(replay.status).toBe("reused");
    expect(created).toEqual({ roles: 1, channels: 1 });
    expect(await store.find(TEAM)).toMatchObject({ channelId: "chan-1", roleId: "role-1" });
  });

  it("B — l'adhésion ajoute l'accès de cette seule équipe", async () => {
    const { api } = fakeApi();
    const add = vi.spyOn(api, "addMemberRole");
    const store = createMemorySpaceLinkStore([
      { teamId: TEAM, communityId: "community-1", guildId: GUILD, channelId: "chan-1", roleId: "role-1" },
      { teamId: "team_2", communityId: "community-1", guildId: GUILD, channelId: "chan-2", roleId: "role-2" },
    ]);
    const result = await syncTeamSpaceMember({
      teamId: TEAM,
      communityId: "community-1",
      discordId: MEMBER_DISCORD,
      action: "join",
      api,
      store,
      env: enabled,
    });
    expect(result.status).toBe("updated");
    expect(add).toHaveBeenCalledWith(GUILD, MEMBER_DISCORD, "role-1");
    expect(add).not.toHaveBeenCalledWith(GUILD, MEMBER_DISCORD, "role-2");
  });

  it("C — le départ retire l'accès sans écrire dans la progression", async () => {
    const { api } = fakeApi();
    const remove = vi.spyOn(api, "removeMemberRole");
    const store = createMemorySpaceLinkStore([
      { teamId: TEAM, communityId: "community-1", guildId: GUILD, channelId: "chan-1", roleId: "role-1" },
    ]);
    const result = await syncTeamSpaceMember({
      teamId: TEAM,
      communityId: "community-1",
      discordId: MEMBER_DISCORD,
      action: "leave",
      api,
      store,
      env: enabled,
    });
    expect(result.status).toBe("removed");
    expect(remove).toHaveBeenCalledWith(GUILD, MEMBER_DISCORD, "role-1");
  });

  it("D — le capitaine transfère à un membre actif, sans promotion arbitraire", async () => {
    mocks.teamFindFirst.mockResolvedValue({ createdById: "captain", createdBy: { discordName: "Maxime" }, maxMembers: 8 });
    mocks.memberFindUnique.mockImplementation(async ({ where }: { where: { teamId_userId: { userId: string } } }) =>
      where.teamId_userId.userId === "outsider" ? null : active
    );
    expect(await transferTeamCaptain({ teamId: TEAM, communityId: "community-1", actorId: "captain", newCaptainUserId: "outsider" })).toBe(
      "not_member"
    );
    expect(await transferTeamCaptain({ teamId: TEAM, communityId: "community-1", actorId: "member", newCaptainUserId: "captain" })).toBe(
      "not_captain"
    );
    expect(await transferTeamCaptain({ teamId: TEAM, communityId: "community-1", actorId: "captain", newCaptainUserId: "member" })).toBe(
      "transferred"
    );
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: TEAM, communityId: "community-1", createdById: "captain" },
      data: { createdById: "member" },
    });
    mocks.teamFindFirst.mockResolvedValue({ createdById: "member", createdBy: { discordName: "Sarah" } });
    expect(await getTeamCaptain({ teamId: TEAM, communityId: "community-1" })).toEqual({
      status: "found",
      captainId: "member",
      captainName: "Sarah",
    });
  });

  it("D bis — un capitaine sorti de l'équipe ne désigne personne", async () => {
    mocks.teamFindFirst.mockResolvedValue({ createdById: "parti", createdBy: { discordName: "Parti" } });
    mocks.memberFindUnique.mockResolvedValue({ communityId: "community-1", user: { memberships: [] } });
    expect(await getTeamCaptain({ teamId: TEAM, communityId: "community-1" })).toEqual({ status: "none" });
  });

  it("E — un joueur extérieur n'obtient aucun accès à l'espace privé", async () => {
    const { api } = fakeApi();
    const add = vi.spyOn(api, "addMemberRole");
    const store = createMemorySpaceLinkStore([
      { teamId: TEAM, communityId: "community-1", guildId: GUILD, channelId: "chan-1", roleId: "role-1" },
    ]);
    const result = await syncTeamSpaceMember({
      teamId: TEAM,
      communityId: "community-1",
      discordId: OUTSIDER_DISCORD,
      action: "join",
      api,
      store,
      env: enabled,
    });
    expect(result.status).toBe("not_member");
    expect(add).not.toHaveBeenCalled();
  });
});
