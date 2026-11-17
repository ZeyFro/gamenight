import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  community: vi.fn(),
  user: vi.fn(),
  membership: vi.fn(),
  teams: vi.fn(),
  join: vi.fn(),
  leave: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    community: { findFirst: mocks.community },
    user: { findUnique: mocks.user },
    membership: { findUnique: mocks.membership },
  },
}));
vi.mock("@/lib/community-teams", () => ({
  listCommunityTeams: mocks.teams,
  joinCommunityTeam: mocks.join,
  leaveCommunityTeam: mocks.leave,
}));
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
  captainId: USER,
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
  vi.stubEnv("DISCORD_TEAM_WRITE_ENABLED", "");
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
    expect(content).toContain("**Paped** (Deep Rock Galactic) — 1/8 · recrute · capitaine : Maxime");
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
    expect(content).toContain("Capitaine : Maxime");
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

  it("identifie le capitaine en dernière position, sans dépendre de l’ordre des membres", async () => {
    mocks.teams.mockResolvedValue([
      serviceTeam({
        members: [
          { userId: "user-2", joinedAt: new Date(), user: { discordName: "Sarah", communityMemberStats: [] } },
          { userId: USER, joinedAt: new Date(), user: { discordName: "Maxime", communityMemberStats: [] } },
        ],
      }),
    ]);
    const content = await deferredContent(handleSignedTeamInteraction(interaction({ name: "liste" }), now()));
    expect(content).toContain("capitaine : Maxime");
    expect(content).not.toContain("capitaine : Sarah");
  });

  it("affiche « Capitaine non renseigné » quand le créateur n’est plus membre actif", async () => {
    mocks.teams.mockResolvedValue([
      serviceTeam({
        createdById: "user-parti",
        createdBy: { discordName: "Parti", memberships: [] },
        members: [
          { userId: "user-2", joinedAt: new Date(), user: { discordName: "Sarah", communityMemberStats: [] } },
        ],
      }),
    ]);
    const content = await deferredContent(handleSignedTeamInteraction(interaction({ name: "voir", value: "paped" }), now()));
    expect(content).toContain("Capitaine non renseigné");
    // Le premier (et seul) membre n’est jamais promu à sa place.
    expect(content).not.toContain("Capitaine : Sarah");
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

  it("ne présente jamais un membre ordinaire comme capitaine dans `moi`", () => {
    const other = team({
      captainId: "user-9",
      captainName: "Alex",
      memberIds: [USER, "user-9"],
      memberNames: ["Maxime", "Alex"],
    });
    const text = renderMyTeams([other], USER);
    expect(text).toContain("capitaine : Alex");
    expect(text).not.toContain("tu es capitaine");
    expect(renderMyTeams([team()], USER)).toContain("tu es capitaine");
  });
});

describe("chargement des équipes", () => {
  it("réutilise le service d’équipes existant plutôt qu’une requête parallèle", async () => {
    const result = await loadCommunityTeams({ guildId: GUILD, discordId: DISCORD });
    expect(result.status).toBe("TEAMS");
    if (result.status !== "TEAMS") return;
    expect(result.teams[0]).toMatchObject({ name: "Paped", membersCount: 1, captainName: "Maxime" });
    expect(result.userId).toBe(USER);
    expect(result.communityId).toBe("community-1");
    expect(mocks.teams).toHaveBeenCalledWith(USER, "community-1");
  });

  it("refuse un serveur inconnu", async () => {
    mocks.community.mockResolvedValue(null);
    expect((await loadCommunityTeams({ guildId: GUILD, discordId: DISCORD })).status).toBe("NOT_MEMBER");
  });
});

describe("/equipe rejoindre|quitter — même logique métier", () => {
  beforeEach(() => vi.stubEnv("DISCORD_TEAM_WRITE_ENABLED", "true"));

  it("reste fermée par défaut : aucune écriture tentée", () => {
    vi.stubEnv("DISCORD_TEAM_WRITE_ENABLED", "");
    const output = handleSignedTeamInteraction(interaction({ name: "rejoindre", value: "paped" }), now());
    expect(JSON.stringify(output.body)).toContain("n’est pas encore ouvert");
    expect(output.runTeams).toBeUndefined();
    expect(mocks.join).not.toHaveBeenCalled();
    expect(mocks.leave).not.toHaveBeenCalled();
  });

  it("rejoint via le service métier et rappelle le capitaine officiel", async () => {
    mocks.join.mockResolvedValue("joined");
    const content = await deferredContent(
      handleSignedTeamInteraction(interaction({ name: "rejoindre", value: "paped" }), now())
    );
    expect(content).toContain("Tu as rejoint **Paped**");
    expect(content).toContain("capitaine : Maxime");
    expect(mocks.join).toHaveBeenCalledWith(USER, "community-1", "team-1");
  });

  it("traduit les refus du service, sans requête écrite en parallèle", async () => {
    for (const [outcome, expected] of [
      ["already", "déjà partie"],
      ["closed", "ne recrute pas"],
      ["full", "est complète (1/8)"],
      ["missing", "n’existe plus"],
      ["unavailable", "ne sont pas disponibles"],
    ] as const) {
      mocks.join.mockResolvedValue(outcome);
      const content = await deferredContent(
        handleSignedTeamInteraction(interaction({ name: "rejoindre", value: "paped" }), now())
      );
      expect(content, outcome).toContain(expected);
    }
  });

  it("refuse de faire quitter le capitaine, sans transmettre la capitainerie", async () => {
    mocks.leave.mockResolvedValue("leader");
    const content = await deferredContent(
      handleSignedTeamInteraction(interaction({ name: "quitter", value: "paped" }), now())
    );
    expect(content).toContain("Tu es capitaine");
    expect(content).toContain("passation en préparation");
    expect(content).toContain("reste intacte");
  });

  it("fait quitter un membre ordinaire via le service", async () => {
    mocks.leave.mockResolvedValue("left");
    const content = await deferredContent(
      handleSignedTeamInteraction(interaction({ name: "quitter", value: "paped" }), now())
    );
    expect(content).toContain("Tu as quitté **Paped**");
    expect(mocks.leave).toHaveBeenCalledWith(USER, "community-1", "team-1");
  });

  it("ne choisit jamais une équipe quand plusieurs correspondent", async () => {
    mocks.teams.mockResolvedValue([
      serviceTeam({ id: "team-1", name: "Tower" }),
      serviceTeam({ id: "team-2", name: "Tower 2" }),
    ]);
    const content = await deferredContent(
      handleSignedTeamInteraction(interaction({ name: "rejoindre", value: "tow" }), now())
    );
    expect(content).toContain("Plusieurs équipes correspondent");
    expect(mocks.join).not.toHaveBeenCalled();
  });

  it("ne crée aucune équipe, aucun salon et aucun rôle", async () => {
    mocks.join.mockResolvedValue("joined");
    await deferredContent(handleSignedTeamInteraction(interaction({ name: "rejoindre", value: "paped" }), now()));
    const handler = readFileSync(join(__dirname, "discord-team-commands.ts"), "utf8");
    for (const forbidden of ["createCommunityTeam", "setCommunityTeamRecruitment", "discord-role-sync", "guildRole"]) {
      expect(handler, forbidden).not.toContain(forbidden);
    }
  });
});
