import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  join: vi.fn(),
  leave: vi.fn(),
  recruit: vi.fn(),
  load: vi.fn(),
  find: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  game: vi.fn(),
  edit: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/community-teams", () => ({
  createCommunityTeam: mocks.create,
  joinCommunityTeam: mocks.join,
  leaveCommunityTeam: mocks.leave,
  setCommunityTeamRecruitment: mocks.recruit,
}));
vi.mock("@/lib/discord-team-commands", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/discord-team-commands")>();
  return {
    loadCommunityTeams: mocks.load,
    findTeam: mocks.find,
    renderTeamList: mocks.list,
    renderTeamDetail: mocks.detail,
    resolveGameId: mocks.game,
    validateTeamCreationInput: actual.validateTeamCreationInput,
  };
});
vi.mock("@/lib/discord-rest", () => ({ editSetupResponse: mocks.edit }));

import { handleSignedProjectInteraction } from "./discord-project-commands";

const APP = "100000000000000001";
const GUILD = "100000000000000002";
const DISCORD = "100000000000000004";
const team = {
  id: "team-1",
  name: "Aventure Minecraft",
  game: "Minecraft",
  platform: "PC",
  description: "Serveur coop tranquille",
  isRecruiting: true,
  maxMembers: 8,
  membersCount: 3,
  captainId: "user-1",
  captainName: "Maxime",
  memberNames: ["Maxime"],
  memberIds: ["user-1"],
};

const payload = (subName: string, options: Array<{ name: string; value?: string | number | boolean }> = []) => ({
  type: 2,
  id: DISCORD,
  application_id: APP,
  token: "simulated-token",
  guild_id: GUILD,
  member: { user: { id: DISCORD } },
  data: { name: "projet", options: [{ name: subName, options }] },
});
const now = () => String(Math.floor(Date.now() / 1000));

const deferred = async (output: ReturnType<typeof handleSignedProjectInteraction>) => {
  await output.runProject!();
  return mocks.edit.mock.calls.at(-1)?.[0].content as string;
};

beforeEach(() => {
  vi.stubEnv("DISCORD_CLIENT_ID", APP);
  vi.stubEnv("DISCORD_PROJECT_COMMAND_ENABLED", "true");
  vi.stubEnv("DISCORD_PROJECT_WRITE_ENABLED", "true");
  mocks.load.mockResolvedValue({
    status: "TEAMS",
    userId: "user-1",
    communityId: "community-1",
    communityName: "The Tower",
    teams: [team],
  });
  mocks.find.mockReturnValue({ kind: "FOUND", team });
  mocks.list.mockReturnValue("🗂️ **Équipes de The Tower** — 1");
  mocks.detail.mockReturnValue("🛡️ **Aventure Minecraft**\nMinecraft · PC");
  mocks.game.mockResolvedValue({ kind: "FOUND", id: "game-1", name: "Minecraft" });
  mocks.create.mockResolvedValue("created");
  mocks.join.mockResolvedValue("joined");
  mocks.leave.mockResolvedValue("left");
  mocks.recruit.mockResolvedValue("saved");
  mocks.edit.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe("/projet", () => {
  it("reste fermée par défaut sans toucher aux données", () => {
    vi.stubEnv("DISCORD_PROJECT_COMMAND_ENABLED", "");
    const output = handleSignedProjectInteraction(payload("liste"), now());
    expect(JSON.stringify(output.body)).toContain("pas encore ouvert");
    expect(output.runProject).toBeUndefined();
  });

  it("ferme les écritures quand seul l’affichage est ouvert", () => {
    vi.stubEnv("DISCORD_PROJECT_WRITE_ENABLED", "");
    expect(JSON.stringify(handleSignedProjectInteraction(payload("rejoindre"), now()).body)).toContain("pas encore ouvert");
  });

  it("liste les projets qui recrutent, sur les mêmes équipes", async () => {
    const content = await deferred(handleSignedProjectInteraction(payload("liste"), now()));
    expect(content).toContain("🗂️");
    expect(mocks.list).toHaveBeenCalledWith([team], "The Tower");
  });

  it("crée via createCommunityTeam avec les places demandées", async () => {
    const content = await deferred(
      handleSignedProjectInteraction(
        payload("creer", [
          { name: "jeu", value: "Minecraft" },
          { name: "nom", value: "Aventure Minecraft" },
          { name: "objectif", value: "Serveur coop tranquille" },
          { name: "plateforme", value: "PC" },
          { name: "places", value: 8 },
        ]),
        now()
      )
    );
    expect(content).toContain("Projet créé");
    expect(mocks.create).toHaveBeenCalledWith({
      userId: "user-1",
      communityId: "community-1",
      gameId: "game-1",
      name: "Aventure Minecraft",
      description: "Serveur coop tranquille",
      platform: "PC",
      maxMembers: 8,
    });
  });

  it("refuse une création incomplète sans appeler le service", async () => {
    const content = await deferred(
      handleSignedProjectInteraction(payload("creer", [{ name: "jeu", value: "Minecraft" }, { name: "nom", value: "ab" }]), now())
    );
    expect(content).toContain("Projet invalide");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("traduit les refus d’adhésion du service", async () => {
    mocks.join.mockResolvedValue("full");
    expect(await deferred(handleSignedProjectInteraction(payload("rejoindre", [{ name: "projet", value: "team-1" }]), now()))).toContain(
      "complet"
    );
    mocks.edit.mockClear();
    mocks.find.mockReturnValue({ kind: "MISSING" });
    expect(await deferred(handleSignedProjectInteraction(payload("rejoindre", [{ name: "projet", value: "x" }]), now()))).toContain(
      "introuvable"
    );
    expect(mocks.join).toHaveBeenCalledTimes(1);
  });

  it("interdit au capitaine de quitter son projet par la commande", async () => {
    mocks.leave.mockResolvedValue("leader");
    expect(await deferred(handleSignedProjectInteraction(payload("quitter", [{ name: "projet", value: "team-1" }]), now()))).toContain(
      "capitaine"
    );
  });

  it("bascule le recrutement avec le service partagé", async () => {
    const content = await deferred(
      handleSignedProjectInteraction(payload("recrutement", [{ name: "projet", value: "team-1" }, { name: "ouvert", value: true }]), now())
    );
    expect(content).toContain("recrute");
    expect(mocks.recruit).toHaveBeenCalledWith("user-1", "community-1", "team-1", true);
  });

  it("refuse un non-membre et un corps invalide", async () => {
    mocks.load.mockResolvedValue({ status: "NOT_MEMBER" });
    expect(await deferred(handleSignedProjectInteraction(payload("liste"), now()))).toContain("pas encore membre");
    expect(handleSignedProjectInteraction({ type: 2, data: { name: "projet" } }, now()).status).toBe(400);
  });
});
