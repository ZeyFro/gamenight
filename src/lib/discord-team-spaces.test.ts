import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyTeamSpacePlan,
  planTeamSpace,
  sanitizeChannelName,
  spaceKey,
  VIEW_CHANNEL,
  type TeamSpaceClient,
} from "./discord-team-spaces";

const team = (over: Record<string, unknown> = {}) => ({
  id: "team_1",
  name: "Aventure Minecraft",
  communityId: "community-1",
  memberDiscordIds: ["100000000000000001", "100000000000000002"],
  ...over,
});

const base = (over: Record<string, unknown> = {}) => ({
  team: team(over.team as Record<string, unknown>),
  existing: { channels: [], roles: [], ...(over.existing as object) },
  managed: { communityId: "community-1", channelIds: [], ...(over.managed as object) },
  limits: over.limits as { maxSpacesPerCommunity?: number } | undefined,
});

const client = (): TeamSpaceClient => ({
  createRole: vi.fn(async () => ({ id: "role-1" })),
  createChannel: vi.fn(async () => ({ id: "channel-1" })),
  editChannel: vi.fn(async () => ({ ok: true })),
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("planification des espaces d’équipe", () => {
  it("normalise les noms et refuse ceux qui deviennent vides", () => {
    expect(sanitizeChannelName("Aventure  Minecraft — Éco")).toBe("aventure-minecraft-eco");
    expect(spaceKey("team_1")).toBe("gn-team-team_1");
    expect(planTeamSpace(base({ team: { name: "!!" } }))).toEqual({ status: "ineligible", reason: "invalid_name" });
  });

  it("crée un rôle sans permission et un salon privé visible des seuls membres", () => {
    const plan = planTeamSpace(base());
    expect(plan.status).toBe("planned");
    if (plan.status !== "planned") return;
    expect(plan.rolePermissions).toBe("0");
    expect(plan.overwrites).toEqual([
      { target: "everyone", deny: VIEW_CHANNEL },
      { target: "team-role", allow: VIEW_CHANNEL },
    ]);
    expect(plan.steps.map((step) => `${step.kind}:${step.action}`)).toEqual(["role:create", "channel:create", "members:sync"]);
  });

  it("réutilise une ressource existante au lieu de la dupliquer", () => {
    const plan = planTeamSpace(
      base({
        existing: {
          channels: [{ id: "chan-9", name: "aventure-minecraft", type: 0 }],
          roles: [{ id: "role-9", name: "GN · Aventure Minecraft" }],
        },
      })
    );
    expect(plan.status).toBe("planned");
    if (plan.status !== "planned") return;
    expect(plan.steps.map((step) => `${step.kind}:${step.action}`)).toEqual(["role:reuse", "channel:reuse", "members:sync"]);
  });

  it("applique le quota par communauté aux nouveaux espaces seulement", () => {
    expect(planTeamSpace(base({ managed: { channelIds: ["a", "b", "c", "d", "e"] } }))).toEqual({
      status: "ineligible",
      reason: "quota",
    });
    expect(
      planTeamSpace(
        base({
          managed: { channelIds: ["a", "b", "c", "d", "e"] },
          existing: { channels: [{ id: "chan-9", name: "aventure-minecraft", type: 0 }], roles: [] },
        })
      ).status
    ).toBe("planned");
  });

  it("refuse des identifiants Discord invalides et planifie l’archivage d’une équipe vide", () => {
    expect(planTeamSpace(base({ team: { memberDiscordIds: ["pas-un-id"] } }))).toEqual({
      status: "ineligible",
      reason: "invalid_members",
    });
    const plan = planTeamSpace(base({ team: { memberDiscordIds: [] } }));
    expect(plan.status).toBe("planned");
    if (plan.status !== "planned") return;
    expect(plan.archived).toBe(true);
    expect(plan.steps.find((step) => step.kind === "channel")).toMatchObject({ action: "archive" });
  });

  it("refuse une équipe désactivée", () => {
    expect(planTeamSpace(base({ team: { active: false } }))).toEqual({ status: "ineligible", reason: "team_disabled" });
  });
});

describe("application du plan", () => {
  it("ne fait rien tant que le flag est fermé", async () => {
    const fake = client();
    const result = await applyTeamSpacePlan(planTeamSpace(base()), fake, {} as NodeJS.ProcessEnv);
    expect(result).toEqual({ status: "disabled", steps: [] });
    expect(fake.createRole).not.toHaveBeenCalled();
    expect(fake.createChannel).not.toHaveBeenCalled();
  });

  it("crée rôle puis salon avec le flag ouvert, et rien d’autre", async () => {
    vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "true");
    const fake = client();
    const result = await applyTeamSpacePlan(planTeamSpace(base()), fake);
    expect(result.status).toBe("applied");
    expect(fake.createRole).toHaveBeenCalledWith({
      name: "GN · Aventure Minecraft",
      permissions: "0",
      mentionable: false,
      hoist: false,
    });
    expect(fake.createChannel).toHaveBeenCalledWith({
      name: "aventure-minecraft",
      type: 0,
      overwrites: [
        { target: "everyone", deny: VIEW_CHANNEL },
        { target: "team-role", allow: VIEW_CHANNEL },
      ],
      reason: "gn-team-space",
    });
  });

  it("signale un échec partiel sans créer de salon orphelin", async () => {
    vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "true");
    const fake = client();
    (fake.createRole as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("missing_permissions"));
    const result = await applyTeamSpacePlan(planTeamSpace(base()), fake);
    expect(result.status).toBe("partial");
    expect(fake.createChannel).not.toHaveBeenCalled();
    expect(result.steps).toEqual([
      expect.objectContaining({ kind: "role", status: "failed", detail: "missing_permissions" }),
      expect.objectContaining({ kind: "channel", status: "skipped" }),
      expect.objectContaining({ kind: "members", status: "skipped" }),
    ]);
  });

  it("est idempotent quand tout existe déjà", async () => {
    vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "true");
    const fake = client();
    const plan = planTeamSpace(
      base({
        existing: {
          channels: [{ id: "chan-9", name: "aventure-minecraft", type: 0 }],
          roles: [{ id: "role-9", name: "GN · Aventure Minecraft" }],
        },
      })
    );
    const result = await applyTeamSpacePlan(plan, fake);
    expect(result.status).toBe("applied");
    expect(fake.createRole).not.toHaveBeenCalled();
    expect(fake.createChannel).not.toHaveBeenCalled();
  });
});
