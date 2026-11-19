import { describe, expect, it, vi } from "vitest";

const rest = vi.hoisted(() => ({
  addGuildMemberRole: vi.fn(),
  createGuildRole: vi.fn(),
  createSetupChannel: vi.fn(),
  editGuildChannel: vi.fn(),
  listGuildRoles: vi.fn(),
  listSetupChannels: vi.fn(),
  removeGuildMemberRole: vi.fn(),
}));
vi.mock("@/lib/discord-rest", () => rest);

import { buildOverwrites, createDiscordTeamSpaceApi } from "./discord-team-space-api";

const GUILD = "100000000000000001";
const ROLE = "100000000000000002";
const USER = "100000000000000003";

describe("permissions d’espace", () => {
  it("traduit les cibles du plan en overwrites Discord réels", () => {
    expect(
      buildOverwrites(GUILD, ROLE, [
        { target: "everyone", deny: "1024" },
        { target: "team-role", allow: "1024" },
      ])
    ).toEqual([
      { id: GUILD, type: 0, allow: "0", deny: "1024" },
      { id: ROLE, type: 0, allow: "1024", deny: "0" },
    ]);
  });

  it("n’invente jamais d’overwrite sans identifiant de rôle", () => {
    expect(buildOverwrites(GUILD, null, [{ target: "team-role", allow: "1024" }])).toEqual([]);
  });
});

describe("adaptateur sous l’executor", () => {
  it("crée le salon vocal (type 2) avec les overwrites privés du plan", async () => {
    const deadline = new Date(Date.now() + 20_000);
    rest.createSetupChannel.mockResolvedValue({ ok: true, data: { id: "voice-1", name: "vocal", type: 2, guild_id: GUILD } });
    const api = createDiscordTeamSpaceApi(deadline);
    expect(await api.createChannel(GUILD, "vocal-rangers", 2, [{ target: "everyone", deny: "1024" }], ROLE)).toBe("voice-1");
    expect(rest.createSetupChannel).toHaveBeenCalledWith({
      guildId: GUILD,
      deadline,
      channel: {
        name: "vocal-rangers",
        type: 2,
        permission_overwrites: [{ id: GUILD, type: 0, allow: "0", deny: "1024" }],
      },
    });
  });

  it("partage l’échéance du bail pour tous les appels et traite un retrait déjà fait comme un succès", async () => {
    const deadline = new Date(Date.now() + 20_000);
    rest.createGuildRole.mockResolvedValue({ ok: true, data: { id: ROLE, name: "GN" } });
    rest.removeGuildMemberRole.mockResolvedValue({ ok: false, kind: "not_found", message: "absent", retryable: false });
    const api = createDiscordTeamSpaceApi(deadline);
    expect(await api.createRole(GUILD, "GN · Équipe")).toBe(ROLE);
    expect(rest.createGuildRole).toHaveBeenCalledWith({ guildId: GUILD, name: "GN · Équipe", deadline });
    await expect(api.removeMemberRole(GUILD, USER, ROLE)).resolves.toBeUndefined();
    rest.removeGuildMemberRole.mockResolvedValue({ ok: false, kind: "auth_or_permission", message: "403", retryable: false });
    await expect(api.removeMemberRole(GUILD, USER, ROLE)).rejects.toThrow("discord_auth_or_permission");
  });
});
