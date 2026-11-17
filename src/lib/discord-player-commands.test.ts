import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  community: vi.fn(),
  user: vi.fn(),
  membership: vi.fn(),
  communityId: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  mine: vi.fn(),
  game: vi.fn(),
  edit: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({
  prisma: { community: { findFirst: mocks.community }, user: { findUnique: mocks.user }, membership: { findUnique: mocks.membership } },
}));
vi.mock("@/lib/player-classifieds", () => ({ getPlayerClassifiedCommunityId: mocks.communityId }));
vi.mock("@/lib/rate-limit", () => ({
  RATE_LIMIT_MESSAGE: "Trop de tentatives, réessaie plus tard.",
}));
vi.mock("@/lib/player-listings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/player-listings")>();
  return {
    createPlayerListing: mocks.create,
    deletePlayerListing: mocks.remove,
    listCommunityListings: mocks.list,
    listOwnListings: mocks.mine,
    filterListings: actual.filterListings,
  };
});
vi.mock("@/lib/discord-team-commands", () => ({ resolveGameId: mocks.game }));
vi.mock("@/lib/discord-rest", () => ({ editSetupResponse: mocks.edit }));

import { handleSignedPlayerInteraction } from "./discord-player-commands";

const APP = "100000000000000001";
const GUILD = "100000000000000002";
const DISCORD = "100000000000000004";
const listing = (over: Record<string, unknown> = {}) => ({
  id: "annonce-1",
  game: "Valheim",
  message: "Cherche deux joueurs pour du coop",
  authorName: "Maxime",
  authorId: "user-1",
  createdAt: new Date("2026-11-17T08:00:00.000Z"),
  expiresAt: new Date("2026-11-18T08:00:00.000Z"),
  expired: false,
  ...over,
});

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
  mocks.list.mockResolvedValue([listing()]);
  mocks.mine.mockResolvedValue([listing(), listing({ id: "annonce-2", expired: true })]);
  mocks.create.mockResolvedValue({ status: "created", id: "annonce-3", expiresAt: new Date() });
  mocks.remove.mockResolvedValue("deleted");
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

  it("ferme l’écriture sans fermer la lecture", () => {
    vi.stubEnv("DISCORD_PLAYER_WRITE_ENABLED", "");
    expect(JSON.stringify(handleSignedPlayerInteraction(payload("publier"), now()).body)).toContain("pas encore ouvert");
    expect(handleSignedPlayerInteraction(payload("annonces"), now()).runPlayers).toBeDefined();
  });

  it("passe par le service partagé, sans logique d’écriture locale", async () => {
    const content = await deferred(
      handleSignedPlayerInteraction(
        payload("publier", [{ name: "jeu", value: "Valheim" }, { name: "description", value: "Cherche deux joueurs" }]),
        now()
      )
    );
    expect(content).toContain("publiée");
    expect(mocks.create).toHaveBeenCalledWith({
      userId: "user-1",
      communityId: "community-1",
      gameId: "game-1",
      message: "Cherche deux joueurs",
    });
  });

  it("annonce un doublon sans écrire deux fois", async () => {
    mocks.create.mockResolvedValue({ status: "duplicate", id: "annonce-1" });
    const content = await deferred(
      handleSignedPlayerInteraction(
        payload("publier", [{ name: "jeu", value: "Valheim" }, { name: "description", value: "Cherche deux joueurs" }]),
        now()
      )
    );
    expect(content).toContain("déjà publié");
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("traduit refus de limite, jeu inconnu et description invalide", async () => {
    mocks.create.mockResolvedValue({ status: "rate_limited" });
    expect(
      await deferred(
        handleSignedPlayerInteraction(payload("publier", [{ name: "jeu", value: "Valheim" }, { name: "description", value: "x" }]), now())
      )
    ).toContain("Trop de tentatives");

    mocks.edit.mockClear();
    mocks.game.mockResolvedValue({ kind: "NONE" });
    expect(await deferred(handleSignedPlayerInteraction(payload("publier", [{ name: "jeu", value: "zzz" }]), now()))).toContain(
      "introuvable"
    );

    mocks.edit.mockClear();
    mocks.game.mockResolvedValue({ kind: "FOUND", id: "game-1", name: "Valheim" });
    mocks.create.mockResolvedValue({ status: "invalid" });
    expect(
      await deferred(
        handleSignedPlayerInteraction(payload("publier", [{ name: "jeu", value: "Valheim" }, { name: "description", value: "x" }]), now())
      )
    ).toContain("240 caractères");
  });

  it("retire via le service et refuse l’annonce d’un autre", async () => {
    const removed = await deferred(handleSignedPlayerInteraction(payload("retirer", [{ name: "annonce", value: "annonce-1" }]), now()));
    expect(removed).toContain("Annonce retirée");
    expect(mocks.remove).toHaveBeenCalledWith({ userId: "user-1", communityId: "community-1", listingId: "annonce-1" });

    mocks.edit.mockClear();
    mocks.remove.mockResolvedValue("not_owner");
    expect(await deferred(handleSignedPlayerInteraction(payload("retirer", [{ name: "annonce", value: "annonce-9" }]), now()))).toContain(
      "pas la tienne"
    );
  });

  it("liste les annonces actives, et les siennes avec les expirées", async () => {
    const all = await deferred(handleSignedPlayerInteraction(payload("annonces"), now()));
    expect(all).toContain("Valheim");
    expect(mocks.list).toHaveBeenCalledWith({ userId: "user-1", communityId: "community-1" });

    mocks.edit.mockClear();
    const mine = await deferred(handleSignedPlayerInteraction(payload("mes-annonces"), now()));
    expect(mine).toContain("Tes annonces");
    expect(mine).toContain("expirée");
    expect(mocks.mine).toHaveBeenCalledWith({ userId: "user-1", communityId: "community-1" });
  });

  it("ajoute un lien GameNight seulement quand l’URL est déterminable", async () => {
    const without = await deferred(handleSignedPlayerInteraction(payload("annonces"), now()));
    expect(without).not.toContain("http");

    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "gamenight-preview.vercel.app");
    mocks.edit.mockClear();
    const withLink = await deferred(handleSignedPlayerInteraction(payload("annonces"), now()));
    expect(withLink).toContain("https://gamenight-preview.vercel.app/joueurs");
  });

  it("refuse un non-membre et un corps invalide", async () => {
    mocks.membership.mockResolvedValue({ status: "PENDING" });
    expect(await deferred(handleSignedPlayerInteraction(payload("annonces"), now()))).toContain("pas encore membre");
    expect(handleSignedPlayerInteraction({ type: 2 }, now()).status).toBe(400);
  });
});

