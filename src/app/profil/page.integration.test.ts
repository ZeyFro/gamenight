import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sécurité (audit constat 5) — l'onglet « Aperçu » de /profil ne doit
 * afficher en « prochaine soirée » que les soirées accessibles à
 * l'utilisateur (créateur ou invité ACTIVE, `accessibleSessionWhere`).
 * Postgres réel requis : la garantie est celle de la requête SQL.
 *
 * Nécessite `TEST_DATABASE_URL` — suite SKIPPÉE si absente.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const { currentUserMock } = vi.hoisted(() => ({ currentUserMock: vi.fn() }));

vi.mock("@/lib/current-user", () => ({ getCurrentUser: currentUserMock }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) {
    return { prisma: {} as unknown };
  }
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn(
    "[profil/page.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE. " +
      "La non-fuite des soirées privées sur /profil N'EST PAS validée par cette exécution."
  );
}

describe.skipIf(!TEST_DATABASE_URL)("/profil — prochaine soirée (Postgres isolée)", () => {
  let db: import("@prisma/client").PrismaClient;
  let Page: typeof import("./page").default;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    Page = (await import("./page")).default;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await db.$executeRawUnsafe(
      `TRUNCATE "SessionInvite", "Vote", "Proposal", "Session", "Game", "User" CASCADE`
    );
  });

  async function makeUser(discordId: string) {
    const user = await db.user.create({ data: { discordId, discordName: discordId } });
    await db.membership.create({ data: {
      userId: user.id,
      communityId: await (await import("@/lib/default-community")).getDefaultCommunityId(),
      status: "ACTIVE",
    } });
    return user;
  }

  async function makeSession(creatorId: string) {
    return db.session.create({
      data: { date: new Date("2099-01-01T20:00:00.000Z"), createdById: creatorId },
    });
  }

  async function render(user: { id: string }) {
    currentUserMock.mockResolvedValue(user);
    // `type` d'un élément React = composant (référence circulaire) : ignoré.
    return JSON.stringify(await Page(), (k, v) =>
      k === "type" && typeof v !== "string" ? undefined : v
    );
  }

  it("un utilisateur non invité ne voit PAS la soirée privée d'un autre", async () => {
    const creator = await makeUser("creator");
    const stranger = await makeUser("stranger");
    const session = await makeSession(creator.id);

    expect(await render(stranger)).not.toContain(`/sessions/${session.id}`);
  });

  it("le créateur et un invité ACTIVE voient la soirée", async () => {
    const creator = await makeUser("creator");
    const guest = await makeUser("guest");
    const session = await makeSession(creator.id);
    await db.sessionInvite.create({
      data: { sessionId: session.id, userId: guest.id, invitedById: creator.id, status: "ACTIVE" },
    });

    expect(await render(creator)).toContain(`/sessions/${session.id}`);
    expect(await render(guest)).toContain(`/sessions/${session.id}`);
  });
});
