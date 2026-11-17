import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests de synchronisation Discord ↔ GameNight sur les annonces de joueurs.
 *
 * Les dépendances sont injectées : une base en mémoire remplace Prisma, et les
 * deux interfaces appellent **le même** service (`src/lib/player-listings.ts`).
 * Aucune base PostgreSQL jetable n'est nécessaire, aucune donnée réelle n'est
 * touchée.
 */
type Row = {
  id: string;
  communityId: string;
  gameId: string;
  createdById: string;
  message: string;
  createdAt: Date;
  expiresAt: Date;
  game: { name: string };
  createdBy: { id: string; discordName: string };
};

const mocks = vi.hoisted(() => ({
  rateLimit: vi.fn(),
  rows: [] as unknown[],
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock("@/lib/wallclock", () => ({ wallClockNow: () => new Date("2026-11-17T10:00:00.000Z") }));
vi.mock("@/lib/community-scoped-client", () => ({
  getScopedPrisma: async () => ({
    game: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === "game-1" ? { id: "game-1" } : null,
    },
    playerClassified: {
      create: async ({ data }: { data: Omit<Row, "id" | "game" | "createdBy"> }) => {
        const row: Row = {
          ...data,
          id: `annonce-${mocks.rows.length + 1}`,
          game: { name: "Valheim" },
          createdBy: { id: data.createdById, discordName: data.createdById === "user-1" ? "Maxime" : "Alex" },
        };
        mocks.rows.push(row);
        return { id: row.id, expiresAt: row.expiresAt };
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const rows = mocks.rows as Row[];
        const match = rows.find((row) => {
          if (where.id && row.id !== where.id) return false;
          if (where.communityId && row.communityId !== where.communityId) return false;
          if (where.createdById && row.createdById !== where.createdById) return false;
          if (where.gameId && row.gameId !== where.gameId) return false;
          if (where.message && row.message !== where.message) return false;
          const gt = (where.expiresAt as { gt?: Date } | undefined)?.gt;
          if (gt && row.expiresAt <= gt) return false;
          return true;
        });
        return match ? { id: match.id, createdById: match.createdById } : null;
      },
      findMany: async ({ where }: { where: { communityId: string; expiresAt?: { gt?: Date } } }) => {
        const rows = mocks.rows as Row[];
        const gt = where.expiresAt?.gt;
        return rows
          .filter((row) => row.communityId === where.communityId)
          .filter((row) => (gt ? row.expiresAt > gt : true))
          .map((row) => ({
            id: row.id,
            message: row.message,
            createdAt: row.createdAt,
            expiresAt: row.expiresAt,
            game: row.game,
            createdBy: { ...row.createdBy, discordAvatar: null, color: null },
          }));
      },
      deleteMany: async ({ where }: { where: { id: string } }) => {
        const rows = mocks.rows as Row[];
        const index = rows.findIndex((row) => row.id === where.id);
        if (index < 0) return { count: 0 };
        rows.splice(index, 1);
        return { count: 1 };
      },
    },
  }),
}));

import {
  createPlayerListing,
  deletePlayerListing,
  filterListings,
  listCommunityListings,
  listOwnListings,
} from "./player-listings";

const now = new Date("2026-11-17T10:00:00.000Z");
const discordInput = { userId: "user-1", communityId: "community-1", gameId: "game-1", message: "Cherche deux joueurs" };
// Après application du patch #408, l'action web transmet les champs étendus.
const webInput = { ...discordInput, message: "Guilde MMO recherche heals", extras: { platform: "PC" } };

beforeEach(() => {
  mocks.rows = [];
  mocks.rateLimit.mockReturnValue(true);
});

afterEach(() => {
  for (const mock of Object.values(mocks)) if (typeof mock === "function") mock.mockReset();
});

describe("synchronisation des annonces de joueurs", () => {
  it("une annonce créée depuis Discord est visible dans GameNight", async () => {
    const created = await createPlayerListing({ ...discordInput, now });
    expect(created.status).toBe("created");
    const listings = await listCommunityListings({ userId: "user-9", communityId: "community-1", now });
    expect(listings.map((listing) => listing.message)).toContain("Cherche deux joueurs");
  });

  it("une annonce créée par GameNight est visible depuis Discord", async () => {
    await createPlayerListing({ ...webInput, now });
    const listings = await listCommunityListings({ userId: "user-1", communityId: "community-1", now });
    expect(listings.map((listing) => listing.message)).toEqual(["Guilde MMO recherche heals"]);
  });

  it("un retrait est visible des deux côtés", async () => {
    const created = await createPlayerListing({ ...discordInput, now });
    expect(created.status).toBe("created");
    const id = created.status === "created" ? created.id : "";
    await expect(deletePlayerListing({ userId: "user-1", communityId: "community-1", listingId: id })).resolves.toBe("deleted");
    expect(await listCommunityListings({ userId: "user-1", communityId: "community-1", now })).toEqual([]);
    expect(await listOwnListings({ userId: "user-1", communityId: "community-1", now })).toEqual([]);
  });

  it("un joueur ne peut pas retirer l’annonce d’un autre", async () => {
    await createPlayerListing({ ...discordInput, now });
    const [listing] = await listCommunityListings({ userId: "user-9", communityId: "community-1", now });
    await expect(deletePlayerListing({ userId: "user-9", communityId: "community-1", listingId: listing.id })).resolves.toBe(
      "not_owner"
    );
    expect(await listCommunityListings({ userId: "user-1", communityId: "community-1", now })).toHaveLength(1);
  });

  it("durée de vie et anti-doublon sont identiques pour les deux interfaces", async () => {
    const first = await createPlayerListing({ ...discordInput, now });
    expect(first.status).toBe("created");
    if (first.status === "created") {
      expect(first.expiresAt.getTime() - now.getTime()).toBe(24 * 60 * 60 * 1000);
    }
    const replay = await createPlayerListing({ ...discordInput, now });
    expect(replay.status).toBe("duplicate");
    expect(mocks.rows).toHaveLength(1);
  });

  it("identifie les annonces expirées sans les montrer comme actives", async () => {
    const created = await createPlayerListing({ ...discordInput, now });
    expect(created.status).toBe("created");
    const later = new Date(now.getTime() + 25 * 60 * 60 * 1000);
    expect(await listCommunityListings({ userId: "user-1", communityId: "community-1", now: later })).toEqual([]);
    const own = await listOwnListings({ userId: "user-1", communityId: "community-1", now: later });
    expect(own).toHaveLength(1);
    expect(own[0].expired).toBe(true);
    expect(filterListings(own, { includeExpired: false, now: later })).toEqual([]);
  });

  it("refuse une création sans jeu valide ou au-delà de la limite", async () => {
    await expect(
      createPlayerListing({ ...discordInput, gameId: "game-999", now })
    ).resolves.toEqual({ status: "game_not_found" });
    mocks.rateLimit.mockReturnValue(false);
    await expect(createPlayerListing({ ...discordInput, now })).resolves.toEqual({ status: "rate_limited" });
    expect(mocks.rows).toHaveLength(0);
  });
});
