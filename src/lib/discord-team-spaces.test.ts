import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyTeamSpacePlan,
  planTeamSpace,
  resolveSpaceChannelId,
  resolveSpaceVoiceChannelId,
  sanitizeChannelName,
  spaceCaptain,
  spaceChannelName,
  spaceKey,
  spaceVoiceChannelName,
  CHANNEL_TYPE_VOICE,
  GUILD_CHANNEL_LIMIT,
  VIEW_CHANNEL,
  type TeamSpaceClient,
  type TeamSpaceInput,
} from "./discord-team-spaces";

const member = (userId: string, discordId: string) => ({ userId, discordId });
const members = [member("user-2", "100000000000000002"), member("user-1", "100000000000000001")];

const team = (over: Partial<TeamSpaceInput["team"]> = {}): TeamSpaceInput["team"] => ({
  id: "team_1",
  name: "Aventure Minecraft",
  communityId: "community-1",
  createdById: "user-1",
  members,
  ...over,
});

const input = (over: Partial<TeamSpaceInput> = {}): TeamSpaceInput => ({
  team: team(),
  existing: { channels: [], roles: [] },
  managedSpaces: [],
  ...over,
});

const client = (): TeamSpaceClient => {
  let created = 0;
  return {
    createRole: vi.fn(async () => ({ id: "role-new" })),
    createChannel: vi.fn(async (channel: { type: number }) => ({ id: `new-${channel.type}-${++created}` })),
    editChannel: vi.fn(async () => ({ ok: true })),
  };
};

const fn = (value: unknown) => value as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("identité des espaces", () => {
  it("dérive des noms de salons spécifiques à l’équipe, sans collision entre homonymes", () => {
    expect(sanitizeChannelName("Aventure  Minecraft — Éco")).toBe("aventure-minecraft-eco");
    const a = spaceChannelName({ id: "team_a", name: "Guilde" });
    const b = spaceChannelName({ id: "team_b", name: "Guilde" });
    expect(a).not.toBe(b);
    expect(a).toContain("team_a");
    // Le vocal partage l'identité de l'équipe : jamais de collision entre équipes homonymes.
    expect(spaceVoiceChannelName({ id: "team_a", name: "Guilde" })).toBe(`vocal-${a}`);
    expect(spaceVoiceChannelName({ id: "team_b", name: "Guilde" })).not.toBe(spaceVoiceChannelName({ id: "team_a", name: "Guilde" }));
    expect(spaceVoiceChannelName(team()).length).toBeLessThanOrEqual(100);
    expect(spaceKey("team_1")).toBe("gn-team-team_1");
  });

  it("ne résout un salon que par lien persisté ou nom exact dérivé de l’équipe", () => {
    const historical = input({
      existing: {
        channels: [
          { id: "chan-historical", name: "aventure-minecraft", type: 0 },
          { id: "chan-other", name: spaceChannelName({ id: "team_9", name: "Aventure Minecraft" }), type: 0 },
        ],
        roles: [],
      },
    });
    // Ni le salon historique proche, ni celui d'une autre équipe.
    expect(resolveSpaceChannelId(historical)).toBeNull();
    expect(resolveSpaceVoiceChannelId(historical)).toBeNull();

    const linked = input({
      existing: {
        channels: [
          { id: "chan-linked", name: "n-importe-quoi", type: 0 },
          { id: "voice-linked", name: "n-importe-quoi", type: 2 },
        ],
        roles: [],
      },
      managedSpaces: [{ teamId: "team_1", channelId: "chan-linked", voiceChannelId: "voice-linked" }],
    });
    expect(resolveSpaceChannelId(linked)).toBe("chan-linked");
    expect(resolveSpaceVoiceChannelId(linked)).toBe("voice-linked");

    const named = input({
      existing: {
        channels: [
          { id: "chan-exact", name: spaceChannelName(team()), type: 0 },
          { id: "voice-exact", name: spaceVoiceChannelName(team()), type: 2 },
        ],
        roles: [],
      },
    });
    expect(resolveSpaceChannelId(named)).toBe("chan-exact");
    expect(resolveSpaceVoiceChannelId(named)).toBe("voice-exact");
  });

  it("ne confond jamais un salon textuel avec le vocal du même nom", () => {
    const plan = planTeamSpace(
      input({
        existing: {
          channels: [{ id: "chan-trompeur", name: spaceVoiceChannelName(team()), type: 0 }],
          roles: [],
        },
      })
    );
    expect(plan.status).toBe("planned");
    if (plan.status !== "planned") return;
    expect(plan.steps.filter((step) => step.kind === "channel" && step.channelType === CHANNEL_TYPE_VOICE)[0]).toMatchObject({
      action: "create",
    });
  });
});

