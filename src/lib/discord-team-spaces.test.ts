import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyTeamSpacePlan,
  planTeamSpace,
  resolveSpaceChannelId,
  sanitizeChannelName,
  spaceCaptain,
  spaceChannelName,
  spaceKey,
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

const client = (): TeamSpaceClient => ({
  createRole: vi.fn(async () => ({ id: "role-new" })),
  createChannel: vi.fn(async () => ({ id: "channel-new" })),
  editChannel: vi.fn(async () => ({ ok: true })),
});

const fn = (value: unknown) => value as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("identité des espaces", () => {
  it("dérive un nom de salon spécifique à l’équipe, sans collision entre homonymes", () => {
    expect(sanitizeChannelName("Aventure  Minecraft — Éco")).toBe("aventure-minecraft-eco");
    const a = spaceChannelName({ id: "team_a", name: "Guilde" });
    const b = spaceChannelName({ id: "team_b", name: "Guilde" });
    expect(a).not.toBe(b);
    expect(a).toContain("team_a");
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

    const linked = input({
      existing: { channels: [{ id: "chan-linked", name: "n-importe-quoi", type: 0 }], roles: [] },
      managedSpaces: [{ teamId: "team_1", channelId: "chan-linked" }],
    });
    expect(resolveSpaceChannelId(linked)).toBe("chan-linked");

    const named = input({
      existing: {
        channels: [{ id: "chan-exact", name: spaceChannelName(team()), type: 0 }],
        roles: [],
      },
    });
    expect(resolveSpaceChannelId(named)).toBe("chan-exact");
  });
});

describe("archivage ciblé", () => {
  it("archive uniquement le salon lié à CETTE équipe", async () => {
    vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "true");
    const fake = client();
    const plan = planTeamSpace(
      input({
        team: team({ members: [] }),
        existing: {
          channels: [
            { id: "chan-team1", name: "espace-archive", type: 0 },
            { id: "chan-team2", name: "aventure-minecraft-team_2", type: 0 },
          ],
          roles: [],
        },
        managedSpaces: [
          { teamId: "team_1", channelId: "chan-team1", archived: false },
          { teamId: "team_2", channelId: "chan-team2", archived: false },
        ],
      })
    );
    expect(plan.status).toBe("planned");
    if (plan.status !== "planned") return;
    expect(plan.steps.find((step) => step.kind === "channel")).toMatchObject({
      action: "archive",
      targetId: "chan-team1",
    });

    await applyTeamSpacePlan(plan, fake);
    expect(fake.editChannel).toHaveBeenCalledTimes(1);
    expect(fake.editChannel).toHaveBeenCalledWith({
      id: "chan-team1",
      name: expect.stringContaining("archive-"),
      reason: "gn-team-archive",
    });
    // Jamais l'identifiant d'équipe comme cible, jamais le salon de l'autre équipe.
    const targets = fn(fake.editChannel).mock.calls.map((call) => (call[0] as { id: string }).id);
    expect(targets).toEqual(["chan-team1"]);
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

  it("réactive le salon vérifié quand l’équipe retrouve des membres", async () => {
    vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "true");
    const fake = client();
    const plan = planTeamSpace(
      input({
        previousArchived: true,
        existing: { channels: [{ id: "chan-team1", name: "archive-aventure-team_1", type: 0 }], roles: [] },
        managedSpaces: [{ teamId: "team_1", channelId: "chan-team1", archived: true }],
      })
    );
    expect(plan.status).toBe("planned");
    if (plan.status !== "planned") return;
    expect(plan.steps.find((step) => step.kind === "channel")).toMatchObject({ action: "restore", targetId: "chan-team1" });
    await applyTeamSpacePlan(plan, fake);
    expect(fake.editChannel).toHaveBeenCalledWith({ id: "chan-team1", name: plan.channelName, reason: "gn-team-restore" });
  });
});

describe("capitaine, membres et permissions", () => {
  it("prend le capitaine officiel (créateur membre), jamais le premier de la liste", () => {
    expect(spaceCaptain(team())?.userId).toBe("user-1");
    expect(spaceCaptain(team({ createdById: "user-absent" }))).toBeNull();
    const plan = planTeamSpace(input({ previousMemberDiscordIds: ["100000000000000077"] }));
    expect(plan.status).toBe("planned");
    if (plan.status !== "planned") return;
    expect(plan.captainDiscordId).toBe("100000000000000001");
    const sync = plan.steps.find((step) => step.kind === "members");
    expect(sync).toMatchObject({ members: ["100000000000000002", "100000000000000001"], departed: ["100000000000000077"] });
  });

  it("rôle sans permission, salon privé, quota par communauté", () => {
    const plan = planTeamSpace(input());
    expect(plan.status).toBe("planned");
    if (plan.status !== "planned") return;
    expect(plan.rolePermissions).toBe("0");
    expect(plan.overwrites).toEqual([
      { target: "everyone", deny: VIEW_CHANNEL },
      { target: "team-role", allow: VIEW_CHANNEL },
    ]);
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

describe("application", () => {
  it("ne fait rien tant que le flag est fermé", async () => {
    const fake = client();
    const result = await applyTeamSpacePlan(planTeamSpace(input()), fake, {} as NodeJS.ProcessEnv);
    expect(result).toEqual({ status: "disabled", steps: [] });
    expect(fake.createRole).not.toHaveBeenCalled();
    expect(fake.createChannel).not.toHaveBeenCalled();
  });

  it("crée rôle puis salon uniquement avec le flag ouvert", async () => {
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
    expect(fake.createChannel).toHaveBeenCalledWith({
      name: spaceChannelName(team()),
      type: 0,
      overwrites: [
        { target: "everyone", deny: VIEW_CHANNEL },
        { target: "team-role", allow: VIEW_CHANNEL },
      ],
      reason: "gn-team-space",
    });
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
      expect.objectContaining({ kind: "members", status: "skipped" }),
    ]);
  });

  it("est idempotent quand le lien et les ressources existent", async () => {
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
    const result = await applyTeamSpacePlan(plan, fake);
    expect(result.status).toBe("applied");
    expect(fake.createRole).not.toHaveBeenCalled();
    expect(fake.createChannel).not.toHaveBeenCalled();
  });
});
