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
    const defaultCommunityId = await (await import("@/lib/default-community")).getDefaultCommunityId();
    await db.community.update({ where: { id: defaultCommunityId }, data: { status: "ACTIVE" } });
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

  async function render(user: { id: string; xpTotal?: number }) {
    currentUserMock.mockResolvedValue(user);
    // `type` d'un élément React = composant (référence circulaire) : ignoré.
    return JSON.stringify(await Page(), (k, v) =>
      k === "type" && typeof v !== "string" ? undefined : v
    );
  }

  function xpEvolutionFrom(tree: unknown): { label: string; xp: number }[] | undefined {
    if (Array.isArray(tree) && tree.length === 30 && tree.every((item) =>
      item && typeof item === "object" && "label" in item && "xp" in item
    )) return tree as { label: string; xp: number }[];
    if (tree && typeof tree === "object") {
      for (const value of Object.values(tree)) {
        const data = xpEvolutionFrom(value);
        if (data) return data;
      }
    }
    return undefined;
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

  it("conserve les achats historiques dans la progression et ignore les dépenses du nouveau solde", async () => {
    const player = await makeUser("xp-history");
    const communityId = await (await import("@/lib/default-community")).getDefaultCommunityId();
    const day = (daysAgo: number) => {
      const date = new Date();
      date.setDate(date.getDate() - daysAgo);
      date.setHours(12, 0, 0, 0);
      return date;
    };
    const beforePurchase = day(6);
    const oldPurchase = day(5);
    const earned = day(3);
    const newPurchase = day(1);
    await db.xpEvent.createMany({ data: [
      { communityId, userId: player.id, reason: "SHOP_PURCHASE", sourceId: "legacy", amount: -100, createdAt: oldPurchase },
      { communityId, userId: player.id, reason: "SESSION_RESULT", sourceId: "earned", amount: 200, createdAt: earned },
      { communityId, userId: player.id, reason: "SHOP_BALANCE_PURCHASE", sourceId: "balance", amount: -50, createdAt: newPurchase },
    ] });
    const label = (date: Date) => String(date.getDate()).padStart(2, "0") + "/" + String(date.getMonth() + 1).padStart(2, "0");
    const evolution = xpEvolutionFrom(JSON.parse(await render({ ...player, xpTotal: 600 })));
    expect(evolution).toBeDefined();
    expect(evolution?.find((point) => point.label === label(beforePurchase))?.xp).toBe(500);
    expect(evolution?.find((point) => point.label === label(oldPurchase))?.xp).toBe(400);
    expect(evolution?.find((point) => point.label === label(earned))?.xp).toBe(600);
    expect(evolution?.find((point) => point.label === label(newPurchase))?.xp).toBe(600);
  });
});