describe("archivage ciblé", () => {
  it("archive uniquement les DEUX salons liés à CETTE équipe", async () => {
    vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "true");
    const fake = client();
    const plan = planTeamSpace(
      input({
        team: team({ members: [] }),
        existing: {
          channels: [
            { id: "chan-team1", name: "espace-archive", type: 0 },
            { id: "voice-team1", name: "vocal-archive", type: 2 },
            { id: "chan-team2", name: "aventure-minecraft-team_2", type: 0 },
          ],
          roles: [],
        },
        managedSpaces: [
          { teamId: "team_1", channelId: "chan-team1", voiceChannelId: "voice-team1", archived: false },
          { teamId: "team_2", channelId: "chan-team2", archived: false },
        ],
      })
    );
    expect(plan.status).toBe("planned");
    if (plan.status !== "planned") return;
    const channels = plan.steps.filter((step) => step.kind === "channel");
    expect(channels).toMatchObject([
      { action: "archive", channelType: 0, targetId: "chan-team1" },
      { action: "archive", channelType: 2, targetId: "voice-team1" },
    ]);

    const result = await applyTeamSpacePlan(plan, fake);
    expect(result.status).toBe("applied");
    expect(fake.editChannel).toHaveBeenCalledTimes(2);
    expect(fake.editChannel).toHaveBeenCalledWith({
      id: "chan-team1",
      name: expect.stringContaining("archive-"),
      reason: "gn-team-archive",
    });
    expect(fake.editChannel).toHaveBeenCalledWith({
      id: "voice-team1",
      name: expect.stringContaining("archive-"),
      reason: "gn-team-archive",
    });
    // Jamais l'identifiant d'équipe comme cible, jamais le salon de l'autre équipe.
    const targets = fn(fake.editChannel).mock.calls.map((call) => (call[0] as { id: string }).id);
    expect(targets).toEqual(["chan-team1", "voice-team1"]);
    expect(targets).not.toContain("team_1");
    expect(JSON.stringify(fn(fake.editChannel).mock.calls)).not.toContain("chan-team2");
    expect(fn(fake.createChannel)).not.toHaveBeenCalled();
  });

  it("refuse d’archiver sans identifiant vérifié au lieu de deviner", async () => {
    vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "true");
    const fake = client();
    const plan = planTeamSpace(
      input({
        team: team({ members: [] }),
        existing: { channels: [{ id: "chan-historical", name: "aventure-minecraft", type: 0 }], roles: [] },
      })
    );
    expect(plan).toEqual({ status: "ineligible", reason: "unmanaged" });
    await applyTeamSpacePlan(plan, fake);
    expect(fake.editChannel).not.toHaveBeenCalled();
    expect(fake.createChannel).not.toHaveBeenCalled();
  });

  it("refuse aussi quand le lien pointe vers un salon disparu", () => {
    const plan = planTeamSpace(
      input({
        team: team({ members: [] }),
        existing: { channels: [], roles: [] },
        managedSpaces: [{ teamId: "team_1", channelId: "chan-gone" }],
      })
    );
    expect(plan).toEqual({ status: "ineligible", reason: "unmanaged" });
  });

  it("réactive les deux salons vérifiés quand l’équipe retrouve des membres", async () => {
    vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "true");
    const fake = client();
    const plan = planTeamSpace(
      input({
        previousArchived: true,
        existing: {
          channels: [
            { id: "chan-team1", name: "archive-aventure-team_1", type: 0 },
            { id: "voice-team1", name: "archive-vocal-aventure-team_1", type: 2 },
          ],
          roles: [],
        },
        managedSpaces: [{ teamId: "team_1", channelId: "chan-team1", voiceChannelId: "voice-team1", archived: true }],
      })
    );
    expect(plan.status).toBe("planned");
    if (plan.status !== "planned") return;
    expect(plan.steps.filter((step) => step.kind === "channel")).toMatchObject([
      { action: "restore", channelType: 0, targetId: "chan-team1" },
      { action: "restore", channelType: 2, targetId: "voice-team1" },
    ]);
    await applyTeamSpacePlan(plan, fake);
    expect(fake.editChannel).toHaveBeenCalledWith({ id: "chan-team1", name: plan.channelName, reason: "gn-team-restore" });
    expect(fake.editChannel).toHaveBeenCalledWith({ id: "voice-team1", name: plan.voiceChannelName, reason: "gn-team-restore" });
  });
});

