import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  community: vi.fn(),
  user: vi.fn(),
  membership: vi.fn(),
  teams: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    community: { findFirst: mocks.community },
    user: { findUnique: mocks.user },
    membership: { findUnique: mocks.membership },
  },
}));
vi.mock("@/lib/community-teams", () => ({ listCommunityTeams: mocks.teams }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import {
  handleSignedTeamInteraction,
  loadCommunityTeams,
  renderMyTeams,
  renderTeamDetail,
  renderTeamList,
  teamsCommandEnabled,
  type CommunityTeamView,
} from "./discord-team-commands";

const APP = "100000000000000001";
const GUILD = "100000000000000002";
const DISCORD = "100000000000000004";
const USER = "user-1";

const team = (over: Partial<CommunityTeamView> = {}): CommunityTeamView => ({
  id: "team-1",
  name: "Paped",
  game: "Deep Rock Galactic",
  platform: "PC",
  description: "On creuse, on chante.",
  isRecruiting: true,
  maxMembers: 8,
  membersCount: 2,
  captainName: "Maxime",
  memberNames: ["Maxime", "Sarah"],
  memberIds: [USER, "user-2"],
  ...over,
});

const serviceTeam = (over: Record<string, unknown> = {}) => ({
  id: "team-1",
  name: "Paped",
  description: "On creuse, on chante.",
  platform: "PC",
  maxMembers: 8,
  isRecruiting: true,
  createdById: USER,
  game: { name: "Deep Rock Galactic" },
  createdBy: { discordName: "Maxime", memberships: [{ id: "m1" }] },
  members: [
    { userId: USER, joinedAt: new Date(), user: { discordName: "Maxime", communityMemberStats: [{ xpTotal: 100 }] } },
  ],
  sessions: [],
  _count: { members: 1 },
  xpScore: { totalXp: 100, members: [] },
  ...over,
});

beforeEach(() => {
  vi.stubEnv("DISCORD_CLIENT_ID", APP);
  vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
  vi.stubEnv("DISCORD_TEAM_COMMAND_ENABLED", "true");
  mocks.community.mockResolvedValue({ id: "community-1", name: "The Tower", communityTeamsEnabled: true });
  mocks.user.mockResolvedValue({ id: USER });
  mocks.membership.mockResolvedValue({ status: "ACTIVE" });
  mocks.teams.mockResolvedValue([serviceTeam()]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

const interaction = (sub?: { name: string; value?: string }) => ({
  type: 2,
  id: "100000000000000050",
  application_id: APP,
  token: "token-equipe",
  guild_id: GUILD,
  member: { user: { id: DISCORD, username: "maxime", bot: false } },
  data: {
    name: "equipe",
    options: sub
      ? [{ name: sub.name, type: 1, options: sub.value === undefined ? [] : [{ name: "equipe", type: 3, value: sub.value }] }]
      : [],
  },
});
const now = () => String(Math.floor(Date.now() / 1000));
const reply = (payload: unknown) =>
  new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });

async function deferredContent(output: ReturnType<typeof handleSignedTeamInteraction>): Promise<string> {
  const fetchMock = vi.fn(async () => reply({ id: "1", channel_id: "2" }));
  vi.stubGlobal("fetch", fetchMock);
  await output.runTeams?.();
  const patched = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
  return JSON.parse(patched[1].body).content as string;
}

describe("/equipe — interrupteur et sécurité", () => {
  it("reste entièrement fermée par défaut, sans toucher la base", async () => {
    vi.stubEnv("DISCORD_TEAM_COMMAND_ENABLED", "");
    expect(teamsCommandEnabled()).toBe(false);
    const output = handleSignedTeamInteraction(interaction({ name: "liste" }), now());
    expect(JSON.stringify(output.body)).toContain("pas encore ouverte");
    expect(output.runTeams).toBeUndefined();
    expect(mocks.community).not.toHaveBeenCalled();
  });

  it("refuse un MP, un horodatage périmé et une autre application", () => {
    const base = interaction({ name: "liste" });
    const noGuild = { ...base, guild_id: undefined };
    expect(JSON.stringify(handleSignedTeamInteraction(noGuild, now()).body)).toContain("dans le serveur");
    const past = String(Math.floor(Date.now() / 1000) - 400);
    expect(handleSignedTeamInteraction(base, past).status).toBe(400);
    expect(handleSignedTeamInteraction({ ...base, application_id: "100000000000000099" }, now()).status).toBe(400);
  });
});

describe("/equipe — lecture seule", () => {
  it("liste les équipes existantes sans rien créer", async () => {
    const content = await deferredContent(handleSignedTeamInteraction(interaction({ name: "liste" }), now()));
    expect(content).toContain("Équipes de The Tower");
    expect(content).toContain("**Paped** (Deep Rock Galactic) — 1/8 · recrute · chef : Maxime");
    expect(content).toContain("Lecture seule");
    expect(mocks.teams).toHaveBeenCalledWith(USER, "community-1");
  });

  it("n’affiche que les équipes du membre avec `moi`", async () => {
    mocks.teams.mockResolvedValue([
      serviceTeam(),
      serviceTeam({
        id: "team-2",
        name: "Les Rois du BBQ",
        members: [{ userId: "user-9", joinedAt: new Date(), user: { discordName: "Alex", communityMemberStats: [] } }],
        createdBy: { discordName: "Alex", memberships: [{ id: "m2" }] },
      }),
    ]);
    const content = await deferredContent(handleSignedTeamInteraction(interaction({ name: "moi" }), now()));
    expect(content).toContain("Paped");
    expect(content).toContain("capitaine");
    expect(content).not.toContain("Les Rois du BBQ");
  });

  it("détaille une équipe par son nom, sans identifiant Discord", async () => {
    const content = await deferredContent(
      handleSignedTeamInteraction(interaction({ name: "voir", value: "paped" }), now())
    );
    expect(content).toContain("**Paped**");
    expect(content).toContain("Deep Rock Galactic · PC");
    expect(content).toContain("Chef d’équipe : Maxime");
    expect(content).toContain("Membres : Maxime");
    expect(content).not.toContain(DISCORD);
    expect(content).not.toContain("user-2");
  });

  it("ne révèle rien d’un non-membre ni d’une communauté sans équipes", async () => {
    mocks.membership.mockResolvedValue({ status: "PENDING" });
    let content = await deferredContent(handleSignedTeamInteraction(interaction({ name: "liste" }), now()));
    expect(content).toContain("n’est pas encore membre");
    expect(mocks.teams).not.toHaveBeenCalled();

    mocks.community.mockReset();
    mocks.membership.mockResolvedValue({ status: "ACTIVE" });
    mocks.community.mockResolvedValue({ id: "community-1", name: "The Tower", communityTeamsEnabled: false });
    content = await deferredContent(handleSignedTeamInteraction(interaction({ name: "liste" }), now()));
    expect(content).toContain("ne sont pas activées");
  });

  it("encaisse une panne de lecture sans exposer d’erreur interne", async () => {
    mocks.teams.mockRejectedValue(new Error("db down"));
    const content = await deferredContent(handleSignedTeamInteraction(interaction({ name: "liste" }), now()));
    expect(content).toContain("Impossible de lire les équipes");
  });
});

describe("/equipe — rendu pur", () => {
  it("annonce l’absence d’équipe sans simuler une création", () => {
    const text = renderTeamList([], "The Tower");
    expect(text).toContain("Aucune équipe n’existe encore");
    expect(text).toContain("reste en préparation");
  });

  it("désambiguïse un nom partagé et signale un nom inconnu", () => {
    const teams = [team({ id: "a", name: "Tower" }), team({ id: "b", name: "Tower 2" })];
    // Le nom exact l’emporte toujours sur une correspondance partielle.
    expect(renderTeamDetail(teams, "tower")).toContain("**Tower**");
    expect(renderTeamDetail(teams, "tower 2")).toContain("**Tower 2**");
    // Deux correspondances partielles : on demande de préciser au lieu de choisir.
    expect(renderTeamDetail(teams, "tow")).toContain("Plusieurs équipes");
    expect(renderTeamDetail(teams, "zzz")).toContain("Aucune équipe ne porte ce nom");
  });

  it("n’affiche rien de privé dans la liste d’un membre", () => {
    const text = renderMyTeams([team()], USER);
    expect(text).toContain("Paped");
    expect(text).not.toContain(DISCORD);
  });
});

describe("chargement des équipes", () => {
  it("réutilise le service d’équipes existant plutôt qu’une requête parallèle", async () => {
    const result = await loadCommunityTeams({ guildId: GUILD, discordId: DISCORD });
    expect(result.status).toBe("TEAMS");
    if (result.status !== "TEAMS") return;
    expect(result.teams[0]).toMatchObject({ name: "Paped", membersCount: 1, captainName: "Maxime" });
    expect(mocks.teams).toHaveBeenCalledWith(USER, "community-1");
  });

  it("refuse un serveur inconnu", async () => {
    mocks.community.mockResolvedValue(null);
    expect((await loadCommunityTeams({ guildId: GUILD, discordId: DISCORD })).status).toBe("NOT_MEMBER");
  });
});