describe("/joueurs — issues de désinscription", () => {
  it("traduit chaque refus de deletePlayerListing sans annoncer de suppression", async () => {
    const cases: Array<[string, string]> = [
      ["not_owner", "pas la tienne"],
      ["rate_limited", "Trop de tentatives"],
      ["missing", "introuvable ou déjà retirée"],
    ];
    vi.stubEnv("DISCORD_CLIENT_ID", APP);
    vi.stubEnv("DISCORD_PLAYER_COMMAND_ENABLED", "true");
    vi.stubEnv("DISCORD_PLAYER_WRITE_ENABLED", "true");
    mocks.community.mockResolvedValue({ id: "community-1", name: "The Tower" });
    mocks.user.mockResolvedValue({ id: "user-1" });
    mocks.membership.mockResolvedValue({ status: "ACTIVE" });
    mocks.communityId.mockResolvedValue("community-1");
    mocks.edit.mockResolvedValue({ ok: true });

    for (const [outcome, expected] of cases) {
      mocks.remove.mockResolvedValue(outcome);
      mocks.edit.mockClear();
      const content = await deferred(handleSignedPlayerInteraction(payload("retirer", [{ name: "annonce", value: "annonce-1" }]), now()));
      expect(content).toContain(expected);
      expect(content).not.toContain("Annonce retirée");
    }

    mocks.remove.mockResolvedValue("deleted");
    mocks.edit.mockClear();
    expect(await deferred(handleSignedPlayerInteraction(payload("retirer", [{ name: "annonce", value: "annonce-1" }]), now()))).toContain(
      "Annonce retirée"
    );
  });
});
