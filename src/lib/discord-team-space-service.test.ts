import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findTeam: vi.fn() }));

vi.mock("@/lib/prisma", () => ({ prisma: { communityTeam: { findFirst: mocks.findTeam } } }));

import {
  archiveInactiveTeamSpace,
  createMemorySpaceLinkStore,
  provisionTeamSpace,
  reactivateTeamSpace,
  syncTeamSpaceMember,
  type SpaceLinkStore,
  type TeamSpaceDiscordApi,
} from "./discord-team-space-service";
import { spaceChannelName } from "./discord-team-spaces";

const GUILD = "100000000000000001";
const TEAM = "team_1";

const team = (over: Partial<{ members: Array<{ userId: string; discordId: string }>; guildId: string | null }> = {}) => ({
  id: TEAM,
  name: "Les Dragons",
  communityId: "community-1",
  createdById: "user-1",
  community: { discordGuildId: over.guildId === undefined ? GUILD : over.guildId },
  members: (over.members ?? [
    { userId: "user-1", discordId: "100000000000000011" },
    { userId: "user-2", discordId: "100000000000000012" },
  ]).map((member) => ({ userId: member.userId, user: { discordId: member.discordId, memberships: [{ id: "m" }] } })),
});

function fakeApi() {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const api: TeamSpaceDiscordApi = {
    snapshot: async (guildId) => {
      calls.push({ op: "snapshot", args: [guildId] });
      return {
        channels: [
          { id: "chan-historical", name: "les-dragons", type: 0 },
          { id: "chan-other", name: spaceChannelName({ id: "team_2", name: "Les Dragons" }), type: 0 },
        ],
        roles: [],
      };
    },
    createRole: async (guildId, name) => {
      calls.push({ op: "createRole", args: [guildId, name] });
      return "role-new";
    },
    createChannel: async (guildId, name, overwrites) => {
      calls.push({ op: "createChannel", args: [guildId, name, overwrites] });
      return "chan-new";
    },
    renameChannel: async (channelId, name) => {
      calls.push({ op: "renameChannel", args: [channelId, name] });
    },
    addMemberRole: async (guildId, userId, roleId) => {
      calls.push({ op: "addMemberRole", args: [guildId, userId, roleId] });
    },
    removeMemberRole: async (guildId, userId, roleId) => {
      calls.push({ op: "removeMemberRole", args: [guildId, userId, roleId] });
    },
  };
  return { api, calls, ops: (name: string) => calls.filter((call) => call.op === name) };
}

const enabled = { DISCORD_TEAM_SPACES_ENABLED: "true" } as unknown as NodeJS.ProcessEnv;

beforeEach(() => {
  mocks.findTeam.mockResolvedValue(team());
});

afterEach(() => {
  vi.unstubAllEnvs();
  mocks.findTeam.mockReset();
});

describe("provisionTeamSpace", () => {
  it("ne touche à rien quand le flag est fermé", async () => {
    const { api, calls } = fakeApi();
    const result = await provisionTeamSpace({ teamId: TEAM, communityId: "community-1", api, env: {} as NodeJS.ProcessEnv });
    expect(result).toEqual({ status: "disabled" });
    expect(calls).toEqual([]);
  });

  it("crée rôle + salon privé, associe les membres et persiste le lien", async () => {
    const store = createMemorySpaceLinkStore();
    const { api, calls, ops } = fakeApi();
    const result = await provisionTeamSpace({ teamId: TEAM, communityId: "community-1", api, store, env: enabled });
    expect(result.status).toBe("created");
    expect(result.roleId).toBe("role-new");
    expect(result.channelId).toBe("chan-new");
    expect(ops("createRole")[0].args).toEqual([GUILD, "GN · Les Dragons"]);
    expect(ops("createChannel")[0].args[1]).toBe(spaceChannelName({ id: TEAM, name: "Les Dragons" }));
    expect(ops("addMemberRole")).toHaveLength(2);
    expect(await store.find(TEAM)).toMatchObject({ channelId: "chan-new", roleId: "role-new", archived: false });
    // Le salon historique et celui d'une autre équipe ne sont jamais touchés.
    expect(calls.some((call) => call.args.includes("chan-historical"))).toBe(false);
    expect(calls.some((call) => call.args.includes("chan-other"))).toBe(false);
  });

  it("rejoue sans créer une deuxième fois (idempotence)", async () => {
    const store = createMemorySpaceLinkStore([{ teamId: TEAM, communityId: "community-1", guildId: GUILD, channelId: "chan-1", roleId: "role-1" }]);
    const { api, calls } = fakeApi();
    const result = await provisionTeamSpace({ teamId: TEAM, communityId: "community-1", api, store, env: enabled });
    expect(result).toEqual({ status: "reused", roleId: "role-1", channelId: "chan-1" });
    expect(calls.some((call) => call.op === "createRole" || call.op === "createChannel")).toBe(false);
  });

  it("refuse au-delà du quota d’espaces de la communauté", async () => {
    const store = createMemorySpaceLinkStore(
      [1, 2, 3, 4, 5].map((n) => ({ teamId: `t${n}`, communityId: "community-1", guildId: GUILD, channelId: `c${n}`, roleId: `r${n}` }))
    );
    const { api, calls } = fakeApi();
    expect((await provisionTeamSpace({ teamId: TEAM, communityId: "community-1", api, store, env: enabled })).status).toBe("quota");
    expect(calls.some((call) => call.op === "createChannel")).toBe(false);
  });

  it("signale une communauté non reliée à Discord et une migration absente", async () => {
    const { api } = fakeApi();
    mocks.findTeam.mockResolvedValue(team({ guildId: null }));
    expect((await provisionTeamSpace({ teamId: TEAM, communityId: "community-1", api, env: enabled })).status).toBe("community_not_linked");

    mocks.findTeam.mockResolvedValue(team());
    const failing: SpaceLinkStore = {
      find: async () => {
        throw new Error("P2021");
      },
      listByCommunity: async () => [],
      save: async () => {},
      setArchived: async () => {},
    };
    const { SpaceStoreUnavailableError } = await import("./discord-team-space-service");
    const store: SpaceLinkStore = { ...failing, find: async () => { throw new SpaceStoreUnavailableError(); } };
    expect((await provisionTeamSpace({ teamId: TEAM, communityId: "community-1", api, store, env: enabled })).status).toBe("migration_required");
  });
});

