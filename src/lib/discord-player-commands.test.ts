import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  community: vi.fn(),
  user: vi.fn(),
  membership: vi.fn(),
  communityId: vi.fn(),
  list: vi.fn(),
  scoped: vi.fn(),
  rateLimit: vi.fn(),
  game: vi.fn(),
  edit: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({
  prisma: { community: { findFirst: mocks.community }, user: { findUnique: mocks.user }, membership: { findUnique: mocks.membership } },
}));
vi.mock("@/lib/player-classifieds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/player-classifieds")>();
  return {
    getPlayerClassifiedCommunityId: mocks.communityId,
    listPlayerClassifieds: mocks.list,
    playerClassifiedSchema: actual.playerClassifiedSchema,
    playerClassifiedExpiresAt: actual.playerClassifiedExpiresAt,
  };
});
vi.mock("@/lib/community-scoped-client", () => ({ getScopedPrisma: mocks.scoped }));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.rateLimit,
  RATE_LIMIT_MESSAGE: "Trop de tentatives, réessaie plus tard.",
}));
vi.mock("@/lib/discord-team-commands", () => ({ resolveGameId: mocks.game }));
vi.mock("@/lib/discord-rest", () => ({ editSetupResponse: mocks.edit }));
vi.mock("@/lib/wallclock", () => ({ wallClockNow: () => new Date("2026-11-17T10:00:00.000Z") }));

import { handleSignedPlayerInteraction, removeListing } from "./discord-player-commands";

const APP = "100000000000000001";
const GUILD = "100000000000000002";
const DISCORD = "100000000000000004";
const listing = {
  id: "annonce-1",
  message: "Cherche deux joueurs pour du coop",
  createdAt: new Date("2026-11-17T09:00:00.000Z"),
  expiresAt: new Date("2026-11-18T09:00:00.000Z"),
  game: { name: "Valheim" },
  createdBy: { id: "user-1", discordName: "Maxime", discordAvatar: null, color: null },
};

const payload = (subName: string, options: Array<{ name: string; value?: string | number }> = []) => ({
  type: 2,
  id: DISCORD,
  application_id: APP,
  token: "simulated-token",
  guild_id: GUILD,
  member: { user: { id: DISCORD } },
  data: { name: "joueurs", options: [{ name: subName, options }] },
});
const now = () => String(Math.floor(Date.now() / 1000));

const deferred = async (output: ReturnType<typeof handleSignedPlayerInteraction>) => {
  await output.runPlayers!();
  return mocks.edit.mock.calls.at(-1)?.[0].content as string;
};

