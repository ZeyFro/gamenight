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
  create: vi.fn(),
  recruitment: vi.fn(),
  games: vi.fn(),
  exclude: vi.fn(),
  transfer: vi.fn(),
  link: vi.fn(),
  provision: vi.fn(),
  reactivate: vi.fn(),
  sync: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    community: { findFirst: mocks.community },
    user: { findUnique: mocks.user },
    membership: { findUnique: mocks.membership },
    game: { findMany: mocks.games },
  },
}));
vi.mock("@/lib/community-teams", () => ({
  listCommunityTeams: mocks.teams,
  joinCommunityTeam: mocks.join,
  leaveCommunityTeam: mocks.leave,
  createCommunityTeamWithId: mocks.create,
  setCommunityTeamRecruitment: mocks.recruitment,
  excludeCommunityTeamMember: mocks.exclude,
}));
vi.mock("@/lib/community-team-captain-service", () => ({
  transferTeamCaptain: mocks.transfer,
  describeCaptainTransfer: (result: string) => `RESULT:${result}`,
}));
vi.mock("@/lib/discord-team-space-service", () => ({
  provisionTeamSpace: mocks.provision,
  syncTeamSpaceMember: mocks.sync,
  readTeamSpaceLink: mocks.link,
  reactivateTeamSpace: mocks.reactivate,
}));
vi.mock("@/lib/discord-team-space-api", () => ({ createDiscordTeamSpaceApi: () => ({}) }));
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
  members: [
    { userId: USER, name: "Maxime" },
    { userId: "user-2", name: "Sarah" },
  ],
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
  mocks.games.mockResolvedValue([{ id: "game-1", name: "Valheim" }]);
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
    expect(text).toContain("/equipe creer");
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

  it("ne crée aucun salon et aucun rôle Discord", async () => {
    mocks.join.mockResolvedValue("joined");
    await deferredContent(handleSignedTeamInteraction(interaction({ name: "rejoindre", value: "paped" }), now()));
    const handler = readFileSync(join(__dirname, "discord-team-commands.ts"), "utf8");
    for (const forbidden of ["discord-role-sync", "guildRole", "MANAGE_GUILD"]) {
      expect(handler, forbidden).not.toContain(forbidden);
    }
  });
});

