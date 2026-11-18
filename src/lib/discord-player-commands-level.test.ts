import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  community: vi.fn(), user: vi.fn(), membership: vi.fn(), communityId: vi.fn(),
  list: vi.fn(), game: vi.fn(), edit: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({
  prisma: { community: { findFirst: mocks.community }, user: { findUnique: mocks.user }, membership: { findUnique: mocks.membership } },
}));
vi.mock("@/lib/player-classifieds", () => ({ getPlayerClassifiedCommunityId: mocks.communityId }));
vi.mock("@/lib/rate-limit", () => ({ RATE_LIMIT_MESSAGE: "Trop de tentatives, réessaie plus tard." }));
vi.mock("@/lib/player-listings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/player-listings")>();
  return { ...actual, listCommunityListings: mocks.list, listOwnListings: vi.fn(), createPlayerListing: vi.fn(), deletePlayerListing: vi.fn() };
});
vi.mock("@/lib/discord-game-lookup", () => ({ resolveGameId: mocks.game }));
vi.mock("@/lib/discord-rest", () => ({ editSetupResponse: mocks.edit }));

import { handleSignedPlayerInteraction, renderListings } from "./discord-player-commands";

const APP = "100000000000000001";
const GUILD = "100000000000000002";
const DISCORD = "100000000000000004";
const listing = (over: Record<string, unknown> = {}) => ({
  id: "annonce-1", game: "Valheim", message: "Cherche deux joueurs", authorName: "Maxime", authorId: "user-1",
  createdAt: new Date(Date.now() - 3_600_000), expiresAt: new Date(Date.now() + 23 * 3_600_000), expired: false,
  ...over,
});
const payload = (options: Array<{ name: string; value?: string }>) => ({
  type: 2, id: DISCORD, application_id: APP, token: "simulated-token", guild_id: GUILD, member: { user: { id: DISCORD } },
  data: { name: "joueurs", options: [{ name: "chercher", options }] },
});
const now = () => String(Math.floor(Date.now() / 1000));
const run = async (options: Array<{ name: string; value?: string }>) => {
  await handleSignedPlayerInteraction(payload(options), now()).runPlayers!();
  return mocks.edit.mock.calls.at(-1)?.[0].content as string;
};

beforeEach(() => {
  vi.stubEnv("DISCORD_CLIENT_ID", APP);
  vi.stubEnv("DISCORD_PLAYER_COMMAND_ENABLED", "true");
  vi.stubEnv("GAME_LEVELS_ENABLED", "true");
  mocks.community.mockResolvedValue({ id: "community-1", name: "The Tower" });
  mocks.user.mockResolvedValue({ id: "user-1" });
  mocks.membership.mockResolvedValue({ status: "ACTIVE" });
  mocks.communityId.mockResolvedValue("community-1");
  mocks.list.mockResolvedValue([listing({ authorLevel: "AVANCE" })]);
  mocks.game.mockResolvedValue({ kind: "FOUND", id: "game-1", name: "Valheim" });
  mocks.edit.mockResolvedValue({ ok: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe("/joueurs chercher niveau:", () => {
  it("transmet jeu résolu + niveau minimum au service partagé, avec tag niveau", async () => {
    const content = await run([{ name: "jeu", value: "Valheim" }, { name: "niveau", value: "AVANCE" }]);
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1", communityId: "community-1",
      filters: { gameId: "game-1", level: "AVANCE", levelMatch: "min" },
    }));
    expect(content).toContain("niveau Avancé");
  });

  it("refuse un niveau sans jeu, sans élargir la recherche", async () => {
    const content = await run([{ name: "niveau", value: "AVANCE" }]);
    expect(content).toContain("Précise le jeu");
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("refuse un niveau inconnu et un drapeau éteint", async () => {
    expect(await run([{ name: "jeu", value: "Valheim" }, { name: "niveau", value: "DIEU" }])).toContain("Niveau inconnu");
    vi.stubEnv("GAME_LEVELS_ENABLED", "false");
    expect(await run([{ name: "jeu", value: "Valheim" }, { name: "niveau", value: "AVANCE" }])).toContain("pas activés");
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("demande de préciser un jeu introuvable ou ambigu", async () => {
    mocks.game.mockResolvedValue({ kind: "NONE" });
    expect(await run([{ name: "jeu", value: "zzz" }, { name: "niveau", value: "AVANCE" }])).toContain("Jeu introuvable");
    mocks.game.mockResolvedValue({ kind: "AMBIGUOUS", names: ["Apex", "Apex 2"] });
    expect(await run([{ name: "jeu", value: "ap" }, { name: "niveau", value: "AVANCE" }])).toContain("Plusieurs jeux");
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("sans niveau, la recherche par jeu reste inchangée (aucun filtre transmis)", async () => {
    await run([{ name: "jeu", value: "valh" }]);
    expect(mocks.list).toHaveBeenCalledWith({ userId: "user-1", communityId: "community-1" });
    expect(mocks.game).not.toHaveBeenCalled();
  });
});

describe("rendu des annonces", () => {
  it("n'ajoute le tag que si le niveau est visible", () => {
    expect(renderListings([listing({ authorLevel: "EXPERT" })] as never, "Tower", false)).toContain("niveau Expert");
    expect(renderListings([listing({ authorLevel: null })] as never, "Tower", false)).not.toContain("niveau");
  });
});
