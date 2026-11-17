import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  teamFindFirst: vi.fn(),
  membersFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    communityTeam: { findFirst: mocks.teamFindFirst },
    communityTeamMember: { findMany: mocks.membersFindMany },
    // Aucun modèle XP/étages n'existe dans ce faux client : si un parcours
    // touchait la progression, le test échouerait au lieu de passer inaperçu.
  },
}));

import { transferTeamCaptain, getTeamCaptain } from "./community-team-captain-service";
import { createMemoryCaptainStore } from "./community-team-captain-store";
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
  mocks.membersFindMany.mockResolvedValue([
    { userId: "captain", user: { discordName: "Maxime", memberships: [{ id: "m" }] } },
    { userId: "member", user: { discordName: "Sarah", memberships: [{ id: "m" }] } },
  ]);
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

  it("D — le capitaine transfère à un membre actif, le créateur reste historique", async () => {
    mocks.membersFindMany.mockResolvedValue([
      { userId: "captain", user: { discordName: "Maxime", memberships: [{ id: "m" }] } },
      { userId: "member", user: { discordName: "Sarah", memberships: [{ id: "m" }] } },
    ]);
    const store = createMemoryCaptainStore([{ teamId: TEAM, createdById: "captain" }]);
    const args = { teamId: TEAM, communityId: "community-1" };
    expect(await transferTeamCaptain({ ...args, actorId: "captain", newCaptainUserId: "member" }, store)).toBe("transferred");
    // `createdById` reste le créateur ; seul `captainId` change.
    expect(store.rows.get(TEAM)).toEqual({ teamId: TEAM, createdById: "captain", captainId: "member" });
    expect(await getTeamCaptain(args, store)).toEqual({
      status: "found",
      captainId: "member",
      captainName: "Sarah",
      source: "captainId",
    });
    // L'ancien capitaine n'a plus le droit de gérer.
    expect(await transferTeamCaptain({ ...args, actorId: "captain", newCaptainUserId: "member" }, store)).toBe("not_captain");
  });

  it("D bis — sans source officielle migrée, la passation est refusée sans écriture" , async () => {
    const store = createMemoryCaptainStore([{ teamId: TEAM, createdById: "captain" }], { supported: false });
    expect(
      await transferTeamCaptain(
        { teamId: TEAM, communityId: "community-1", actorId: "captain", newCaptainUserId: "member" },
        store
      )
    ).toBe("captain_source_unavailable");
    expect(store.rows.get(TEAM)).toEqual({ teamId: TEAM, createdById: "captain", captainId: null });
  });

  it("D ter — un capitaine sorti de l'équipe ne désigne personne", async () => {
    mocks.membersFindMany.mockResolvedValue([
      { userId: "parti", user: { discordName: "Parti", memberships: [] } },
      { userId: "member", user: { discordName: "Sarah", memberships: [{ id: "m" }] } },
    ]);
    const store = createMemoryCaptainStore([{ teamId: TEAM, createdById: "parti" }]);
    expect(await getTeamCaptain({ teamId: TEAM, communityId: "community-1" }, store)).toEqual({
      status: "none",
      reason: "no_captain",
    });
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