describe("/equipe creer — création déléguée au service", () => {
  beforeEach(() => vi.stubEnv("DISCORD_TEAM_WRITE_ENABLED", "true"));

  const withOptions = (subName: string, options: Array<{ name: string; value: string | number | boolean }>) => ({
    type: 2,
    id: "100000000000000060",
    application_id: APP,
    token: "token-create",
    guild_id: GUILD,
    member: { user: { id: DISCORD, username: "maxime", bot: false } },
    data: {
      name: "equipe",
      options: [
        {
          name: subName,
          type: 1,
          options: options.map((option) => ({
            name: option.name,
            type: typeof option.value === "number" ? 4 : typeof option.value === "boolean" ? 5 : 3,
            value: option.value,
          })),
        },
      ],
    },
  });

  const createOptions = [
    { name: "jeu", value: "valheim" },
    { name: "nom", value: "Les Papes" },
    { name: "objectif", value: "Explorer et construire ensemble" },
    { name: "plateforme", value: "PC" },
    { name: "places", value: 6 },
  ];

  it("crée l’équipe via createCommunityTeam, sans copie de la règle métier", async () => {
    mocks.create.mockResolvedValue({ status: "created", teamId: "team-1" });
    const content = await deferredContent(
      handleSignedTeamInteraction(withOptions("creer", createOptions), now())
    );
    expect(content).toContain("Équipe **Les Papes** créée");
    expect(content).toContain("Tu en es le capitaine");
    expect(mocks.create).toHaveBeenCalledWith({
      userId: USER,
      communityId: "community-1",
      gameId: "game-1",
      name: "Les Papes",
      description: "Explorer et construire ensemble",
      platform: "PC",
      maxMembers: 6,
    });
  });

  it("refuse une saisie invalide sans toucher au service", async () => {
    const content = await deferredContent(
      handleSignedTeamInteraction(
        withOptions("creer", [{ ...createOptions[0] }, { name: "nom", value: "ab" }, ...createOptions.slice(2)]),
        now()
      )
    );
    expect(content).toContain("3 et 80 caractères");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("ne devine pas un jeu ambigu et n’en invente pas un inexistant", async () => {
    const ambiguous = createOptions.map((option) => (option.name === "jeu" ? { name: "jeu", value: "val" } : option));
    mocks.games.mockResolvedValue([
      { id: "game-1", name: "Valheim" },
      { id: "game-2", name: "Valheim 2" },
    ]);
    let content = await deferredContent(handleSignedTeamInteraction(withOptions("creer", ambiguous), now()));
    expect(content).toContain("Plusieurs jeux correspondent");
    expect(mocks.create).not.toHaveBeenCalled();

    mocks.games.mockResolvedValue([{ id: "game-3", name: "Minecraft" }]);
    content = await deferredContent(handleSignedTeamInteraction(withOptions("creer", createOptions), now()));
    expect(content).toContain("Jeu introuvable");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("reste fermée par défaut et traduit le quota du service", async () => {
    vi.stubEnv("DISCORD_TEAM_WRITE_ENABLED", "");
    const output = handleSignedTeamInteraction(withOptions("creer", createOptions), now());
    expect(JSON.stringify(output.body)).toContain("n’est pas encore ouvert");
    expect(mocks.create).not.toHaveBeenCalled();

    vi.stubEnv("DISCORD_TEAM_WRITE_ENABLED", "true");
    mocks.create.mockResolvedValue({ status: "limit" });
    const content = await deferredContent(handleSignedTeamInteraction(withOptions("creer", createOptions), now()));
    expect(content).toContain("trois équipes");
  });
});

describe("/equipe recrutement — droit de gestion par capitainerie", () => {
  beforeEach(() => vi.stubEnv("DISCORD_TEAM_WRITE_ENABLED", "true"));

  const withOptions = (options: Array<{ name: string; value: string | number | boolean }>) => ({
    type: 2,
    id: "100000000000000061",
    application_id: APP,
    token: "token-recrutement",
    guild_id: GUILD,
    member: { user: { id: DISCORD, username: "maxime", bot: false } },
    data: {
      name: "equipe",
      options: [
        {
          name: "recrutement",
          type: 1,
          options: options.map((option) => ({
            name: option.name,
            type: typeof option.value === "boolean" ? 5 : 3,
            value: option.value,
          })),
        },
      ],
    },
  });

  it("refuse un membre ordinaire : aucun droit déduit de l’ordre", async () => {
    mocks.teams.mockResolvedValue([
      serviceTeam({
        members: [
          { userId: USER, joinedAt: new Date(), user: { discordName: "Maxime", communityMemberStats: [] } },
          { userId: "user-2", joinedAt: new Date(), user: { discordName: "Sarah", communityMemberStats: [] } },
        ],
        createdById: "user-2",
        captainId: "user-2",
      }),
    ]);
    const content = await deferredContent(
      handleSignedTeamInteraction(
        withOptions([
          { name: "equipe", value: "paped" },
          { name: "ouvert", value: true },
        ]),
        now()
      )
    );
    expect(content).toContain("Seul le capitaine");
    expect(mocks.recruitment).not.toHaveBeenCalled();
  });

  it("laisse le capitaine ouvrir le recrutement via le service", async () => {
    mocks.recruitment.mockResolvedValue("saved");
    const content = await deferredContent(
      handleSignedTeamInteraction(
        withOptions([
          { name: "equipe", value: "paped" },
          { name: "ouvert", value: true },
        ]),
        now()
      )
    );
    expect(content).toContain("Recrutement ouvert sur **Paped**");
    expect(mocks.recruitment).toHaveBeenCalledWith(USER, "community-1", "team-1", true);
  });

  it("refuse quand aucun capitaine n’est désigné", async () => {
    mocks.teams.mockResolvedValue([serviceTeam({ createdById: "user-parti", captainId: "user-parti" })]);
    const content = await deferredContent(
      handleSignedTeamInteraction(
        withOptions([
          { name: "equipe", value: "paped" },
          { name: "ouvert", value: false },
        ]),
        now()
      )
    );
    expect(content).toContain("Seul le capitaine");
    expect(content).toContain("aucun capitaine");
    expect(mocks.recruitment).not.toHaveBeenCalled();
  });

  it("exige explicitement ouvert:true ou ouvert:false", async () => {
    const content = await deferredContent(
      handleSignedTeamInteraction(withOptions([{ name: "equipe", value: "paped" }]), now())
    );
    expect(content).toContain("ouvert:true");
    expect(mocks.recruitment).not.toHaveBeenCalled();
  });
});

describe("/equipe capitaine, membres, transfert, exclusion, espace", () => {
  const twoMembers = () =>
    serviceTeam({
      members: [
        { userId: USER, joinedAt: new Date(), user: { discordName: "Maxime", communityMemberStats: [{ xpTotal: 100 }] } },
        { userId: "user-2", joinedAt: new Date(), user: { discordName: "Sarah", communityMemberStats: [{ xpTotal: 50 }] } },
      ],
      _count: { members: 2 },
    });

  beforeEach(() => {
    mocks.teams.mockResolvedValue([twoMembers()]);
    mocks.transfer.mockResolvedValue("transferred");
    // `espace creer` et les mutations passent par l'interrupteur d'écriture.
    vi.stubEnv("DISCORD_TEAM_WRITE_ENABLED", "true");
  });

  const withSub = (name: string, options: Array<{ name: string; value: string | number | boolean }> = []) => ({
    type: 2,
    id: "100000000000000051",
    application_id: APP,
    token: "token-equipe",
    guild_id: GUILD,
    member: { user: { id: DISCORD, username: "maxime", bot: false } },
    data: { name: "equipe", options: [{ name, type: 1, options }] },
  });

  it("affiche le capitaine officiel et la liste des membres sans promouvoir personne", async () => {
    let content = await deferredContent(handleSignedTeamInteraction(withSub("capitaine", [{ name: "equipe", value: "Paped" }]), now()));
    expect(content).toContain("Capitaine de **Paped**");
    expect(content).toContain("Maxime");

    content = await deferredContent(handleSignedTeamInteraction(withSub("membres", [{ name: "equipe", value: "Paped" }]), now()));
    expect(content).toContain("Membres de **Paped**");
    expect(content).toContain("Sarah");
    expect(content).toContain("👑");
  });

  it("transfère la capitainerie uniquement à un membre, via le service métier", async () => {
    vi.stubEnv("DISCORD_TEAM_WRITE_ENABLED", "true");
    const content = await deferredContent(
      handleSignedTeamInteraction(withSub("transferer", [{ name: "equipe", value: "Paped" }, { name: "membre", value: "Sarah" }]), now())
    );
    expect(content).toContain("RESULT:transferred");
    expect(mocks.transfer).toHaveBeenCalledWith({
      teamId: "team-1",
      communityId: "community-1",
      actorId: USER,
      newCaptainUserId: "user-2",
    });

    const missing = await deferredContent(
      handleSignedTeamInteraction(withSub("transferer", [{ name: "equipe", value: "Paped" }, { name: "membre", value: "Inconnu" }]), now())
    );
    expect(missing).toContain("ne fait pas partie de l’équipe");
    expect(mocks.transfer).toHaveBeenCalledTimes(1);
  });

  it("refuse l’exclusion par un membre ordinaire et ne synchronise rien", async () => {
    vi.stubEnv("DISCORD_TEAM_WRITE_ENABLED", "true");
    mocks.exclude.mockResolvedValue({ status: "not_captain" });
    const content = await deferredContent(
      handleSignedTeamInteraction(withSub("exclure", [{ name: "equipe", value: "Paped" }, { name: "membre", value: "Sarah" }]), now())
    );
    expect(content).toContain("Seul le capitaine");
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("exclut un membre côté service et retire ses accès Discord", async () => {
    vi.stubEnv("DISCORD_TEAM_WRITE_ENABLED", "true");
    vi.stubEnv("DISCORD_TEAM_SPACES_ENABLED", "true");
    mocks.exclude.mockResolvedValue({ status: "removed", discordId: "100000000000000099" });
    mocks.sync.mockResolvedValue({ status: "removed" });
    const content = await deferredContent(
      handleSignedTeamInteraction(withSub("exclure", [{ name: "equipe", value: "Paped" }, { name: "membre", value: "Sarah" }]), now())
    );
    expect(content).toContain("a été exclu");
    expect(content).toContain("XP");
    expect(mocks.sync).toHaveBeenCalledWith(
      expect.objectContaining({ discordId: "100000000000000099", action: "leave", teamId: "team-1" })
    );
  });

  it("explique l’espace géré et refuse la création à un non-capitaine", async () => {
    mocks.link.mockResolvedValue({ status: "unlinked" });
    let content = await deferredContent(handleSignedTeamInteraction(withSub("espace", [{ name: "equipe", value: "Paped" }]), now()));
    expect(content).toContain("pas d’espace Discord géré");

    mocks.teams.mockResolvedValue([
      serviceTeam({
        createdById: "autre",
        createdBy: { discordName: "Autre", memberships: [{ id: "m1" }] },
        members: [
          { userId: "autre", joinedAt: new Date(), user: { discordName: "Autre", communityMemberStats: [{ xpTotal: 10 }] } },
          { userId: USER, joinedAt: new Date(), user: { discordName: "Maxime", communityMemberStats: [{ xpTotal: 100 }] } },
        ],
        _count: { members: 2 },
      }),
    ]);
    content = await deferredContent(
      handleSignedTeamInteraction(withSub("espace", [{ name: "equipe", value: "Paped" }, { name: "creer", value: true }]), now())
    );
    expect(content).toContain("Seul le capitaine");
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("refuse la création d’espace quand l’association n’est pas migrée", async () => {
    mocks.link.mockResolvedValue({ status: "migration_required" });
    const content = await deferredContent(
      handleSignedTeamInteraction(withSub("espace", [{ name: "equipe", value: "Paped" }, { name: "creer", value: true }]), now())
    );
    expect(content).toContain("pas encore migrée");
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("réactive un espace archivé, et seulement par le capitaine", async () => {
    mocks.link.mockResolvedValue({ status: "linked", channelId: "chan-1", roleId: "role-1", archived: true });
    mocks.reactivate.mockResolvedValue({ status: "reused" });
    let content = await deferredContent(
      handleSignedTeamInteraction(withSub("espace", [{ name: "equipe", value: "Paped" }, { name: "reactiver", value: true }]), now())
    );
    expect(content).toContain("Espace réactivé");
    expect(mocks.reactivate).toHaveBeenCalledWith(expect.objectContaining({ teamId: "team-1", communityId: "community-1" }));

    mocks.teams.mockResolvedValue([
      serviceTeam({
        createdById: "autre",
        createdBy: { discordName: "Autre", memberships: [{ id: "m1" }] },
        members: [{ userId: "autre", joinedAt: new Date(), user: { discordName: "Autre", communityMemberStats: [{ xpTotal: 10 }] } }],
      }),
    ]);
    content = await deferredContent(
      handleSignedTeamInteraction(withSub("espace", [{ name: "equipe", value: "Paped" }, { name: "reactiver", value: true }]), now())
    );
    expect(content).toContain("Seul le capitaine");
    expect(mocks.reactivate).toHaveBeenCalledTimes(1);
  });

  it("n’invente pas d’invitation directe", async () => {
    const content = await deferredContent(handleSignedTeamInteraction(withSub("invitations", [{ name: "equipe", value: "Paped" }]), now()));
    expect(content).toContain("Aucune invitation directe");
    expect(content).toContain("rejoindre");
  });
});