beforeEach(() => {
  vi.stubEnv("DISCORD_CLIENT_ID", APP);
  vi.stubEnv("DISCORD_PLAYER_COMMAND_ENABLED", "true");
  vi.stubEnv("DISCORD_PLAYER_WRITE_ENABLED", "true");
  mocks.community.mockResolvedValue({ id: "community-1", name: "The Tower" });
  mocks.user.mockResolvedValue({ id: "user-1" });
  mocks.membership.mockResolvedValue({ status: "ACTIVE" });
  mocks.communityId.mockResolvedValue("community-1");
  mocks.list.mockResolvedValue([listing]);
  mocks.scoped.mockResolvedValue({
    game: { findUnique: vi.fn(async () => ({ id: "game-1" })) },
    playerClassified: { create: vi.fn(async () => ({})), findFirst: vi.fn(), deleteMany: vi.fn(async () => ({ count: 1 })) },
  });
  mocks.rateLimit.mockReturnValue(true);
  mocks.game.mockResolvedValue({ kind: "FOUND", id: "game-1", name: "Valheim" });
  mocks.edit.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe("/joueurs", () => {
  it("reste fermée par défaut", () => {
    vi.stubEnv("DISCORD_PLAYER_COMMAND_ENABLED", "");
    const output = handleSignedPlayerInteraction(payload("annonces"), now());
    expect(JSON.stringify(output.body)).toContain("pas encore ouverte");
    expect(output.runPlayers).toBeUndefined();
  });

  it("explique que publier est fermé quand l’écriture est fermée", () => {
    vi.stubEnv("DISCORD_PLAYER_WRITE_ENABLED", "");
    const output = handleSignedPlayerInteraction(payload("publier", [{ name: "jeu", value: "Valheim" }]), now());
    expect(JSON.stringify(output.body)).toContain("pas encore ouvert");
    expect(output.runPlayers).toBeUndefined();
  });

  it("affiche les annonces de la communauté et renvoie vers GameNight", async () => {
    const content = await deferred(handleSignedPlayerInteraction(payload("annonces"), now()));
    expect(content).toContain("Valheim");
    expect(content).toContain("/joueurs");
    expect(mocks.list).toHaveBeenCalledWith("user-1", "community-1", expect.any(Date));
  });

  it("filtre mes-annonces et la recherche par jeu", async () => {
    mocks.list.mockResolvedValue([listing, { ...listing, id: "annonce-2", game: { name: "Éco" }, createdBy: { ...listing.createdBy, id: "user-9" } }]);
    const mine = await deferred(handleSignedPlayerInteraction(payload("mes-annonces"), now()));
    expect(mine).toContain("Tes annonces");
    expect(mine).not.toContain("Éco");

    mocks.edit.mockClear();
    const search = await deferred(handleSignedPlayerInteraction(payload("chercher", [{ name: "jeu", value: "valh" }]), now()));
    expect(search).toContain("Valheim");
    expect(search).not.toContain("Éco");
  });

  it("publie avec le schéma partagé et une expiration à 24 h", async () => {
    const scoped = {
      game: { findUnique: vi.fn(async () => ({ id: "game-1" })) },
      playerClassified: { create: vi.fn(async () => ({})) },
    };
    mocks.scoped.mockResolvedValue(scoped);
    const content = await deferred(
      handleSignedPlayerInteraction(
        payload("publier", [{ name: "jeu", value: "Valheim" }, { name: "description", value: "Cherche deux joueurs" }]),
        now()
      )
    );
    expect(content).toContain("publiée");
    expect(scoped.playerClassified.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        communityId: "community-1",
        gameId: "game-1",
        createdById: "user-1",
        message: "Cherche deux joueurs",
        createdAt: new Date("2026-11-17T10:00:00.000Z"),
        expiresAt: new Date("2026-11-18T10:00:00.000Z"),
      }),
    });
  });

  it("refuse un jeu inconnu, une description vide et un excès de publications", async () => {
    mocks.game.mockResolvedValue({ kind: "NONE" });
    expect(await deferred(handleSignedPlayerInteraction(payload("publier", [{ name: "jeu", value: "zzz" }]), now()))).toContain("introuvable");

    mocks.game.mockResolvedValue({ kind: "FOUND", id: "game-1", name: "Valheim" });
    mocks.edit.mockClear();
    expect(
      await deferred(handleSignedPlayerInteraction(payload("publier", [{ name: "jeu", value: "Valheim" }]), now()))
    ).toContain("240 caractères");

    mocks.edit.mockClear();
    mocks.rateLimit.mockReturnValue(false);
    expect(
      await deferred(
        handleSignedPlayerInteraction(payload("publier", [{ name: "jeu", value: "Valheim" }, { name: "description", value: "du texte" }]), now())
      )
    ).toContain("Trop de tentatives");
  });

  it("ne laisse retirer que sa propre annonce", async () => {
    mocks.scoped.mockResolvedValue({
      playerClassified: {
        findFirst: vi.fn(async () => ({ id: "annonce-1", createdById: "user-9" })),
        deleteMany: vi.fn(),
      },
    });
    expect(await deferred(handleSignedPlayerInteraction(payload("retirer", [{ name: "annonce", value: "annonce-1" }]), now()))).toContain(
      "pas la tienne"
    );
    await expect(removeListing({ userId: "user-1", communityId: "community-1", listingId: "annonce-1" })).resolves.toBe("not_owner");
  });

  it("refuse un non-membre et un corps invalide", async () => {
    mocks.membership.mockResolvedValue({ status: "PENDING" });
    expect(await deferred(handleSignedPlayerInteraction(payload("annonces"), now()))).toContain("pas encore membre");
    expect(handleSignedPlayerInteraction({ type: 2 }, now()).status).toBe(400);
  });
});
