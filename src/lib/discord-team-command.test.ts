import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  communityId: vi.fn(), list: vi.fn(), join: vi.fn(), user: vi.fn(), community: vi.fn(), edit: vi.fn(),
}));
vi.mock("@/lib/community-teams", () => ({
  getCommunityTeamsCommunityId: mocks.communityId,
  listCommunityTeams: mocks.list,
  joinCommunityTeam: mocks.join,
}));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.user }, community: { findUnique: mocks.community } } }));
vi.mock("@/lib/discord-rest", () => ({ editSetupResponse: mocks.edit }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));

import { handleSignedTeamCommand } from "./discord-team-command";

const guildId = "123456789012345678";
let discordId = "234567890123456789";
let seq = 0;
const teamId = "team-1";
const team = (overrides: Record<string, unknown> = {}) => ({
  id: teamId, name: "Valheim", platform: "PC", maxMembers: 6, isRecruiting: true,
  _count: { members: 3 }, game: { name: "Valheim" }, members: [{ userId: "user-1" }],
  ...overrides,
});
const input = (subcommand: string, options?: unknown[], overrides: Record<string, unknown> = {}) => ({
  type: 2,
  application_id: "345678901234567890",
  token: "private-interaction-token",
  guild_id: guildId,
  member: { user: { id: discordId } },
  data: { name: "equipe", options: [{ type: 1, name: subcommand, ...(options ? { options } : {}) }] },
  ...overrides,
});

async function finish(output: ReturnType<typeof handleSignedTeamCommand>) {
  expect(output.body).toEqual({ type: 5, data: { flags: 64 } });
  expect(mocks.edit).not.toHaveBeenCalled();
  await output.runTeam?.();
  return mocks.edit.mock.calls.at(-1)?.[0].content as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  discordId = `23456789012${String(++seq).padStart(7, "0")}`; // id unique par test : le compteur de débit est global au process
  mocks.user.mockResolvedValue({ id: "user-1" });
  mocks.communityId.mockResolvedValue("community-1");
  mocks.community.mockResolvedValue({ discordGuildId: guildId, status: "ACTIVE", communityTeamsEnabled: true });
  mocks.list.mockResolvedValue([]);
  mocks.join.mockResolvedValue("joined");
  mocks.edit.mockResolvedValue({ ok: true, data: { messageId: "message-1" } });
});

describe("/equipe", () => {
  it("liste uniquement les équipes ouvertes avec des places, en éphémère", async () => {
    mocks.list.mockResolvedValue([
      team({ id: "open", name: "Ouverte", _count: { members: 3 } }),
      team({ id: "full", name: "Pleine", _count: { members: 6 } }),
      team({ id: "closed", name: "Fermée", isRecruiting: false }),
    ]);
    const output = handleSignedTeamCommand(input("liste"));
    const text = await finish(output);
    expect(mocks.list).toHaveBeenCalledWith("user-1", "community-1");
    expect(text).toContain("Ouverte");
    expect(text).toContain("ID open");
    expect(text).not.toContain("Pleine");
    expect(text).not.toContain("Fermée");
  });

  it("moi ne montre que les équipes où l’utilisateur est membre", async () => {
    mocks.list.mockResolvedValue([
      team({ id: "mine", name: "Mon équipe", members: [{ userId: "user-1" }] }),
      team({ id: "other", name: "Autre équipe", members: [{ userId: "user-2" }] }),
    ]);
    const text = await finish(handleSignedTeamCommand(input("moi")));
    expect(text).toContain("Mon équipe");
    expect(text).not.toContain("Autre équipe");
  });

  it("rejoindre transmet l’identifiant au service qui revérifie les règles d’entrée", async () => {
    const text = await finish(handleSignedTeamCommand(input("rejoindre", [{ type: 3, name: "equipe_id", value: teamId }])));
    expect(mocks.join).toHaveBeenCalledWith("user-1", "community-1", teamId);
    expect(text).toContain("Tu as rejoint");
  });

  it("refuse une commande en message privé avant toute lecture ou écriture", () => {
    const output = handleSignedTeamCommand(input("liste", undefined, { guild_id: undefined, member: undefined }));
    expect(output.body).toMatchObject({ data: { flags: 64, content: expect.stringContaining("serveur") } });
    expect(output.runTeam).toBeUndefined();
    expect(mocks.user).not.toHaveBeenCalled();
  });

  it("refuse une équipe d’un autre serveur", async () => {
    mocks.community.mockResolvedValue({ discordGuildId: "987654321098765432", status: "ACTIVE", communityTeamsEnabled: true });
    const text = await finish(handleSignedTeamCommand(input("rejoindre", [{ type: 3, name: "equipe_id", value: teamId }])));
    expect(text).toContain("Sélectionne ce serveur");
    expect(mocks.join).not.toHaveBeenCalled();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("refuse un identifiant manquant ou une sous-commande forgée", () => {
    const missingId = handleSignedTeamCommand(input("rejoindre"));
    expect(missingId.body).toMatchObject({ data: { flags: 64, content: expect.stringContaining("identifiant") } });
    const forged = handleSignedTeamCommand(input("liste", [{ type: 3, name: "equipe_id", value: teamId }]));
    expect(forged.body).toMatchObject({ data: { flags: 64, content: "Commande invalide." } });
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it("limite le débit par discordId : la 6e commande est éphémère, sans DB ni runTeam", () => {
    for (let i = 0; i < 5; i++) expect(handleSignedTeamCommand(input("liste")).runTeam).toBeDefined();
    const blocked = handleSignedTeamCommand(input("liste"));
    expect(blocked.body).toMatchObject({ data: { flags: 64, content: "Trop de requêtes, réessaie dans une minute." } });
    expect(blocked.runTeam).toBeUndefined();
    expect(mocks.user).not.toHaveBeenCalled();
    expect(mocks.edit).not.toHaveBeenCalled();
    discordId = "345678901234567890";
    expect(handleSignedTeamCommand(input("liste")).runTeam).toBeDefined();
  });
});
