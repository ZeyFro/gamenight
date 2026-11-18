import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: vi.fn(), list: vi.fn(), create: vi.fn(), join: vi.fn(), leave: vi.fn(), recruit: vi.fn(),
  game: vi.fn(), edit: vi.fn(), memberSync: vi.fn(), enqueue: vi.fn(), queueEnabled: vi.fn(), link: vi.fn(),
  count: vi.fn(), provisionForCreator: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/community-teams", () => ({
  listCommunityTeams: mocks.list, createCommunityTeam: mocks.create, joinCommunityTeam: mocks.join,
  leaveCommunityTeam: mocks.leave, setCommunityTeamRecruitment: mocks.recruit,
}));
vi.mock("@/lib/discord-team-command", () => ({ resolveTeamCommandContext: mocks.context }));
vi.mock("@/lib/discord-game-lookup", () => ({ resolveGameId: mocks.game }));
vi.mock("@/lib/discord-rest", () => ({ editSetupResponse: mocks.edit }));
vi.mock("@/lib/discord-team-space-hooks", () => ({
  requestTeamSpaceMemberSync: mocks.memberSync,
  requestTeamSpaceProvisionForCreator: mocks.provisionForCreator,
}));
vi.mock("@/lib/discord-team-space-queue", () => ({ enqueueTeamSpaceSync: mocks.enqueue, teamSpaceQueueEnabled: mocks.queueEnabled }));
vi.mock("@/lib/discord-team-space-service", () => ({ readTeamSpaceLink: mocks.link, countTeamSpaces: mocks.count }));

import { handleSignedProjectCommand } from "./discord-project-command";

const GUILD = "123456789012345678";
let discordId = "234567890123456789";
let seq = 0;
const team = (over: Record<string, unknown> = {}) => ({
  id: "team-1", name: "Aventure Minecraft", description: "Serveur coop tranquille", platform: "PC",
  maxMembers: 6, isRecruiting: true, createdById: "user-1", captainId: null,
  captain: null, createdBy: { discordName: "Maxime" }, _count: { members: 3 }, game: { name: "Minecraft" },
  members: [{ userId: "user-1", user: { discordName: "Maxime" } }], ...over,
});
const input = (sub: string, options: Array<{ name: string; type: number; value?: unknown }> = [], extra: Record<string, unknown> = {}) => ({
  type: 2, application_id: "345678901234567890", token: "private-token", guild_id: GUILD,
  member: { user: { id: discordId } },
  data: { name: "projet", options: [{ type: 1, name: sub, ...(options.length ? { options } : {}) }] },
  ...extra,
});
const str = (name: string, value: string) => ({ name, type: 3, value });
async function finish(output: ReturnType<typeof handleSignedProjectCommand>) {
  expect(output.body).toEqual({ type: 5, data: { flags: 64 } });
  expect(mocks.edit).not.toHaveBeenCalled();
  await output.runTeam?.();
  return mocks.edit.mock.calls.at(-1)?.[0].content as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  discordId = `23456789012${String(++seq).padStart(7, "0")}`;
  vi.stubEnv("DISCORD_PROJECT_COMMAND_ENABLED", "true");
  vi.stubEnv("DISCORD_PROJECT_WRITE_ENABLED", "true");
  mocks.context.mockResolvedValue({ ok: true, userId: "user-1", communityId: "community-1" });
  mocks.list.mockResolvedValue([team()]);
  mocks.edit.mockResolvedValue({ ok: true, data: { messageId: "m" } });
  mocks.queueEnabled.mockReturnValue(true);
  mocks.link.mockResolvedValue({ status: "unlinked" });
  mocks.enqueue.mockResolvedValue("queued");
  mocks.count.mockResolvedValue(0);
});
afterEach(() => vi.unstubAllEnvs());

describe("/projet : verrous et validation", () => {
  it("est fermée par défaut et ne touche ni base ni Discord", () => {
    vi.stubEnv("DISCORD_PROJECT_COMMAND_ENABLED", "");
    const out = handleSignedProjectCommand(input("liste"));
    expect(JSON.stringify(out.body)).toContain("pas encore ouvert");
    expect(out.runTeam).toBeUndefined();
    expect(mocks.context).not.toHaveBeenCalled();
  });

  it("la lecture reste ouverte quand l'écriture est fermée, qui refuse créer/rejoindre/quitter/recrutement/espace", async () => {
    vi.stubEnv("DISCORD_PROJECT_WRITE_ENABLED", "");
    for (const sub of ["creer", "rejoindre", "quitter", "recrutement", "espace"]) {
      const out = handleSignedProjectCommand(input(sub, [str("projet", "x")]));
      expect(out.runTeam, sub).toBeUndefined();
      expect(JSON.stringify(out.body)).toContain("pas encore ouvert");
    }
    expect(await finish(handleSignedProjectCommand(input("liste")))).toContain("Projets qui recrutent");
  });

  it.each([
    ["hors serveur", { guild_id: undefined }],
    ["nom de commande", { data: { name: "equipe", options: [{ type: 1, name: "liste" }] } }],
    ["sous-commande inconnue", { data: { name: "projet", options: [{ type: 1, name: "supprimer" }] } }],
    ["deux sous-commandes", { data: { name: "projet", options: [{ type: 1, name: "liste" }, { type: 1, name: "voir" }] } }],
    ["bot", { member: { user: { id: "234567890123456789", bot: true } } }],
  ])("rejette une charge invalide : %s", (_label, extra) => {
    const out = handleSignedProjectCommand(input("liste", [], extra));
    expect(out.runTeam).toBeUndefined();
    expect(out.body).toMatchObject({ type: 4, data: { flags: 64, allowed_mentions: { parse: [] } } });
  });

  it("limite le débit par personne", () => {
    const results = Array.from({ length: 6 }, () => handleSignedProjectCommand(input("liste")).runTeam !== undefined);
    expect(results).toEqual([true, true, true, true, true, false]);
  });
});

