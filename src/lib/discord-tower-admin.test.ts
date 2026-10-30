import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  add: vi.fn(), deactivate: vi.fn(), importPack: vi.fn(), list: vi.fn(),
  importTeamPack: vi.fn(),
  edit: vi.fn(), error: vi.fn(),
}));
vi.mock("@/lib/tower-challenges", () => ({
  addSoloTowerChallengeDefinition: mocks.add,
  deactivateSoloTowerChallengeDefinition: mocks.deactivate,
  importSoloTowerChallengeStarterPack: mocks.importPack,
  importTeamTowerChallengeStarterPack: mocks.importTeamPack,
  listSoloTowerChallengeDefinitions: mocks.list,
}));
vi.mock("@/lib/discord-rest", () => ({ editSetupResponse: mocks.edit }));
vi.mock("@/lib/logger", () => ({ logger: { error: mocks.error } }));
import { handleSignedTowerAdminInteraction } from "./discord-tower-admin";

const app = "100000000000000001";
const guild = "100000000000000002";
const body = (permissions: string, guildId = guild) => ({
  type: 2,
  id: "100000000000000006",
  application_id: app,
  token: "simulation-token",
  guild_id: guildId,
  channel_id: "100000000000000003",
  member: { permissions, user: { id: "100000000000000004" } },
  data: { name: "tower-admin", options: [{ type: 1, name: "defis" }] },
});

beforeEach(() => {
  vi.stubEnv("DISCORD_CLIENT_ID", app);
  vi.stubEnv("TOWER_DISCORD_GUILD_ID", guild);
  for (const mock of Object.values(mocks)) mock.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("droits des commandes The Tower", () => {
  it.each(["0", "1", "2048"])("refuse les permissions Discord non administratives (%s)", permissions => {
    const response = handleSignedTowerAdminInteraction(body(permissions), String(Math.floor(Date.now() / 1000)));
    expect(response).toMatchObject({
      status: 200,
      body: {
        type: 4,
        data: {
          content: "Il faut la permission « Gérer le serveur » pour gérer le catalogue The Tower.",
          flags: 64,
          allowed_mentions: { parse: [] },
        },
      },
    });
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.deactivate).not.toHaveBeenCalled();
    expect(mocks.importPack).not.toHaveBeenCalled();
    expect(mocks.importTeamPack).not.toHaveBeenCalled();
  });

  it.each(["8", "32"])("accepte uniquement le bit administrateur ou Gérer le serveur (%s)", permissions => {
    const response = handleSignedTowerAdminInteraction(body(permissions), String(Math.floor(Date.now() / 1000)));
    expect(response).toMatchObject({ status: 200, body: { type: 5, data: { flags: 64 } } });
    expect(response.runTower).toBeTypeOf("function");
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it("rejette un autre serveur et un horodatage expiré", () => {
    const now = Date.now();
    expect(handleSignedTowerAdminInteraction(body("32", "100000000000000099"), String(Math.floor(now / 1000))).status).toBe(400);
    expect(handleSignedTowerAdminInteraction(body("32"), String(Math.floor((now - 301_000) / 1000))).status).toBe(400);
  });

  it("réutilise le catalogue d'équipe sans changer ses droits d'administration", async () => {
    const request = body("32");
    request.data.options[0].name = "importer-equipe";
    mocks.importTeamPack.mockResolvedValue({ status: "IMPORTED", added: 8, alreadyPresent: 0 });
    mocks.edit.mockResolvedValue({ ok: true });
    const response = handleSignedTowerAdminInteraction(request, String(Math.floor(Date.now() / 1000)));
    expect(response.status).toBe(200);
    await response.runTower?.();
    expect(mocks.importTeamPack).toHaveBeenCalledWith({ guildId: guild });
    expect(mocks.edit).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("Catalogue d'équipe prêt : 8") }));
  });
});
