import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Roulette asynchrone : filtre « nombre de joueurs » (ROULETTE_PLAYER_FILTER_ENABLED) et veto avec relance
 * (VOTE_VETO_ENABLED), sur une vraie base Postgres. Suite SKIPPÉE sans `TEST_DATABASE_URL`.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : ({} as unknown) };
});
// Jamais de vraie notification Discord depuis un test.
vi.mock("@/lib/discord-roulette", () => ({
  announceRouletteCancelled: vi.fn(async () => undefined),
  announceRouletteReminder: vi.fn(async () => undefined),
  announceRouletteResult: vi.fn(async () => undefined),
  announceRouletteCreated: vi.fn(async () => undefined),
}));

if (!TEST_DATABASE_URL) {
  console.warn("[roulette.integration.test] TEST_DATABASE_URL absente - suite SKIPPÉE : filtre et veto de roulette NON validés sur Postgres.");
}

describe.skipIf(!TEST_DATABASE_URL)("roulette async (intégration Postgres)", () => {
  let db: import("@prisma/client").PrismaClient;
  let roulette: typeof import("./roulette");
  let n = 0;
  const uniq = (label: string) => `${label}-${++n}`;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    roulette = await import("./roulette");
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  afterEach(() => vi.unstubAllEnvs());

  let communityId: string;
  beforeEach(async () => {
    vi.unstubAllEnvs();
    await db.$executeRawUnsafe(
      `TRUNCATE "RouletteEntry", "Roulette", "SessionVeto", "Vote", "Proposal", "Session", "Game", "User", "Community" CASCADE`
    );
    (await import("./default-community")).resetDefaultCommunityIdCache();
    communityId = (await db.community.create({ data: { slug: "default", name: "default", status: "ACTIVE" } })).id;
  });

  const makeUser = () => {
    const id = uniq("user");
    return db.user.create({ data: { discordId: id, discordName: id } });
  };
  const makeGame = (userId: string, minPlayers: number | null, maxPlayers: number | null) =>
    db.game.create({ data: { name: uniq("jeu"), source: "MANUAL", minPlayers, maxPlayers, addedById: userId } });

  /** Roulette OPEN dans le futur ; chaque participant propose les 2 jeux donnés. */
  async function makeRoulette(proposals: { userId: string; gameIds: string[] }[]) {
    const r = await db.roulette.create({
      data: {
        createdById: proposals[0].userId,
        scheduledAt: new Date("2099-06-06T20:00:00Z"),
        deadline: new Date("2099-06-06T18:00:00Z"),
        notifiedUserIds: proposals.map((p) => p.userId),
      },
    });
    for (const p of proposals) {
      for (const gameId of p.gameIds) await db.rouletteEntry.create({ data: { rouletteId: r.id, userId: p.userId, gameId } });
    }
    return r;
  }

  async function resultGameOf(rouletteId: string) {
    return (await db.roulette.findUniqueOrThrow({ where: { id: rouletteId } })).resultGameId;
  }

  describe("filtre nombre de joueurs", () => {
    /** 3 participants ; seul `any` (sans min/max) accepte 3 joueurs. */
    async function scenario() {
      const [u1, u2, u3] = [await makeUser(), await makeUser(), await makeUser()];
      const duo = await makeGame(u1.id, 2, 2);
      const big = await makeGame(u1.id, 4, 6);
      const any = await makeGame(u1.id, null, null);
      const r = await makeRoulette([
        { userId: u1.id, gameIds: [duo.id, big.id] },
        { userId: u2.id, gameIds: [duo.id, big.id] },
        { userId: u3.id, gameIds: [duo.id, any.id] },
      ]);
      return { r, duo, big, any };
    }

    it("flag allumé : une seule entrée compatible est toujours tirée (aléa extrême)", async () => {
      vi.stubEnv("ROULETTE_PLAYER_FILTER_ENABLED", "true");
      for (const rng of [0, 0.999]) {
        const { r, any } = await scenario();
        const out = await roulette.spinRoulette(r.id, () => rng);
        expect(await resultGameOf(r.id)).toBe(any.id);
        expect(out).toEqual({ playerFilterFallback: false });
      }
    });

    it("flag allumé, aucune entrée compatible : repli sur toutes, signalé", async () => {
      vi.stubEnv("ROULETTE_PLAYER_FILTER_ENABLED", "true");
      const [u1, u2, u3] = [await makeUser(), await makeUser(), await makeUser()];
      const duo = await makeGame(u1.id, 2, 2);
      const big = await makeGame(u1.id, 4, 6);
      const r = await makeRoulette([
        { userId: u1.id, gameIds: [duo.id, big.id] },
        { userId: u2.id, gameIds: [duo.id, big.id] },
        { userId: u3.id, gameIds: [duo.id, big.id] },
      ]);
      const out = await roulette.spinRoulette(r.id, () => 0);
      expect([duo.id, big.id]).toContain(await resultGameOf(r.id));
      expect(out).toEqual({ playerFilterFallback: true });
    });

    it("flag éteint : comportement inchangé (jeux incompatibles tirables, aucun repli signalé)", async () => {
      const [u1, u2] = [await makeUser(), await makeUser()];
      const big = await makeGame(u1.id, 5, 6);
      const huge = await makeGame(u1.id, 7, 8);
      const r = await makeRoulette([
        { userId: u1.id, gameIds: [big.id, huge.id] },
        { userId: u2.id, gameIds: [big.id, huge.id] },
      ]);
      const out = await roulette.spinRoulette(r.id);
      expect([big.id, huge.id]).toContain(await resultGameOf(r.id));
      expect(out).toEqual({ playerFilterFallback: false });
    });
  });
});
