import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
vi.mock("@/lib/discord-level-up", () => ({ announceLevelUp: vi.fn(async () => undefined) }));

if (!TEST_DATABASE_URL) console.warn("[backfill-xp-caps] Postgres absent : test SKIPPÉ.");
/**
 * Un gain refusé par un plafond d'XP ne laisse aucune ligne de ledger : le backfill, rejoué chaque jour par seed-reconcile, ne doit
 * pas le recréditer. Il ne traite que les soirées créées avant XP_CAPS_START (lacunes historiques).
 */
describe.skipIf(!TEST_DATABASE_URL)("backfillXp : plafonds d'XP respectés", () => {
  let db: import("@prisma/client").PrismaClient;
  const ids: Record<string, string> = {};
  beforeAll(async () => { db = (await import("@/lib/prisma")).prisma as unknown as typeof db; });
  afterAll(async () => { await db?.$disconnect(); });
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "User", "Game", "Community" CASCADE');
    (await import("./default-community")).resetDefaultCommunityIdCache();
    ids.community = await (await import("./default-community")).getDefaultCommunityId();
    ids.user = (await db.user.create({ data: { discordId: "u1", discordName: "u1" } })).id;
    await db.membership.create({ data: { userId: ids.user, communityId: ids.community, status: "ACTIVE" } });
    ids.game = (await db.game.create({ data: { name: "Jeu", source: "MANUAL", addedById: ids.user } })).id;
  });

  async function playedSession(id: string, createdAt: Date) {
    await db.session.create({ data: { id, date: createdAt, status: "DONE", createdById: ids.user, communityId: ids.community, createdAt, decidedGameId: ids.game } });
    const proposal = await db.proposal.create({ data: { sessionId: id, gameId: ids.game, proposedById: ids.user } });
    await db.vote.create({ data: { proposalId: proposal.id, userId: ids.user } });
  }
  const gains = (reason: "CREATE_SESSION" | "VOTE" | "PARTICIPATE") => db.xpEvent.count({ where: { userId: ids.user, reason } });

  it("une soirée récente dont le gain a été refusé par un plafond n'est PAS recréditée (rejeu deux fois)", async () => {
    await playedSession("recente", new Date());
    const { backfillXp } = await import("./backfill-xp");
    await backfillXp(); await backfillXp();
    expect(await gains("CREATE_SESSION")).toBe(0);
    expect(await gains("VOTE")).toBe(0);
    expect(await gains("PARTICIPATE")).toBe(0);
  });

  it("une lacune historique (soirée d'avant les plafonds) est toujours comblée, une seule fois", async () => {
    await playedSession("ancienne", new Date("2026-10-01T00:00:00Z"));
    const { backfillXp } = await import("./backfill-xp");
    await backfillXp(); await backfillXp();
    expect(await gains("CREATE_SESSION")).toBe(1);
    expect(await gains("VOTE")).toBe(1);
    expect(await gains("PARTICIPATE")).toBe(1);
  });
});