describe("capitaine, membres et permissions", () => {
  it("prend le capitaine officiel (captainId ?? createdById, membre actif), jamais le premier de la liste", () => {
    expect(spaceCaptain(team())?.userId).toBe("user-1");
    // Passation (#370) : captainId prime sur createdById, qui n'est jamais réécrit.
    expect(spaceCaptain(team({ captainId: "user-2" }))?.userId).toBe("user-2");
    // Capitaine configuré absent des membres actifs : plus ancien membre actif (règle de community-teams.ts).
    expect(spaceCaptain(team({ createdById: "user-absent" }))?.userId).toBe(team().members[0].userId);
    const plan = planTeamSpace(input({ previousMemberDiscordIds: ["100000000000000077"] }));
    expect(plan.status).toBe("planned");
    if (plan.status !== "planned") return;
    expect(plan.captainDiscordId).toBe("100000000000000001");
    const sync = plan.steps.find((step) => step.kind === "members");
    expect(sync).toMatchObject({ members: ["100000000000000002", "100000000000000001"], departed: ["100000000000000077"] });
  });

  it("rôle sans permission, deux salons privés, quota par communauté", () => {
    const plan = planTeamSpace(input());
    expect(plan.status).toBe("planned");
    if (plan.status !== "planned") return;
    expect(plan.rolePermissions).toBe("0");
    expect(plan.overwrites).toEqual([
      { target: "everyone", deny: VIEW_CHANNEL },
      { target: "team-role", allow: VIEW_CHANNEL },
    ]);
    // Les deux salons sont planifiés avec les mêmes overwrites privés.
    const channels = plan.steps.filter((step) => step.kind === "channel");
    expect(channels.map((step) => step.kind === "channel" && step.channelType)).toEqual([0, 2]);
    expect(
      planTeamSpace(
        input({
          managedSpaces: ["1", "2", "3", "4", "5"].map((n) => ({ teamId: `t${n}`, channelId: `c${n}` })),
        })
      )
    ).toEqual({ status: "ineligible", reason: "quota" });
  });

  it("refuse les membres invalides et une équipe désactivée", () => {
    expect(planTeamSpace(input({ team: team({ members: [member("u", "pas-un-id")] }) }))).toEqual({
      status: "ineligible",
      reason: "invalid_members",
    });
    expect(planTeamSpace(input({ team: team({ active: false }) }))).toEqual({ status: "ineligible", reason: "team_disabled" });
  });
});

describe("capacité Discord", () => {
  const channels = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ id: `chan-${index}`, name: `salon-${index}`, type: 0 }));

  it("refuse explicitement quand les limites officielles du serveur sont atteintes", () => {
    expect(planTeamSpace(input({ existing: { channels: channels(GUILD_CHANNEL_LIMIT), roles: [] } }))).toEqual({
      status: "ineligible",
      reason: "capacity",
    });
    expect(
      planTeamSpace(
        input({
          existing: {
            channels: [],
            roles: Array.from({ length: 250 }, (_, index) => ({ id: `role-${index}`, name: `R${index}` })),
          },
        })
      )
    ).toEqual({ status: "ineligible", reason: "capacity" });
  });

  it("signale un seuil d’alerte à 80 % sans bloquer le provisionnement", () => {
    const plan = planTeamSpace(input({ existing: { channels: channels(398), roles: [] } }));
    expect(plan.status).toBe("planned");
    if (plan.status !== "planned") return;
    // 398 + 2 salons = 400 / 500 = 80 %.
    expect(plan.capacityWarning).toBe(true);
    const quiet = planTeamSpace(input({ existing: { channels: channels(10), roles: [] } }));
    expect(quiet.status === "planned" && quiet.capacityWarning).toBe(false);
  });

  it("ne consomme aucune capacité pour un archivage (renommage seul)", () => {
    const plan = planTeamSpace(
      input({
        team: team({ members: [] }),
        existing: {
          channels: [
            ...channels(GUILD_CHANNEL_LIMIT - 2),
            { id: "chan-team1", name: "espace", type: 0 },
          ],
          roles: [],
        },
        managedSpaces: [{ teamId: "team_1", channelId: "chan-team1", archived: false }],
      })
    );
    expect(plan.status).toBe("planned");
  });
});