describe("membres", () => {
  const linked = () =>
    createMemorySpaceLinkStore([{ teamId: TEAM, communityId: "community-1", guildId: GUILD, channelId: "chan-1", roleId: "role-1" }]);

  it("ajoute le rôle au membre qui rejoint, sans toucher aux autres équipes", async () => {
    const { api, ops } = fakeApi();
    const result = await syncTeamSpaceMember({
      teamId: TEAM,
      communityId: "community-1",
      discordId: "100000000000000012",
      action: "join",
      api,
      store: linked(),
      env: enabled,
    });
    expect(result.status).toBe("updated");
    expect(ops("addMemberRole")).toEqual([{ op: "addMemberRole", args: [GUILD, "100000000000000012", "role-1"] }]);
  });

  it("refuse un non-membre, un espace non provisionné et un membership Discord fermé", async () => {
    const { api } = fakeApi();
    expect(
      (
        await syncTeamSpaceMember({
          teamId: TEAM,
          communityId: "community-1",
          discordId: "100000000000000099",
          action: "join",
          api,
          store: linked(),
          env: enabled,
        })
      ).status
    ).toBe("not_member");

    expect(
      (
        await syncTeamSpaceMember({
          teamId: TEAM,
          communityId: "community-1",
          discordId: "100000000000000012",
          action: "join",
          api,
          store: createMemorySpaceLinkStore(),
          env: enabled,
        })
      ).status
    ).toBe("not_provisioned");

    mocks.findTeam.mockResolvedValue({ ...team(), members: [] });
    expect(
      (
        await syncTeamSpaceMember({
          teamId: TEAM,
          communityId: "community-1",
          discordId: "100000000000000012",
          action: "join",
          api,
          store: linked(),
          env: enabled,
        })
      ).status
    ).toBe("not_member");
    expect((await syncTeamSpaceMember({ teamId: TEAM, communityId: "community-1", discordId: "x", action: "leave", api, store: linked(), env: {} as NodeJS.ProcessEnv })).status).toBe("disabled");
  });

  it("retire seulement le rôle au départ, sans suppression ni XP", async () => {
    const { api, calls } = fakeApi();
    const result = await syncTeamSpaceMember({
      teamId: TEAM,
      communityId: "community-1",
      discordId: "100000000000000012",
      action: "leave",
      api,
      store: linked(),
      env: enabled,
    });
    expect(result.status).toBe("removed");
    expect(calls.map((call) => call.op)).toEqual(["removeMemberRole"]);
  });
});

describe("archivage contrôlé", () => {
  const linked = () =>
    createMemorySpaceLinkStore([{ teamId: TEAM, communityId: "community-1", guildId: GUILD, channelId: "chan-1", roleId: "role-1" }]);

  it("n’archive pas une équipe encore active", async () => {
    const { api, calls } = fakeApi();
    expect((await archiveInactiveTeamSpace({ teamId: TEAM, communityId: "community-1", api, store: linked(), env: enabled })).status).toBe(
      "still_active"
    );
    expect(calls).toEqual([]);
  });

  it("archive par renommage du seul salon lié, puis le réactive", async () => {
    mocks.findTeam.mockResolvedValue(team({ members: [] }));
    const store = linked();
    const { api, ops } = fakeApi();
    // Le salon lié doit exister dans le serveur pour être archivé.
    api.snapshot = async () => ({ channels: [{ id: "chan-1", name: "les-dragons-team_1", type: 0 }], roles: [] });
    expect((await archiveInactiveTeamSpace({ teamId: TEAM, communityId: "community-1", api, store, env: enabled })).status).toBe("reused");
    expect(ops("renameChannel")).toEqual([{ op: "renameChannel", args: ["chan-1", expect.stringContaining("archive-")] }]);
    expect(await store.find(TEAM)).toMatchObject({ archived: true });

    mocks.findTeam.mockResolvedValue(team());
    expect((await reactivateTeamSpace({ teamId: TEAM, communityId: "community-1", api, store, env: enabled })).status).toBe("reused");
    expect(ops("renameChannel").at(-1)?.args[0]).toBe("chan-1");
    expect(await store.find(TEAM)).toMatchObject({ archived: false });
  });

  it("refuse l’archivage d’un salon non associé (aucune ressource historique touchée)", async () => {
    mocks.findTeam.mockResolvedValue(team({ members: [] }));
    const { api, calls } = fakeApi();
    const result = await archiveInactiveTeamSpace({
      teamId: TEAM,
      communityId: "community-1",
      api,
      store: createMemorySpaceLinkStore(),
      env: enabled,
    });
    expect(result.status).toBe("unmanaged");
    expect(calls).toEqual([]);
  });
});
