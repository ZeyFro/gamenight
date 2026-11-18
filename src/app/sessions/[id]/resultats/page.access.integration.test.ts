import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Isolation multi-communautés — page de saisie des résultats : réservée au
 * créateur, mais seulement tant qu'il garde une Membership ACTIVE dans la
 * communauté de la soirée (sinon la liste des participants de ce serveur lui
 * resterait lisible après son retrait).
 *
 * Nécessite `TEST_DATABASE_URL` (Postgres jetable) — suite SKIPPÉE sinon.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("next/navigation", () => ({
  redirect: vi.fn((location: string) => {
    throw new Error(`REDIRECT:${location}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn(
    "[resultats page.access.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE. " +
      "L'accès d'un créateur retiré à la page des résultats n'est PAS validé."
  );
}

describe.skipIf(!TEST_DATABASE_URL)("/sessions/[id]/resultats — créateur sans Membership ACTIVE (intégration Postgres isolée)", () => {
  let db: import("@prisma/client").PrismaClient;
  let currentUser: ReturnType<typeof vi.fn>;
  let Page: typeof import("./page").default;
  let counter = 0;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as import("@prisma/client").PrismaClient;
    currentUser = vi.fn();
    vi.doMock("@/lib/current-user", () => ({ getCurrentUser: currentUser }));
    Page = (await import("./page")).default;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      `TRUNCATE "Proposal", "Session", "Membership", "Community", "Game", "User" CASCADE`
    );
    vi.clearAllMocks();
  });

  async function fixture(creatorStatus: "ACTIVE" | "REMOVED") {
    const community = await db.community.create({ data: { slug: "serveur-a", name: "Serveur A", status: "ACTIVE" } });
    const creator = await db.user.create({ data: { discordId: `createur-${++counter}`, discordName: "createur", color: "#ffffff" } });
    await db.membership.create({ data: { communityId: community.id, userId: creator.id, status: creatorStatus } });
    const game = await db.game.create({ data: { name: "Jeu", source: "MANUAL", minPlayers: 2, addedById: creator.id } });
    const session = await db.session.create({
      data: { createdById: creator.id, communityId: community.id, date: new Date(Date.now() - 86_400_000), status: "DONE", decidedGameId: game.id },
    });
    currentUser.mockResolvedValue(creator);
    return session;
  }

  it("témoin : le créateur à Membership ACTIVE accède à la page", async () => {
    const session = await fixture("ACTIVE");
    await expect(Page({ params: Promise.resolve({ id: session.id }) })).resolves.toBeTruthy();
  });

  it("un créateur REMOVED n'accède plus à la page des résultats (404)", async () => {
    const session = await fixture("REMOVED");
    await expect(Page({ params: Promise.resolve({ id: session.id }) })).rejects.toThrow("NOT_FOUND");
  });

  it("un créateur membre actif d'une AUTRE communauté seulement n'accède pas à la page (404)", async () => {
    const session = await fixture("REMOVED");
    const other = await db.community.create({ data: { slug: "serveur-b", name: "Serveur B", status: "ACTIVE" } });
    await db.membership.create({ data: { communityId: other.id, userId: session.createdById, status: "ACTIVE" } });
    await expect(Page({ params: Promise.resolve({ id: session.id }) })).rejects.toThrow("NOT_FOUND");
  });
});
