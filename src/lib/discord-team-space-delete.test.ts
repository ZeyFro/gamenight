import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findTeam: vi.fn(), record: vi.fn() }));

vi.mock("@/lib/community-scoped-client", () => ({
  scopedPrisma: () => ({ communityTeam: { findFirst: mocks.findTeam } }),
}));
vi.mock("@/lib/sensitive-operation-log", () => ({ recordSensitiveOperation: mocks.record }));

import { createMemorySpaceLinkStore, deleteTeamSpace, type TeamSpaceDiscordApi } from "./discord-team-space-service";

const GUILD = "100000000000000001";
const TEAM = "team_1";

const team = () => ({
  id: TEAM,
  name: "Les Dragons",
  communityId: "community-1",
  createdById: "user-1",
  captainId: null,
  community: { discordGuildId: GUILD },
  members: [],
});

function fakeApi(channels: Array<{ id: string; name: string; type: number }>, failOn?: string) {
  const deleted: string[] = [];
  const api: TeamSpaceDiscordApi = {
    snapshot: async () => ({ channels, roles: [] }),
    createRole: async () => "role",
    createChannel: async () => "chan",
    renameChannel: async () => undefined,
    addMemberRole: async () => undefined,
    removeMemberRole: async () => undefined,
    deleteChannel: async (channelId) => {
      if (channelId === failOn) throw new Error("discord_server_error");
      deleted.push(channelId);
    },
  };
  return { api, deleted };
}

const store = () =>
  createMemorySpaceLinkStore([
    { teamId: TEAM, communityId: "community-1", guildId: GUILD, channelId: "chan-1", voiceChannelId: "voice-1", roleId: null },
  ]);

const enabled = { DISCORD_TEAM_SPACES_ENABLED: "true" } as unknown as NodeJS.ProcessEnv;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findTeam.mockResolvedValue(team());
  mocks.record.mockResolvedValue(undefined);
});

describe("deleteTeamSpace", () => {
  const existing = [
    { id: "chan-1", name: "les-dragons-team_1", type: 0 },
    { id: "voice-1", name: "vocal-les-dragons-team_1", type: 2 },
  ];

  it("dry-run vérifie les identifiants persistés sans supprimer", async () => {
    const { api, deleted } = fakeApi(existing);
    const result = await deleteTeamSpace({ teamId: TEAM, communityId: "community-1", api, store: store(), dryRun: true, env: enabled });
    expect(result).toEqual({ status: "dry_run", channelIds: ["chan-1", "voice-1"] });
    expect(deleted).toEqual([]);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("supprime les deux salons par identifiant et journalise l'acteur", async () => {
    const { api, deleted } = fakeApi(existing);
    const result = await deleteTeamSpace({ teamId: TEAM, communityId: "community-1", api, store: store(), actorId: "user-1", env: enabled });
    expect(result.status).toBe("deleted");
    expect(deleted.sort()).toEqual(["chan-1", "voice-1"]);
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "user-1", action: "discord.team_space_delete", outcome: "ok", target: TEAM,
    }));
  });

  it("salon déjà absent : état cible atteint, aucune suppression par nom", async () => {
    const { api, deleted } = fakeApi([{ id: "chan-other", name: "les-dragons-team_1", type: 0 }]);
    const result = await deleteTeamSpace({ teamId: TEAM, communityId: "community-1", api, store: store(), actorId: "user-1", env: enabled });
    expect(result).toEqual({ status: "already_deleted", channelIds: [] });
    expect(deleted).toEqual([]);
  });

  it("échec partiel puis rejeu : le lien reste, le rejeu termine sans doublon", async () => {
    const link = store();
    const first = fakeApi(existing, "chan-1");
    const failed = await deleteTeamSpace({ teamId: TEAM, communityId: "community-1", api: first.api, store: link, actorId: "user-1", env: enabled });
    expect(failed.status).toBe("partial");
    expect(first.deleted).toEqual(["voice-1"]);
    expect(await link.find(TEAM)).toMatchObject({ channelId: "chan-1", voiceChannelId: "voice-1" });
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "partial" }));

    const retry = fakeApi([existing[0]]);
    const done = await deleteTeamSpace({ teamId: TEAM, communityId: "community-1", api: retry.api, store: link, actorId: "user-1", env: enabled });
    expect(done.status).toBe("deleted");
    expect(retry.deleted).toEqual(["chan-1"]);
    expect(await link.find(TEAM)).toMatchObject({ archived: true });
  });
});
