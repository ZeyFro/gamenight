import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/discord-rest", () => ({ editSetupResponse: vi.fn() }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

if (!TEST_DATABASE_URL) console.warn("[discord-session-propose-list] Postgres absent : test SKIPPÉ.");
/**
 * Production du 24/11/2026 : « /soiree creer jeu:Deadlock » répondait « jeu proposé : Deadlock », puis « /soiree liste » affichait
 * « jeu à définir ». Le jeu est bien une proposition de la soirée ; la liste doit la montrer tant que le vote n'a rien décidé.
 */
describe.skipIf(!TEST_DATABASE_URL)("/soiree creer puis /soiree liste : le jeu proposé apparaît", () => {
  let db: import("@prisma/client").PrismaClient;
  const ids: Record<string, string> = {};
  beforeAll(async () => { db = (await import("@/lib/prisma")).prisma as unknown as typeof db; });
  afterAll(async () => { await db?.$disconnect(); });
  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    await db.$executeRawUnsafe('TRUNCATE "User", "Game", "Community" CASCADE');
    (await import("./default-community")).resetDefaultCommunityIdCache();
    ids.community = (await db.community.create({ data: { slug: "tower", name: "The Tower", status: "ACTIVE", discordGuildId: "guild-tower" } })).id;
    ids.me = (await db.user.create({ data: { discordId: "me", discordName: "moi" } })).id;
    await db.membership.create({ data: { userId: ids.me, communityId: ids.community, status: "ACTIVE" } });
    await db.user.update({ where: { id: ids.me }, data: { activeCommunityId: ids.community } });
    await db.game.create({ data: { name: "Deadlock", source: "MANUAL", addedById: ids.me } });
  });

  it("le message dit « proposé au vote » et la liste montre « Deadlock (proposé) », pas « jeu à définir »", async () => {
    const { createSessionFromDiscord, loadUpcomingSessions, renderSessionList } = await import("./discord-session-commands");
    const date = new Date(Date.now() + 5 * 86_400_000);
    const day = date.toISOString().slice(0, 10);
    const created = await createSessionFromDiscord({ userId: ids.me, communityId: ids.community, gameQuery: "Deadlock", dateStr: day, timeStr: "21:00", places: null });
    expect(created.status).toBe("CREATED");
    expect(await db.proposal.count({ where: { game: { name: "Deadlock" } } })).toBe(1);
    const sessions = await loadUpcomingSessions({ userId: ids.me, communityId: ids.community });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].proposedGames).toEqual(["Deadlock"]);
    const text = renderSessionList(sessions, "The Tower");
    expect(text).toContain("Deadlock (proposé)");
    expect(text).not.toContain("jeu à définir");
  });
});
