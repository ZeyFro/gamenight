import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

if (!TEST_DATABASE_URL) console.warn("[proposal-availability] Postgres local absent : intégrations SKIPPÉES.");

describe.skipIf(!TEST_DATABASE_URL)("disponibilité des possesseurs limitée à la communauté active (Postgres local)", () => {
  let db: import("@prisma/client").PrismaClient;
  let getProposalAvailability: typeof import("./sessions")["getProposalAvailability"];
  let communityA: { id: string };
  let ownerA: { id: string; discordName: string };
  let serial = 0;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as typeof db;
    ({ getProposalAvailability } = await import("./sessions"));
  });
  afterAll(async () => { await db?.$disconnect(); });
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "Membership", "Community", "WeeklyAvailability", "UserGame", "Game", "User" CASCADE');
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    communityA = await db.community.create({ data: { slug: "availability-a", name: "A", status: "ACTIVE" } });
    const communityB = await db.community.create({ data: { slug: "availability-b", name: "B", status: "ACTIVE" } });
    const suspended = await db.community.create({ data: { slug: "availability-suspended", name: "Suspended", status: "SUSPENDED" } });
    const makeUser = (name: string) => db.user.create({ data: { discordId: `availability-${++serial}`, discordName: name } });
    ownerA = await makeUser("Membre A");
    const ownerB = await makeUser("Membre B");
    const removed = await makeUser("Ancien membre A");
    const suspendedMember = await makeUser("Membre serveur suspendu");
    await db.membership.createMany({ data: [
      { communityId: communityA.id, userId: ownerA.id, status: "ACTIVE" },
      { communityId: communityB.id, userId: ownerB.id, status: "ACTIVE" },
      { communityId: communityA.id, userId: removed.id, status: "REMOVED" },
      { communityId: suspended.id, userId: suspendedMember.id, status: "ACTIVE" },
    ] });
    const game = await db.game.create({ data: { name: "Coop", source: "MANUAL", addedById: ownerA.id, minPlayers: 2, maxPlayers: 4 } });
    await db.userGame.createMany({ data: [ownerA, ownerB, removed, suspendedMember].map(user => ({ userId: user.id, gameId: game.id })) });
    const day = new Date("2026-10-25T20:00:00.000Z");
    await db.weeklyAvailability.createMany({ data: [ownerA, ownerB, removed, suspendedMember].map(user => ({ userId: user.id, dayOfWeek: day.getUTCDay(), startTime: "19:00", endTime: "21:00" })) });
  }, 30_000);
  afterEach(() => vi.unstubAllEnvs());

  it("exclut les possesseurs hors communauté, retirés et de communauté suspendue", async () => {
    const game = await db.game.findFirstOrThrow({ where: { name: "Coop" }, select: { id: true, minPlayers: true, maxPlayers: true } });
    const availability = await getProposalAvailability(new Date("2026-10-25T20:00:00.000Z"), [game], communityA.id);
    expect(availability.get(game.id)?.owners.map(user => user.discordName)).toEqual([ownerA.discordName]);
    expect(availability.get(game.id)?.availableOwners.map(user => user.discordName)).toEqual([ownerA.discordName]);
    expect(availability.get(game.id)?.jouable).toBe(false);
  });

  it("conserve le comportement historique sans isolation et pour une soirée sans communauté", async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    const game = await db.game.findFirstOrThrow({ where: { name: "Coop" }, select: { id: true, minPlayers: true, maxPlayers: true } });
    const availability = await getProposalAvailability(new Date("2026-10-25T20:00:00.000Z"), [game], null);
    expect(availability.get(game.id)?.owners).toHaveLength(4);
    expect(availability.get(game.id)?.jouable).toBe(true);
  });
});
