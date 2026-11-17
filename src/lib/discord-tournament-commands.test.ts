import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  community: vi.fn(),
  user: vi.fn(),
  membership: vi.fn(),
  tournamentFindMany: vi.fn(),
  tournamentFindFirst: vi.fn(),
  edit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    community: { findFirst: mocks.community },
    user: { findUnique: mocks.user },
    membership: { findUnique: mocks.membership },
    tournament: { findMany: mocks.tournamentFindMany, findFirst: mocks.tournamentFindFirst },
  },
}));
vi.mock("@/lib/discord-rest", () => ({ editSetupResponse: mocks.edit }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import {
  handleSignedTournamentInteraction,
  loadTournamentDetail,
  renderTournamentDetail,
  renderTournamentList,
  statusesForFilter,
  tournamentCommandEnabled,
  type TournamentView,
} from "./discord-tournament-commands";

const APP = "100000000000000001";
const GUILD = "100000000000000002";
const DISCORD = "100000000000000004";
const TOURNOI = "tournoi-1";

const view = (over: Partial<TournamentView> = {}): TournamentView => ({
  id: TOURNOI,
  name: "Coupe d’hiver",
  game: "Valheim",
  status: "REGISTRATION",
  statusLabel: "inscriptions ouvertes",
  format: "solo",
  players: 3,
  maxPlayers: 8,
  creatorName: "Maxime",
  championName: null,
  championTeamName: null,
  ...over,
});

const row = (over: Record<string, unknown> = {}) => ({
  id: TOURNOI,
  name: "Coupe d’hiver",
  status: "REGISTRATION",
  format: "INDIVIDUAL",
  maxPlayers: 8,
  game: { name: "Valheim" },
  createdBy: { discordName: "Maxime" },
  champion: null,
  championTeam: null,
  _count: { participants: 3 },
  ...over,
});

beforeEach(() => {
  vi.stubEnv("DISCORD_CLIENT_ID", APP);
  vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
  vi.stubEnv("DISCORD_TOURNAMENT_COMMAND_ENABLED", "true");
  mocks.community.mockResolvedValue({ id: "community-1", name: "The Tower" });
  mocks.user.mockResolvedValue({ id: "user-1" });
  mocks.membership.mockResolvedValue({ status: "ACTIVE" });
  mocks.tournamentFindMany.mockResolvedValue([row()]);
  mocks.tournamentFindFirst.mockResolvedValue(row());
  mocks.edit.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

const interaction = (subName: string, options: Array<{ name: string; value: string }> = []) => ({
  type: 2,
  id: "100000000000000080",
  application_id: APP,
  token: "token-tournoi",
  guild_id: GUILD,
  member: { user: { id: DISCORD, username: "maxime", bot: false } },
  data: {
    name: "tournoi",
    options: [{ name: subName, type: 1, options: options.map((option) => ({ ...option, type: 3 })) }],
  },
});
const now = () => String(Math.floor(Date.now() / 1000));

async function deferredContent(output: ReturnType<typeof handleSignedTournamentInteraction>): Promise<string> {
  await output.runTournament?.();
  const call = mocks.edit.mock.calls.at(-1) as unknown as [{ content: string }];
  return call[0].content;
}

describe("/tournoi — interrupteur et sécurité", () => {
  it("reste fermée par défaut", () => {
    vi.stubEnv("DISCORD_TOURNAMENT_COMMAND_ENABLED", "");
    expect(tournamentCommandEnabled()).toBe(false);
    const output = handleSignedTournamentInteraction(interaction("liste"), now());
    expect(JSON.stringify(output.body)).toContain("pas encore ouverte");
    expect(output.runTournament).toBeUndefined();
    expect(mocks.community).not.toHaveBeenCalled();
  });

  it("refuse un MP, un horodatage périmé et une autre application", () => {
    const base = interaction("liste");
    expect(JSON.stringify(handleSignedTournamentInteraction({ ...base, guild_id: undefined }, now()).body)).toContain(
      "dans le serveur"
    );
    expect(handleSignedTournamentInteraction(base, String(Math.floor(Date.now() / 1000) - 400)).status).toBe(400);
    expect(handleSignedTournamentInteraction({ ...base, application_id: "100000000000000099" }, now()).status).toBe(400);
  });

  it("ne montre rien à un non-membre", async () => {
    mocks.membership.mockResolvedValue({ status: "PENDING" });
    const content = await deferredContent(handleSignedTournamentInteraction(interaction("liste"), now()));
    expect(content).toContain("n’est pas encore membre");
    expect(mocks.tournamentFindMany).not.toHaveBeenCalled();
  });

  it("ne lit que les tournois de la communauté du serveur", async () => {
    await deferredContent(handleSignedTournamentInteraction(interaction("liste"), now()));
    expect(mocks.tournamentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ communityId: "community-1" }) })
    );
  });
});

describe("/tournoi — lecture seule", () => {
  it("liste les tournois à venir et en cours par défaut", async () => {
    const content = await deferredContent(handleSignedTournamentInteraction(interaction("liste"), now()));
    expect(content).toContain("Coupe d’hiver");
    expect(content).toContain("3/8");
    expect(content).toContain("Lecture seule");
  });

  it("traduit les filtres de statut sans en inventer", () => {
    expect(statusesForFilter("avenir")).toEqual(["REGISTRATION"]);
    expect(statusesForFilter("encours")).toEqual(["IN_PROGRESS"]);
    expect(statusesForFilter("termines")).toEqual(["DONE", "CANCELLED"]);
    expect(statusesForFilter("tous")).toHaveLength(4);
    expect(statusesForFilter("n’importe quoi")).toEqual(["REGISTRATION", "IN_PROGRESS"]);
  });

  it("affiche le vainqueur d’un tournoi terminé", async () => {
    mocks.tournamentFindFirst.mockResolvedValue(
      row({ status: "DONE", champion: { discordName: "Sarah" } })
    );
    const content = await deferredContent(
      handleSignedTournamentInteraction(interaction("voir", [{ name: "tournoi", value: TOURNOI }]), now())
    );
    expect(content).toContain("terminé");
    expect(content).toContain("Vainqueur : Sarah");
  });

  it("ne révèle pas un tournoi d’une autre communauté", async () => {
    mocks.tournamentFindFirst.mockResolvedValue(null);
    const content = await deferredContent(
      handleSignedTournamentInteraction(interaction("voir", [{ name: "tournoi", value: TOURNOI }]), now())
    );
    expect(content).toContain("Tournoi introuvable");
  });

  it("rend les états vides et les détails sans donnée privée", () => {
    expect(renderTournamentList([], "The Tower")).toContain("Aucun tournoi");
    const text = renderTournamentDetail(view({ status: "DONE", statusLabel: "terminé", championTeamName: "Paped" }));
    expect(text).toContain("Vainqueur : Paped");
    expect(text).not.toContain(DISCORD);
  });

  it("charge un détail filtré par communauté", async () => {
    const detail = await loadTournamentDetail({ communityId: "community-1", tournamentId: TOURNOI });
    expect(detail?.name).toBe("Coupe d’hiver");
    expect(mocks.tournamentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TOURNOI, communityId: "community-1" } })
    );
  });
});
