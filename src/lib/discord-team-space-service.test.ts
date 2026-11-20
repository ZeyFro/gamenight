import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findTeam: vi.fn(), findSpace: vi.fn(), listSpaces: vi.fn(), saveSpace: vi.fn(), updateSpaces: vi.fn(),
}));

vi.mock("@/lib/community-scoped-client", () => ({ scopedPrisma: () => ({
  communityTeam: { findFirst: mocks.findTeam },
  discordTeamSpace: {
    findUnique: mocks.findSpace, findMany: mocks.listSpaces, upsert: mocks.saveSpace, updateMany: mocks.updateSpaces,
  },
}) }));

import {
  archiveInactiveTeamSpace,
  createMemorySpaceLinkStore,
  provisionTeamSpace,
  reconcileTeamSpace,
  reactivateTeamSpace,
  syncTeamSpaceMember,
  type SpaceLinkStore,
  type TeamSpaceDiscordApi,
} from "./discord-team-space-service";
import { spaceChannelName, spaceVoiceChannelName, TEXT_CHANNEL_ALLOW, VIEW_CHANNEL, VOICE_CHANNEL_ALLOW } from "./discord-team-spaces";
import { runTeamSpaceAction } from "./discord-team-space-runner";

const GUILD = "100000000000000001";
const TEAM = "team_1";