describe("/projet : lecture", () => {
  it("liste uniquement les projets ouverts avec des places", async () => {
    mocks.list.mockResolvedValue([team(), team({ id: "full", name: "Pleine", _count: { members: 6 } }), team({ id: "closed", name: "Fermée", isRecruiting: false })]);
    const content = await finish(handleSignedProjectCommand(input("liste")));
    expect(content).toContain("Aventure Minecraft");
    expect(content).not.toContain("Pleine");
    expect(content).not.toContain("Fermée");
  });

  it("affiche un projet par identifiant ou par nom exact, jamais par ressemblance ou homonymie", async () => {
    expect(await finish(handleSignedProjectCommand(input("voir", [str("projet", "team-1")])))).toContain("Capitaine : Maxime");
    mocks.edit.mockClear();
    expect(await finish(handleSignedProjectCommand(input("voir", [str("projet", "aventure minecraft")])))).toContain("Objectif : Serveur coop");
    mocks.list.mockResolvedValue([team(), team({ id: "team-2" })]);
    mocks.edit.mockClear();
    expect(await finish(handleSignedProjectCommand(input("voir", [str("projet", "Aventure Minecraft")])))).toContain("introuvable ou nom ambigu");
    mocks.edit.mockClear();
    expect(await finish(handleSignedProjectCommand(input("voir", [str("projet", "Aventure")])))).toContain("introuvable ou nom ambigu");
  });

  it("relaie le refus du contexte commun (compte non lié, autre serveur)", async () => {
    mocks.context.mockResolvedValue({ ok: false, message: "Sélectionne ce serveur dans GameNight avant d’utiliser cette commande." });
    expect(await finish(handleSignedProjectCommand(input("liste")))).toContain("Sélectionne ce serveur");
    expect(mocks.list).not.toHaveBeenCalled();
  });
});