describe("application", () => {
  it("ne fait rien tant que le flag est fermé", async () => {
    const fake = client();
    const result = await applyTeamSpacePlan(planTeamSpace(input()), fake, {} as NodeJS.ProcessEnv);
    expect(result).toEqual({ status: "disabled", steps: [] });
    expect(fake.createRole).not.toHaveBeenCalled();
    expect(fake.createChannel).not.toHaveBeenCalled();
  });

  it("crée le rôle puis le salon textuel ET le salon vocal avec le flag ouvert", async () => {
    vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "true");
    const fake = client();
    const plan = planTeamSpace(input());
    const result = await applyTeamSpacePlan(plan, fake);
    expect(result.status).toBe("applied");
    expect(fake.createRole).toHaveBeenCalledWith({
      name: "GN · Aventure Minecraft",
      permissions: "0",
      mentionable: false,
      hoist: false,
    });
    expect(fake.createChannel).toHaveBeenNthCalledWith(1, {
      name: spaceChannelName(team()),
      type: 0,
      overwrites: [
        { target: "everyone", deny: VIEW_CHANNEL },
        { target: "team-role", allow: VIEW_CHANNEL },
      ],
      reason: "gn-team-space",
    });
    expect(fake.createChannel).toHaveBeenNthCalledWith(2, {
      name: spaceVoiceChannelName(team()),
      type: 2,
      overwrites: [
        { target: "everyone", deny: VIEW_CHANNEL },
        { target: "team-role", allow: VIEW_CHANNEL },
      ],
      reason: "gn-team-space",
    });
    expect(result.voiceChannelId).toBe("new-2-2");
  });

  it("échoue proprement sans salon orphelin si le rôle échoue", async () => {
    vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "true");
    const fake = client();
    fn(fake.createRole).mockRejectedValue(new Error("missing_permissions"));
    const result = await applyTeamSpacePlan(planTeamSpace(input()), fake);
    expect(result.status).toBe("partial");
    expect(fake.createChannel).not.toHaveBeenCalled();
    expect(result.steps).toEqual([
      expect.objectContaining({ kind: "role", status: "failed", detail: "missing_permissions" }),
      expect.objectContaining({ kind: "channel", status: "skipped" }),
      expect.objectContaining({ kind: "channel", status: "skipped" }),
      expect.objectContaining({ kind: "members", status: "skipped" }),
    ]);
  });

  it("ne crée pas le vocal si le textuel échoue, et n’ajoute aucun accès", async () => {
    vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "true");
    const fake = client();
    fn(fake.createChannel).mockRejectedValue(new Error("missing_manage_channels"));
    const result = await applyTeamSpacePlan(planTeamSpace(input()), fake);
    expect(result.status).toBe("partial");
    expect(fake.createChannel).toHaveBeenCalledTimes(1);
    expect(result.steps).toEqual([
      expect.objectContaining({ kind: "role", status: "ok" }),
      expect.objectContaining({ kind: "channel", status: "failed" }),
      expect.objectContaining({ kind: "channel", status: "skipped", detail: "text_failed" }),
      expect.objectContaining({ kind: "members", status: "skipped" }),
    ]);
  });

  it("crée seulement le vocal manquant d’un lien antérieur à l’option A", async () => {
    vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "true");
    const fake = client();
    const plan = planTeamSpace(
      input({
        existing: {
          channels: [{ id: "chan-1", name: "peu-importe", type: 0 }],
          roles: [{ id: "role-1", name: "GN · Aventure Minecraft" }],
        },
        managedSpaces: [{ teamId: "team_1", channelId: "chan-1", roleId: "role-1" }],
      })
    );
    expect(plan.status).toBe("planned");
    if (plan.status !== "planned") return;
    expect(plan.steps.filter((step) => step.kind === "channel")).toMatchObject([
      { action: "reuse", channelType: 0, targetId: "chan-1" },
      { action: "create", channelType: 2 },
    ]);
    const result = await applyTeamSpacePlan(plan, fake);
    expect(result.status).toBe("applied");
    expect(fake.createRole).not.toHaveBeenCalled();
    expect(fake.createChannel).toHaveBeenCalledTimes(1);
    expect(fn(fake.createChannel).mock.calls[0][0]).toMatchObject({ type: 2 });
  });

  it("est idempotent quand le lien et les deux salons existent", async () => {
    vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "true");
    const fake = client();
    const plan = planTeamSpace(
      input({
        existing: {
          channels: [
            { id: "chan-1", name: "peu-importe", type: 0 },
            { id: "voice-1", name: "peu-importe", type: 2 },
          ],
          roles: [{ id: "role-1", name: "GN · Aventure Minecraft" }],
        },
        managedSpaces: [{ teamId: "team_1", channelId: "chan-1", voiceChannelId: "voice-1", roleId: "role-1" }],
      })
    );
    const result = await applyTeamSpacePlan(plan, fake);
    expect(result.status).toBe("applied");
    expect(fake.createRole).not.toHaveBeenCalled();
    expect(fake.createChannel).not.toHaveBeenCalled();
  });
});