const team = (over: Partial<{ members: Array<{ userId: string; discordId: string }>; guildId: string | null }> = {}) => ({
  id: TEAM,
  name: "Les Dragons",
  communityId: "community-1",
  createdById: "user-1",
  captainId: null,
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
    createChannel: async (guildId, name, type, overwrites) => {
      calls.push({ op: "createChannel", args: [guildId, name, type, overwrites] });
      return type === 2 ? "voice-new" : "chan-new";
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
  Object.values(mocks).forEach(mock => mock.mockReset());
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
    expect(result.voiceChannelId).toBe("voice-new");
    expect(ops("createRole")[0].args).toEqual([GUILD, "GN · Les Dragons"]);
    // Deux salons permanents, privés, avec les mêmes overwrites.
    expect(ops("createChannel").map((call) => call.args.slice(1, 3))).toEqual([
      [spaceChannelName({ id: TEAM, name: "Les Dragons" }), 0],
      [spaceVoiceChannelName({ id: TEAM, name: "Les Dragons" }), 2],
    ]);
    // Mêmes règles de confidentialité, permissions d'usage adaptées au type de salon.
    expect(ops("createChannel")[0].args[3]).toEqual([
      { target: "everyone", deny: VIEW_CHANNEL },
      { target: "team-role", allow: TEXT_CHANNEL_ALLOW },
    ]);
    expect(ops("createChannel")[1].args[3]).toEqual([
      { target: "everyone", deny: VIEW_CHANNEL },
      { target: "team-role", allow: VOICE_CHANNEL_ALLOW },
    ]);
    expect(ops("addMemberRole")).toHaveLength(2);
    expect(await store.find(TEAM)).toMatchObject({
      channelId: "chan-new",
      voiceChannelId: "voice-new",
      roleId: "role-new",
      archived: false,
    });
    // Le salon historique et celui d'une autre équipe ne sont jamais touchés.
    expect(calls.some((call) => call.args.includes("chan-historical"))).toBe(false);
    expect(calls.some((call) => call.args.includes("chan-other"))).toBe(false);
  });

  it("rejoue sans créer une deuxième fois (idempotence)", async () => {
    const store = createMemorySpaceLinkStore([
      { teamId: TEAM, communityId: "community-1", guildId: GUILD, channelId: "chan-1", voiceChannelId: "voice-1", roleId: "role-1" },
    ]);
    const { api, calls } = fakeApi();
    api.snapshot = async () => ({
      channels: [
        { id: "chan-1", name: "les-dragons-team_1", type: 0 },
        { id: "voice-1", name: "vocal-les-dragons-team_1", type: 2 },
      ],
      roles: [{ id: "role-1", name: "GN · Les Dragons" }],
    });
    const result = await provisionTeamSpace({ teamId: TEAM, communityId: "community-1", api, store, env: enabled });
    expect(result).toEqual({ status: "reused", roleId: "role-1", channelId: "chan-1", voiceChannelId: "voice-1" });
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

describe("réconciliation", () => {
  const linked = () =>
    createMemorySpaceLinkStore([{ teamId: TEAM, communityId: "community-1", guildId: GUILD, channelId: "chan-1", roleId: "role-1" }]);

  it("réapplique les accès des membres sans rien créer", async () => {
    const { api, calls } = fakeApi();
    api.snapshot = async () => ({
      channels: [{ id: "chan-1", name: "les-dragons-team_1", type: 0 }],
      roles: [{ id: "role-1", name: "GN · Les Dragons" }],
    });
    const result = await reconcileTeamSpace({ teamId: TEAM, communityId: "community-1", api, store: linked(), env: enabled });
    expect(result.status).toBe("consistent");
    expect(result.steps).toContain("members_resynced");
    expect(calls.filter((call) => call.op === "addMemberRole")).toHaveLength(2);
    expect(calls.some((call) => call.op === "createChannel" || call.op === "createRole")).toBe(false);
  });

  it("archive ou restaure selon la présence de membres", async () => {
    const { api, ops } = fakeApi();
    api.snapshot = async () => ({
      channels: [{ id: "chan-1", name: "les-dragons-team_1", type: 0 }],
      roles: [{ id: "role-1", name: "GN · Les Dragons" }],
    });
    mocks.findTeam.mockResolvedValue(team({ members: [] }));
    const store = linked();
    let result = await reconcileTeamSpace({ teamId: TEAM, communityId: "community-1", api, store, env: enabled });
    expect(result.status).toBe("repaired");
    expect(result.steps).toContain("archived");
    expect(ops("renameChannel").at(-1)?.args[1]).toContain("archive-");

    mocks.findTeam.mockResolvedValue(team());
    result = await reconcileTeamSpace({ teamId: TEAM, communityId: "community-1", api, store, env: enabled });
    expect(result.steps).toContain("restored");
    expect(ops("renameChannel").at(-1)?.args[1]).toBe(spaceChannelName({ id: TEAM, name: "Les Dragons" }));
  });

  it("signale une ressource disparue sans recréer ni supprimer", async () => {
    const { api, calls } = fakeApi();
    api.snapshot = async () => ({ channels: [], roles: [{ id: "role-1", name: "GN · Les Dragons" }] });
    const result = await reconcileTeamSpace({
      teamId: TEAM,
      communityId: "community-1",
      api,
      store: linked(),
      env: enabled,
    });
    // Lien antérieur à l'option A : le vocal non associé est aussi signalé, sans recréation.
    expect(result).toEqual({ status: "partial", steps: ["channel_missing", "voice_channel_unlinked"] });
    expect(calls.some((call) => call.op === "createChannel" || call.op === "renameChannel")).toBe(false);
  });

  it("refuse sans association et quand le flag est fermé", async () => {
    const { api } = fakeApi();
    expect((await reconcileTeamSpace({ teamId: TEAM, communityId: "community-1", api, store: createMemorySpaceLinkStore(), env: enabled })).status).toBe("unlinked");
    expect((await reconcileTeamSpace({ teamId: TEAM, communityId: "community-1", api, store: linked(), env: {} as NodeJS.ProcessEnv })).status).toBe("disabled");
  });
});

describe("option A — salon vocal permanent", () => {
  const linkedWithVoice = (voiceChannelId: string | null = "voice-1") =>
    createMemorySpaceLinkStore([
      { teamId: TEAM, communityId: "community-1", guildId: GUILD, channelId: "chan-1", voiceChannelId, roleId: "role-1" },
    ]);

  it("complète le vocal manquant d’un lien antérieur sans recréer texte ni rôle", async () => {
    const store = createMemorySpaceLinkStore([
      { teamId: TEAM, communityId: "community-1", guildId: GUILD, channelId: "chan-1", roleId: "role-1" },
    ]);
    const { api, calls, ops } = fakeApi();
    // Le textuel et le rôle existent déjà côté Discord.
    api.snapshot = async () => ({
      channels: [{ id: "chan-1", name: "les-dragons-team_1", type: 0 }],
      roles: [{ id: "role-1", name: "GN · Les Dragons" }],
    });
    const result = await provisionTeamSpace({ teamId: TEAM, communityId: "community-1", api, store, env: enabled });
    expect(result.status).toBe("reused");
    expect(result.voiceChannelId).toBe("voice-new");
    expect(ops("createRole")).toHaveLength(0);
    expect(ops("createChannel")).toHaveLength(1);
    expect(ops("createChannel")[0].args[2]).toBe(2);
    expect(calls.filter((call) => call.op === "addMemberRole")).toHaveLength(2);
    expect(await store.find(TEAM)).toMatchObject({ channelId: "chan-1", voiceChannelId: "voice-new" });
  });

  it("échec du vocal : partiel, textuel conservé, rejeu sans doublon", async () => {
    const store = createMemorySpaceLinkStore();
    const created = {
      channels: [] as Array<{ id: string; name: string; type: number }>,
      roles: [] as Array<{ id: string; name: string }>,
    };
    const { api, ops } = fakeApi();
    api.snapshot = async () => ({ channels: [...created.channels], roles: [...created.roles] });
    api.createRole = async (_guildId, name) => {
      const id = `role-${created.roles.length + 1}`;
      created.roles.push({ id, name });
      return id;
    };
    let voiceFailed = false;
    api.createChannel = async (_guildId, name, type) => {
      if (type === 2 && !voiceFailed) {
        voiceFailed = true;
        throw new Error("discord_server_error");
      }
      const id = `${type === 2 ? "voice" : "chan"}-${created.channels.length + 1}`;
      created.channels.push({ id, name, type });
      return id;
    };

    const first = await provisionTeamSpace({ teamId: TEAM, communityId: "community-1", api, store, env: enabled });
    expect(first.status).toBe("partial");
    // Le rôle et le textuel sont persistés : le rejeu ne les recrée pas.
    expect(await store.find(TEAM)).toMatchObject({ channelId: "chan-1", voiceChannelId: null });
    expect(ops("addMemberRole")).toHaveLength(0);

    const second = await provisionTeamSpace({ teamId: TEAM, communityId: "community-1", api, store, env: enabled });
    expect(second.status).toBe("reused");
    expect(second.voiceChannelId).toBe("voice-2");
    expect(created.roles).toHaveLength(1);
    expect(created.channels.filter((channel) => channel.type === 0)).toHaveLength(1);
    expect(created.channels.filter((channel) => channel.type === 2)).toHaveLength(1);
    expect(await store.find(TEAM)).toMatchObject({ channelId: "chan-1", voiceChannelId: "voice-2" });
    expect(ops("addMemberRole")).toHaveLength(2);
  });

  it.each([1, 2])("reprend les accès après %i échec(s) membre sans recréer les salons, et ne confirme pas l'exécution avant réparation", async failures => {
    vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "true");
    const store = createMemorySpaceLinkStore();
    mocks.findSpace.mockImplementation(({ where }) => store.find(where.teamId));
    mocks.listSpaces.mockImplementation(({ where }) => store.listByCommunity(where.communityId));
    mocks.saveSpace.mockImplementation(({ create }) => store.save(create));
    mocks.updateSpaces.mockImplementation(({ where, data }) => store.setArchived(where.teamId, data.archived));

    const resources = {
      channels: [] as Array<{ id: string; name: string; type: number }>,
      roles: [] as Array<{ id: string; name: string }>,
    };
    const { api } = fakeApi();
    api.snapshot = async () => resources;
    api.createRole = async (_guild, name) => {
      const id = `role-${resources.roles.length + 1}`;
      resources.roles.push({ id, name });
      return id;
    };
    api.createChannel = async (_guild, name, type) => {
      const id = `${type === 2 ? "voice" : "text"}-${resources.channels.length + 1}`;
      resources.channels.push({ id, name, type });
      return id;
    };
    const granted = new Set<string>();
    let remainingFailures = failures;
    api.addMemberRole = async (_guild, userId) => {
      if (userId === "100000000000000012" && remainingFailures-- > 0) throw new Error("discord_server_error");
      granted.add(userId);
    };

    const action = { intent: "provision" as const, teamId: TEAM, communityId: "community-1" };
    const deadline = new Date(Date.now() + 20_000);
    for (let attempt = 0; attempt < failures; attempt++) {
      // Véritable runner + service + adaptateur de stockage : un accès manquant
      // doit rester retentable, même lorsque les deux salons sont déjà persistés.
      expect(await runTeamSpaceAction(action, deadline, api)).toMatchObject({ ok: false, retryable: true });
      expect(granted.has("100000000000000012")).toBe(false);
      expect(await store.find(TEAM)).toMatchObject({ roleId: "role-1", channelId: "text-1", voiceChannelId: "voice-2" });
    }
    expect(await runTeamSpaceAction(action, deadline, api)).toEqual({ ok: true, data: {} });
    expect([...granted].sort()).toEqual(["100000000000000011", "100000000000000012"]);
    expect(resources.roles).toHaveLength(1);
    expect(resources.channels.map(channel => channel.type).sort()).toEqual([0, 2]);
  });

  it("refuse explicitement quand le serveur a atteint la limite de salons Discord", async () => {
    const { api, calls } = fakeApi();
    api.snapshot = async () => ({
      channels: Array.from({ length: 500 }, (_, index) => ({ id: `c${index}`, name: `s${index}`, type: 0 })),
      roles: [],
    });
    const result = await provisionTeamSpace({
      teamId: TEAM,
      communityId: "community-1",
      api,
      store: createMemorySpaceLinkStore(),
      env: enabled,
    });
    expect(result.status).toBe("capacity");
    expect(calls.some((call) => call.op === "createChannel" || call.op === "createRole")).toBe(false);
  });

  it("signale un vocal supprimé à la main sans le recréer, puis archive les deux salons", async () => {
    const { api, calls, ops } = fakeApi();
    api.snapshot = async () => ({
      channels: [{ id: "chan-1", name: "les-dragons-team_1", type: 0 }],
      roles: [{ id: "role-1", name: "GN · Les Dragons" }],
    });
    const result = await reconcileTeamSpace({
      teamId: TEAM,
      communityId: "community-1",
      api,
      store: linkedWithVoice(),
      env: enabled,
    });
    expect(result).toEqual({ status: "partial", steps: ["voice_channel_missing"] });
    expect(calls.some((call) => call.op === "createChannel" || call.op === "renameChannel")).toBe(false);

    api.snapshot = async () => ({
      channels: [
        { id: "chan-1", name: "les-dragons-team_1", type: 0 },
        { id: "voice-1", name: "vocal-les-dragons-team_1", type: 2 },
      ],
      roles: [{ id: "role-1", name: "GN · Les Dragons" }],
    });
    mocks.findTeam.mockResolvedValue(team({ members: [] }));
    const store = linkedWithVoice();
    const archived = await reconcileTeamSpace({ teamId: TEAM, communityId: "community-1", api, store, env: enabled });
    expect(archived.status).toBe("repaired");
    expect(ops("renameChannel").map((call) => call.args[0])).toEqual(["chan-1", "voice-1"]);
    expect(await store.find(TEAM)).toMatchObject({ archived: true });
  });

  it("lit le salon vocal dans l’association persistée", async () => {
    const { readTeamSpaceLink } = await import("./discord-team-space-service");
    expect(await readTeamSpaceLink({ teamId: TEAM, communityId: "community-1", store: linkedWithVoice() })).toMatchObject({
      status: "linked",
      channelId: "chan-1",
      voiceChannelId: "voice-1",
      archived: false,
    });
  });
});
