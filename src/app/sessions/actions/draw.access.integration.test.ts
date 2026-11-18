import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Isolation multi-communautés — tirage au sort du jeu d'une soirée. Le créateur
 * d'une soirée dont la Membership ACTIVE a pris fin (REMOVED/LEFT), ou qui n'est
 * membre actif que d'une AUTRE communauté, ne doit plus pouvoir tirer au sort :
 * « créateur » ne suffit pas, il faut aussi un accès actif à la communauté de la
 * soirée. Sans proposition jouable, un tirage autorisé répond « no_eligible_game »
 * (sans écriture) ; un tirage refusé répond « error ».
 *
 * Nécessite `TEST_DATABASE_URL` (Postgres jetable) — suite SKIPPÉE sinon.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("next/navigation", () => ({
  redirect: vi.fn((location: string) => {
    throw new Error(`REDIRECT:${location}`);
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(() => true) }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn(
    "[draw.access.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE. " +
      "L'accès des créateurs retirés au tirage au sort n'est PAS validé."
  );
}

describe.skipIf(!TEST_DATABASE_URL)("tirage au sort — accès à la communauté de la soirée (intégration Postgres isolée)", () => {
  let db: import("@prisma/client").PrismaClient;
  let currentUser: ReturnType<typeof vi.fn>;
  let action: typeof import("./draw").drawSessionGameAction;
  let initial: typeof import("./draw-types").INITIAL_DRAW_STATE;
  let counter = 0;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as import("@prisma/client").PrismaClient;
    currentUser = vi.fn();
    vi.doMock("@/lib/current-user", () => ({ getCurrentUser: currentUser }));
    action = (await import("./draw")).drawSessionGameAction;
    initial = (await import("./draw-types")).INITIAL_DRAW_STATE;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(`TRUNCATE "Session", "Membership", "Community", "User" CASCADE`);
    vi.clearAllMocks();
  });

  const makeUser = (name: string) =>
    db.user.create({ data: { discordId: `${name}-${++counter}`, discordName: name, color: "#ffffff" } });

  async function fixture(creatorStatus: "ACTIVE" | "REMOVED" | "LEFT") {
    const community = await db.community.create({ data: { slug: "serveur-a", name: "Serveur A", status: "ACTIVE" } });
    const creator = await makeUser("createur");
    await db.membership.create({ data: { communityId: community.id, userId: creator.id, status: creatorStatus } });
    const session = await db.session.create({
      data: { createdById: creator.id, communityId: community.id, date: new Date(Date.now() + 7 * 86_400_000), status: "VOTING" },
    });
    currentUser.mockResolvedValue(creator);
    return { community, creator, session };
  }

  function form(sessionId: string): FormData {
    const fd = new FormData();
    fd.set("sessionId", sessionId);
    return fd;
  }

  it("témoin : un créateur à Membership ACTIVE atteint le tirage (aucune proposition jouable)", async () => {
    const { session } = await fixture("ACTIVE");
    expect(await action(initial, form(session.id))).toEqual({ status: "no_eligible_game" });
  });

  for (const status of ["REMOVED", "LEFT"] as const) {
    it(`un créateur ${status} ne peut plus tirer au sort le jeu de sa soirée`, async () => {
      const { session } = await fixture(status);
      expect(await action(initial, form(session.id))).toEqual({ status: "error" });
      expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).status).toBe("VOTING");
    });
  }

  it("un créateur membre actif d'une AUTRE communauté seulement ne peut pas tirer au sort", async () => {
    const { creator, session } = await fixture("REMOVED");
    const other = await db.community.create({ data: { slug: "serveur-b", name: "Serveur B", status: "ACTIVE" } });
    await db.membership.create({ data: { communityId: other.id, userId: creator.id, status: "ACTIVE" } });
    expect(await action(initial, form(session.id))).toEqual({ status: "error" });
  });

  it("un membre actif qui n'est pas le créateur reste refusé (inchangé)", async () => {
    const { community, session } = await fixture("ACTIVE");
    const member = await makeUser("membre");
    await db.membership.create({ data: { communityId: community.id, userId: member.id, status: "ACTIVE" } });
    currentUser.mockResolvedValue(member);
    expect(await action(initial, form(session.id))).toEqual({ status: "error" });
  });
});
