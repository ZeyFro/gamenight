import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findTeam: vi.fn(), record: vi.fn(), openReports: vi.fn(), activeChallenges: vi.fn(), openAppeals: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { warn: mocks.warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

vi.mock("@/lib/community-scoped-client", () => ({
  scopedPrisma: () => ({
    communityTeam: { findFirst: mocks.findTeam }, moderationReport: { count: mocks.openReports },
    towerChallengeAttempt: { count: mocks.activeChallenges }, towerChallengeAppeal: { count: mocks.openAppeals },
  }),
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
  mocks.activeChallenges.mockResolvedValue(0);
  mocks.openAppeals.mockResolvedValue(0);
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
    // D5 : l'abandon est tracé au journal des opérations sensibles (aucune écriture Discord n'a eu lieu).
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ action: "discord.team_space_delete", outcome: "open_report", target: TEAM }));
  });

  it.each([["un défi relancé", "activeChallenges"], ["une contestation ouverte", "openAppeals"]] as const)(
    "revérifie à l'exécution : %s abandonne la suppression (aucun salon supprimé), RETIRE d'abord les accès des anciens membres, trace au journal",
    async (_label, mock) => {
      mocks[mock].mockResolvedValue(1);
      const { api, deleted, removed } = fakeApi(existing);
      const result = await deleteTeamSpace({
        teamId: TEAM, communityId: "community-1", api, store: store(), env: enabled, formerMemberDiscordIds: ["111111111111111111"],
      });
      expect(result).toEqual({ status: "blocked", channelIds: [] });
      expect(deleted).toEqual([]);
      // I1 : l'abandon est terminal, les anciens membres ne gardent PAS leur accès nominatif indéfiniment (retrait réversible).
      expect(removed).toEqual(["chan-1:111111111111111111", "voice-1:111111111111111111"]);
      expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "blocked" }));
    },
  );

  it("I1 : un signalement ouvert révoque aussi les accès avant l'abandon ; un membre ACTUEL de l'équipe n'est jamais révoqué (équipe repeuplée)", async () => {
    mocks.openReports.mockResolvedValue(1);
    const first = fakeApi(existing);
    expect((await deleteTeamSpace({ teamId: TEAM, communityId: "community-1", api: first.api, store: store(), env: enabled, formerMemberDiscordIds: ["111111111111111111"] })).status).toBe("open_report");
    expect(first.removed).toEqual(["chan-1:111111111111111111", "voice-1:111111111111111111"]);
    expect(first.deleted).toEqual([]);

    mocks.openReports.mockResolvedValue(0);
    mocks.findTeam.mockResolvedValue({ ...team(), members: [{ userId: "u9", user: { discordId: "999999999999999999", memberships: [{ id: "m9" }] } }] });
    const second = fakeApi(existing);
    const repopulated = await deleteTeamSpace({
      teamId: TEAM, communityId: "community-1", api: second.api, store: store(), env: enabled,
      formerMemberDiscordIds: ["111111111111111111", "999999999999999999"],
    });
    expect(repopulated.status).toBe("not_dissolved");
    expect(second.removed.every((entry) => entry.endsWith(":111111111111111111"))).toBe(true);
    expect(second.removed.some((entry) => entry.includes("999999999999999999"))).toBe(false);
    expect(second.deleted).toEqual([]);
  });

  it("I1 : si le retrait des accès échoue avant un abandon, le résultat est « partial » (rejouable), jamais un abandon silencieux", async () => {
    mocks.activeChallenges.mockResolvedValue(1);
    const { api, deleted } = fakeApi(existing);
    api.setMemberPermission = async () => { throw new Error("discord_server_error"); };
    const result = await deleteTeamSpace({ teamId: TEAM, communityId: "community-1", api, store: store(), env: enabled, formerMemberDiscordIds: ["111111111111111111"] });
    expect(result.status).toBe("partial");
    expect(deleted).toEqual([]);
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "partial" }));
  });

  it("I4 : sans liste d'anciens membres (perdue ou illisible), les surcharges nominatives des salons ENREGISTRÉS sont relues et retirées avant la suppression", async () => {
    const withOverwrites = [
      { id: "chan-1", name: "a", type: 0, memberOverwriteIds: ["111111111111111111", "222222222222222222"] },
      { id: "voice-1", name: "b", type: 2, memberOverwriteIds: ["111111111111111111"] },
      // Salon étranger : ses surcharges ne sont JAMAIS touchées.
      { id: "intrus", name: "a", type: 0, memberOverwriteIds: ["333333333333333333"] },
    ];
    const order: string[] = [];
    const { api } = fakeApi(withOverwrites);
    const baseSet = api.setMemberPermission!;
    api.setMemberPermission = async (channelId, userId, allow, action) => { order.push(`remove:${channelId}:${userId}`); return baseSet(channelId, userId, allow, action); };
    const baseDelete = api.deleteChannel!;
    api.deleteChannel = async (channelId) => { order.push(`delete:${channelId}`); return baseDelete(channelId); };
    const result = await deleteTeamSpace({ teamId: TEAM, communityId: "community-1", api, store: store(), env: enabled });
    expect(result.status).toBe("deleted");
    const firstDelete = order.findIndex((entry) => entry.startsWith("delete:"));
    expect(order.slice(0, firstDelete).sort()).toEqual([
      "remove:chan-1:111111111111111111", "remove:chan-1:222222222222222222", "remove:voice-1:111111111111111111", "remove:voice-1:222222222222222222",
    ]);
    expect(order.some((entry) => entry.includes("intrus") || entry.includes("333333333333333333"))).toBe(false);
  });

  it("MINEUR : un journal des opérations sensibles défaillant ne fait ni lever ni taire : l'abandon et la suppression aboutissent, l'échec est visible dans les logs", async () => {
    mocks.record.mockRejectedValue(new Error("journal indisponible"));
    mocks.openReports.mockResolvedValue(1);
    const blocked = fakeApi(existing);
    expect((await deleteTeamSpace({ teamId: TEAM, communityId: "community-1", api: blocked.api, store: store(), env: enabled })).status).toBe("open_report");
    mocks.openReports.mockResolvedValue(0);
    const ok = fakeApi(existing);
    expect((await deleteTeamSpace({ teamId: TEAM, communityId: "community-1", api: ok.api, store: store(), env: enabled })).status).toBe("deleted");
    expect(ok.deleted.sort()).toEqual(["chan-1", "voice-1"]);
    expect(mocks.warn).toHaveBeenCalledWith("discord-team-space", expect.stringContaining("Journal de suppression d’espace non écrit"), expect.anything());
  });

  it("n'efface jamais un salon système : un identifiant enregistré égal à un salon configuré est refusé", async () => {
    const { api, deleted } = fakeApi(existing);
    const result = await deleteTeamSpace({
      teamId: TEAM, communityId: "community-1", api, store: store(),
      env: { ...enabled, TOWER_DISCORD_CHANNEL_ID: "voice-1" } as unknown as NodeJS.ProcessEnv,
    });
    expect(result).toEqual({ status: "mismatch", channelIds: [] });
    expect(deleted).toEqual([]);
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "mismatch" }));
  });

  it("n'efface pas un identifiant dont le type ne correspond plus (texte enregistré devenu vocal)", async () => {
    const { api, deleted } = fakeApi([{ id: "chan-1", name: "x", type: 2 }, { id: "voice-1", name: "y", type: 2 }]);
    const result = await deleteTeamSpace({ teamId: TEAM, communityId: "community-1", api, store: store(), env: enabled });
    expect(result).toEqual({ status: "mismatch", channelIds: [] });
    expect(deleted).toEqual([]);
  });

  it("si le retrait d'un accès échoue, AUCUN salon n'est supprimé (accès d'abord) et le rejeu reste possible", async () => {
    const { api, deleted } = fakeApi(existing);
    api.setMemberPermission = async () => { throw new Error("discord_server_error"); };
    const result = await deleteTeamSpace({
      teamId: TEAM, communityId: "community-1", api, store: store(), env: enabled, formerMemberDiscordIds: ["111111111111111111"],
    });
    expect(result.status).toBe("partial");
    expect(deleted).toEqual([]);
  });

  it("ne supprime QUE les identifiants enregistrés, même si un autre salon porte le même nom", async () => {
    const { api, deleted } = fakeApi([...existing, { id: "intrus", name: "les-dragons-team_1", type: 0 }, { id: "intrus-2", name: "vocal-les-dragons-team_1", type: 2 }]);
    const result = await deleteTeamSpace({ teamId: TEAM, communityId: "community-1", api, store: store(), env: enabled });
    expect(result.status).toBe("deleted");
    expect(deleted.sort()).toEqual(["chan-1", "voice-1"]);
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