describe("/projet : écriture via les services de main", () => {
  it("rejoindre : service #370 puis file d'espace (jamais d'appel Discord direct)", async () => {
    mocks.join.mockResolvedValue("joined");
    expect(await finish(handleSignedProjectCommand(input("rejoindre", [str("projet", "team-1")])))).toContain("Tu as rejoint");
    expect(mocks.join).toHaveBeenCalledWith("user-1", "community-1", "team-1");
    expect(mocks.memberSync).toHaveBeenCalledWith({ communityId: "community-1", teamId: "team-1", discordId });
    for (const [result, text] of [["cooldown", "délai"], ["already_team", "déjà partie"], ["full", "complet"], ["closed", "ne recrute pas"]] as const) {
      mocks.join.mockResolvedValue(result);
      mocks.memberSync.mockClear();
      mocks.edit.mockClear();
      expect(await finish(handleSignedProjectCommand(input("rejoindre", [str("projet", "team-1")])))).toContain(text);
      expect(mocks.memberSync).not.toHaveBeenCalled();
    }
  });

  it("quitter : synchronise l'accès seulement si le départ a eu lieu ; seul = dissolution sur le site", async () => {
    mocks.leave.mockResolvedValue("left");
    expect(await finish(handleSignedProjectCommand(input("quitter", [str("projet", "team-1")])))).toContain("7 jours");
    expect(mocks.memberSync).toHaveBeenCalledTimes(1);
    mocks.leave.mockResolvedValue("leader");
    mocks.edit.mockClear();
    expect(await finish(handleSignedProjectCommand(input("quitter", [str("projet", "team-1")])))).toContain("/equipes/gestion");
    expect(mocks.memberSync).toHaveBeenCalledTimes(1);
  });

  it("creer : règles 2 à 8 places de main, jeu résolu, service de création unique", async () => {
    const options = (places: number) => [
      str("nom", "Expédition"), str("jeu", "Valheim"), str("objectif", "Construire et explorer ensemble."), str("plateforme", "PC"),
      { name: "places", type: 4, value: places },
    ];
    mocks.game.mockResolvedValue({ kind: "FOUND", id: "game-1", name: "Valheim" });
    mocks.create.mockResolvedValue("created");
    expect(await finish(handleSignedProjectCommand(input("creer", options(4))))).toContain("Projet créé");
    expect(mocks.create).toHaveBeenCalledWith({
      userId: "user-1", communityId: "community-1", gameId: "game-1", name: "Expédition",
      description: "Construire et explorer ensemble.", platform: "PC", maxMembers: 4,
    });
    // Option A : la création du projet demande immédiatement les deux salons permanents.
    expect(mocks.provisionForCreator).toHaveBeenCalledWith({ communityId: "community-1", userId: "user-1" });
    mocks.create.mockClear();
    mocks.edit.mockClear();
    expect(await finish(handleSignedProjectCommand(input("creer", options(20))))).toContain("2 à 8 places");
    expect(mocks.create).not.toHaveBeenCalled();
    mocks.edit.mockClear();
    mocks.game.mockResolvedValue({ kind: "AMBIGUOUS", names: ["Valheim", "Valheim 2"] });
    expect(await finish(handleSignedProjectCommand(input("creer", options(4))))).toContain("Plusieurs jeux");
    mocks.edit.mockClear();
    mocks.game.mockResolvedValue({ kind: "FOUND", id: "game-1", name: "Valheim" });
    mocks.create.mockResolvedValue("cooldown");
    expect(await finish(handleSignedProjectCommand(input("creer", options(4))))).toContain("délai");
  });

  it("recrutement : booléen obligatoire, capitaine seul (service de main)", async () => {
    mocks.recruit.mockResolvedValue("saved");
    expect(await finish(handleSignedProjectCommand(input("recrutement", [str("projet", "team-1"), { name: "ouvert", type: 5, value: false }])))).toContain("ne recrute plus");
    expect(mocks.recruit).toHaveBeenCalledWith("user-1", "community-1", "team-1", false);
    mocks.edit.mockClear();
    expect(await finish(handleSignedProjectCommand(input("recrutement", [str("projet", "team-1")])))).toContain("Indique `ouvert`");
    mocks.recruit.mockResolvedValue("missing");
    mocks.edit.mockClear();
    expect(await finish(handleSignedProjectCommand(input("recrutement", [str("projet", "team-1"), { name: "ouvert", type: 5, value: true }])))).toContain("Seul le capitaine");
  });
});

describe("/projet espace : demande en file, jamais en direct", () => {
  const run = () => finish(handleSignedProjectCommand(input("espace", [str("projet", "team-1")])));

  it("le capitaine enfile une création, ou une vérification si les deux salons existent", async () => {
    expect(await run()).toContain("n’est créé en direct");
    expect(mocks.enqueue).toHaveBeenCalledWith({ teamId: "team-1", communityId: "community-1", intent: "provision" });
    // Lien complet (texte + vocal) : on vérifie, on ne recrée pas.
    mocks.link.mockResolvedValue({ status: "linked", channelId: "c", voiceChannelId: "v", roleId: "r", archived: false });
    mocks.edit.mockClear();
    expect(await run()).toContain("salons privés (texte et vocal) sont associés");
    expect(mocks.enqueue).toHaveBeenLastCalledWith({ teamId: "team-1", communityId: "community-1", intent: "reconcile" });
    // Lien antérieur à l’option A : le vocal manquant est créé par le provisionnement.
    mocks.enqueue.mockClear();
    mocks.link.mockResolvedValue({ status: "linked", channelId: "c", voiceChannelId: null, roleId: "r", archived: false });
    mocks.edit.mockClear();
    expect(await run()).toContain("salon vocal privé permanent");
    expect(mocks.enqueue).toHaveBeenLastCalledWith({ teamId: "team-1", communityId: "community-1", intent: "provision" });
  });

  it("refuse explicitement quand le quota d’espaces de la communauté est atteint", async () => {
    mocks.count.mockResolvedValue(5);
    expect(await run()).toContain("Capacité des espaces Discord atteinte");
    expect(mocks.enqueue).not.toHaveBeenCalled();
    mocks.count.mockResolvedValue(4);
    mocks.edit.mockClear();
    expect(await run()).toContain("Demande enregistrée");
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
  });

  it("respecte le capitaine passé (captainId prime sur createdById) et refuse un simple membre", async () => {
    mocks.list.mockResolvedValue([team({ captainId: "user-2" })]);
    expect(await run()).toContain("Seul le capitaine");
    expect(mocks.enqueue).not.toHaveBeenCalled();
    mocks.list.mockResolvedValue([team({ createdById: "user-9", captainId: "user-1" })]);
    mocks.edit.mockClear();
    expect(await run()).toContain("n’est créé en direct");
  });

  it("reste fermé sans verrou de file ou sans migration", async () => {
    mocks.queueEnabled.mockReturnValue(false);
    expect(await run()).toContain("pas encore ouvert");
    mocks.queueEnabled.mockReturnValue(true);
    mocks.link.mockResolvedValue({ status: "migration_required" });
    mocks.edit.mockClear();
    expect(await run()).toContain("non migrée");
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});
