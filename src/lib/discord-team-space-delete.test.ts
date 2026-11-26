import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findTeam: vi.fn(), record: vi.fn(), openReports: vi.fn() }));

vi.mock("@/lib/community-scoped-client", () => ({
  scopedPrisma: () => ({ communityTeam: { findFirst: mocks.findTeam }, moderationReport: { count: mocks.openReports } }),
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
  const removed: string[] = [];
  const api: TeamSpaceDiscordApi = {
    snapshot: async () => ({ channels, roles: [] }),
    createRole: async () => "role",
    createChannel: async () => "chan",
    renameChannel: async () => undefined,
    addMemberRole: async () => undefined,
    removeMemberRole: async () => undefined,
    setMemberPermission: async (channelId, userId) => { removed.push(`${channelId}:${userId}`); },
    deleteChannel: async (channelId) => {
      if (channelId === failOn) throw new Error("discord_server_error");
      deleted.push(channelId);
    },
  };
  return { api, deleted, removed };
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
  mocks.openReports.mockResolvedValue(0);
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

  it("refuse à l'exécution une équipe qui n'est plus dissoute", async () => {
    mocks.findTeam.mockResolvedValue({ ...team(), members: [{ userId: "u1", user: { discordId: "123456789012345678", memberships: [{ id: "m1" }] } }] });
    const { api, deleted } = fakeApi(existing);
    const result = await deleteTeamSpace({ teamId: TEAM, communityId: "community-1", api, store: store(), env: enabled });
    expect(result).toEqual({ status: "not_dissolved", channelIds: [] });
    expect(deleted).toEqual([]);
  });

  it("refuse à l'exécution tant qu'un signalement est ouvert", async () => {
    mocks.openReports.mockResolvedValue(1);
    const { api, deleted } = fakeApi(existing);
    const result = await deleteTeamSpace({ teamId: TEAM, communityId: "community-1", api, store: store(), env: enabled });
    expect(result).toEqual({ status: "open_report", channelIds: [] });
    expect(deleted).toEqual([]);
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("retire les accès des anciens membres avant de supprimer les salons", async () => {
    const { api, deleted, removed } = fakeApi(existing, "chan-1");
    const result = await deleteTeamSpace({
      teamId: TEAM, communityId: "community-1", api, store: store(), env: enabled,
      formerMemberDiscordIds: ["111111111111111111", "222222222222222222"],
    });
    expect(result.status).toBe("partial");
    expect(removed).toEqual([
      "chan-1:111111111111111111", "chan-1:222222222222222222",
      "voice-1:111111111111111111", "voice-1:222222222222222222",
    ]);
    expect(deleted).toEqual(["voice-1"]);
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
