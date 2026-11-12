import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Isolation multi-communautés — gestion des invités d'une soirée. Le créateur
 * d'une soirée dont la Membership ACTIVE a pris fin (REMOVED/LEFT) ne doit plus
 * pouvoir inviter, retirer ni resynchroniser : « créateur » ne suffit pas, il
 * faut aussi un accès actif à la communauté de la soirée.
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
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn(
    "[invites.access.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE. " +
      "L'accès des créateurs retirés à la gestion des invités n'est PAS validé."
  );
}

describe.skipIf(!TEST_DATABASE_URL)("invites — créateur sans Membership ACTIVE (intégration Postgres isolée)", () => {
  let db: import("@prisma/client").PrismaClient;
  let currentUser: ReturnType<typeof vi.fn>;
  let actions: typeof import("./invites");
  let counter = 0;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as import("@prisma/client").PrismaClient;
    currentUser = vi.fn();
    vi.doMock("@/lib/current-user", () => ({ getCurrentUser: currentUser }));
    actions = await import("./invites");
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      `TRUNCATE "NotificationDelivery", "NotificationEvent", "SessionInvite", "Session", "Membership", "Community", "User" CASCADE`
    );
    vi.clearAllMocks();
  });

  const makeUser = (name: string) =>
    db.user.create({ data: { discordId: `${name}-${++counter}`, discordName: name, color: "#ffffff" } });

  async function fixture(creatorStatus: "ACTIVE" | "REMOVED" | "LEFT") {
    const community = await db.community.create({ data: { slug: "serveur-a", name: "Serveur A", status: "ACTIVE" } });
    const creator = await makeUser("createur");
    const guest = await makeUser("invite");
    await db.membership.create({ data: { communityId: community.id, userId: creator.id, status: creatorStatus } });
    await db.membership.create({ data: { communityId: community.id, userId: guest.id, status: "ACTIVE" } });
    const session = await db.session.create({
      data: { createdById: creator.id, communityId: community.id, date: new Date(Date.now() + 7 * 86_400_000), status: "VOTING" },
    });
    currentUser.mockResolvedValue(creator);
    return { community, creator, guest, session };
  }

  function form(sessionId: string, guestUserId: string): FormData {
    const fd = new FormData();
    fd.set("sessionId", sessionId);
    fd.set("guestUserId", guestUserId);
    return fd;
  }

  it("témoin : un créateur à Membership ACTIVE invite un membre de la communauté", async () => {
    const { session, guest } = await fixture("ACTIVE");
    await actions.addSessionInviteAction(form(session.id, guest.id));
    expect(await db.sessionInvite.count({ where: { sessionId: session.id, userId: guest.id, status: "ACTIVE" } })).toBe(1);
  });

  for (const status of ["REMOVED", "LEFT"] as const) {
    it(`un créateur ${status} ne peut plus inviter sur sa soirée`, async () => {
      const { session, guest } = await fixture(status);
      await actions.addSessionInviteAction(form(session.id, guest.id));
      expect(await db.sessionInvite.count({ where: { sessionId: session.id } })).toBe(0);
    });

    it(`un créateur ${status} ne peut plus révoquer une invitation de sa soirée`, async () => {
      const { session, guest, creator } = await fixture(status);
      await db.sessionInvite.create({ data: { sessionId: session.id, userId: guest.id, invitedById: creator.id, status: "ACTIVE" } });
      await actions.revokeSessionInviteAction(form(session.id, guest.id));
      expect(await db.sessionInvite.count({ where: { sessionId: session.id, status: "ACTIVE" } })).toBe(1);
    });
  }

  it("un créateur membre actif d'une AUTRE communauté seulement ne peut pas inviter sur cette soirée", async () => {
    const { creator, session, guest } = await fixture("REMOVED");
    const other = await db.community.create({ data: { slug: "serveur-b", name: "Serveur B", status: "ACTIVE" } });
    await db.membership.create({ data: { communityId: other.id, userId: creator.id, status: "ACTIVE" } });
    await actions.addSessionInviteAction(form(session.id, guest.id));
    expect(await db.sessionInvite.count({ where: { sessionId: session.id } })).toBe(0);
  });
});
