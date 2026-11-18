import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  listing: vi.fn(),
  membership: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.user },
    playerClassified: { findUnique: mocks.listing },
    membership: { findUnique: mocks.membership },
  },
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.rateLimit,
  RATE_LIMIT_MESSAGE: "Trop de tentatives, réessaie plus tard.",
}));

import { respondToListingInteraction } from "./discord-player-listing-rsvp";
import { parsePlayerListingComponent, playerListingComponents } from "./discord-player-listing-components";

const GUILD = "100000000000000002";
const DISCORD = "100000000000000004";
const origin = {
  interactionId: "100000000000000009",
  discordId: DISCORD,
  guildId: GUILD,
  channelId: "100000000000000010",
};

const listing = (over: Record<string, unknown> = {}) => ({
  id: "annonce-1",
  communityId: "community-1",
  createdById: "user-9",
  message: "Cherche deux joueurs",
  expiresAt: new Date(Date.now() + 3_600_000),
  game: { name: "Valheim" },
  createdBy: { discordId: "100000000000000099", discordName: "Alex" },
  community: { discordGuildId: GUILD, status: "ACTIVE" },
  ...over,
});

beforeEach(() => {
  mocks.user.mockResolvedValue({ id: "user-1", discordId: DISCORD });
  mocks.listing.mockResolvedValue(listing());
  mocks.membership.mockResolvedValue({ status: "ACTIVE" });
  mocks.rateLimit.mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe("composants d’annonce", () => {
  it("expose intérêt et contact, et un lien GameNight seulement si l’origine existe", () => {
    const rows = playerListingComponents({ listingId: "annonce-1" }, {} as unknown as NodeJS.ProcessEnv);
    expect(JSON.stringify(rows)).toContain("gn:listing:interest:annonce-1");
    expect(JSON.stringify(rows)).toContain("gn:listing:contact:annonce-1");
    expect(JSON.stringify(rows)).not.toContain("http");

    const withUrl = playerListingComponents(
      { listingId: "annonce-1" },
      { VERCEL_URL: "gamenight-preview.vercel.app" } as unknown as NodeJS.ProcessEnv
    );
    expect(JSON.stringify(withUrl)).toContain("https://gamenight-preview.vercel.app/joueurs");
  });

  it("n’ajoute pas de bouton mort pour une annonce expirée ou un identifiant invalide", () => {
    const expired = playerListingComponents(
      { listingId: "annonce-1", expired: true },
      { VERCEL_URL: "x.vercel.app" } as unknown as NodeJS.ProcessEnv
    );
    expect(JSON.stringify(expired)).not.toContain("http");
    expect(playerListingComponents({ listingId: "id avec espaces" })).toEqual([]);
  });

  it("parse uniquement les deux actions bornées", () => {
    expect(parsePlayerListingComponent("gn:listing:interest:annonce-1")).toEqual({
      kind: "interest",
      listingId: "annonce-1",
    });
    expect(parsePlayerListingComponent("gn:listing:contact:annonce-1")).toEqual({
      kind: "contact",
      listingId: "annonce-1",
    });
    expect(parsePlayerListingComponent("gn:listing:delete:annonce-1")).toBeNull();
    expect(parsePlayerListingComponent("gn:seat:join:s")).toBeNull();
  });
});

describe("réponse aux boutons d’annonce", () => {
  it("donne l’auteur au joueur intéressé sans prétendre enregistrer une candidature", async () => {
    const content = await respondToListingInteraction("interest", "annonce-1", origin);
    expect(content).toContain("<@100000000000000099>");
    expect(content).toContain("Aucune candidature n’est enregistrée");
  });

  it("renvoie la mention de l’auteur pour le contact", async () => {
    const content = await respondToListingInteraction("contact", "annonce-1", origin);
    expect(content).toContain("Alex");
    expect(content).toContain("<@100000000000000099>");
  });

  it("refuse une annonce retirée, expirée ou d’un autre serveur", async () => {
    mocks.listing.mockResolvedValue(null);
    expect(await respondToListingInteraction("interest", "annonce-1", origin)).toContain("retirée");

    mocks.listing.mockResolvedValue(listing({ expiresAt: new Date(Date.now() - 1_000) }));
    expect(await respondToListingInteraction("interest", "annonce-1", origin)).toContain("expiré");

    mocks.listing.mockResolvedValue(listing());
    expect(await respondToListingInteraction("interest", "annonce-1", { ...origin, guildId: "100000000000000003" })).toContain(
      "plus accessible"
    );
  });

  it("refuse un non-membre et un auteur qui clique sur sa propre annonce", async () => {
    mocks.membership.mockResolvedValue({ status: "PENDING" });
    expect(await respondToListingInteraction("interest", "annonce-1", origin)).toContain("Rejoins d’abord");

    mocks.membership.mockResolvedValue({ status: "ACTIVE" });
    mocks.listing.mockResolvedValue(listing({ createdById: "user-1" }));
    expect(await respondToListingInteraction("interest", "annonce-1", origin)).toContain("C’est ton annonce");
  });

  it("respecte la limite de débit et refuse un compte Discord inconnu", async () => {
    mocks.rateLimit.mockReturnValue(false);
    expect(await respondToListingInteraction("interest", "annonce-1", origin)).toContain("Trop de tentatives");

    mocks.rateLimit.mockReturnValue(true);
    mocks.user.mockResolvedValue(null);
    expect(await respondToListingInteraction("interest", "annonce-1", origin)).toContain("Connecte-toi");
  });

  it("refuse un identifiant d’annonce invalide", async () => {
    expect(await respondToListingInteraction("contact", "id avec espaces", origin)).toContain("plus accessible");
  });
});
