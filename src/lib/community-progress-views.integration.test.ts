import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const { currentUser, webhook } = vi.hoisted(() => ({ currentUser: vi.fn(), webhook: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: currentUser }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/components/XpEvolutionChart", () => ({ XpEvolutionChart: () => null }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); }, notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/discord", async () => ({ ...(await vi.importActual<typeof import("./discord")>("./discord")), postToDiscord: webhook }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

/** Inspecte les props des éléments produits par les vraies pages serveur, sans navigateur ni réseau. */
function elements(value: unknown): Array<ReactElement<Record<string, unknown>>> {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(elements);
  const element = value as ReactElement<Record<string, unknown>>;
  if (!element.props) return [];
  return [element, ...elements(element.props.children)];
}

if (!TEST_DATABASE_URL) console.warn("[community-progress-views] Postgres absent : validations vues SKIPPÉES.");
describe.skipIf(!TEST_DATABASE_URL)("progression : vues et système de deux serveurs", () => {
  let db: import("@prisma/client").PrismaClient;
  const ids: Record<string, string> = {};
  beforeAll(async () => { db = (await import("@/lib/prisma")).prisma as unknown as typeof db; });
  afterAll(async () => { await db?.$disconnect(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const flag of ["COMMUNITY_ISOLATION_ENABLED", "COMMUNITY_PICKER_ENABLED"]) vi.stubEnv(flag, "true");
    for (const flag of ["COMMUNITY_CHANNELS_ENABLED", "DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED", "NOTIFICATION_EXECUTOR_ENABLED"]) vi.stubEnv(flag, "false");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Réseau interdit en test"); }));
    webhook.mockResolvedValue({ ok: true });
    await db.$executeRawUnsafe('TRUNCATE "User", "Game", "Badge", "Community" CASCADE');
    (await import("./default-community")).resetDefaultCommunityIdCache();
    for (const name of ["default", "a", "b"]) ids[name] = (await db.community.create({ data: { slug: name, name, status: "ACTIVE", discordGuildId: `guild-${name}` } })).id;
    for (const name of ["shared", "alice", "bob", "none"]) ids[name] = (await db.user.create({ data: { discordId: name, discordName: name, xpTotal: 99999, streakCount: 99, bestStreakCount: 99 } })).id;
    for (const [user, community] of [["shared", "a"], ["shared", "b"], ["alice", "a"], ["bob", "b"]])
      await db.membership.create({ data: { userId: ids[user], communityId: ids[community], status: "ACTIVE" } });
    await db.user.update({ where: { id: ids.shared }, data: { activeCommunityId: ids.a } });
    await db.communityMemberStats.createMany({ data: [
      { communityId: ids.a, userId: ids.shared, xpTotal: 30, streakCount: 2, bestStreakCount: 3, streakLastActiveAt: new Date() },
      { communityId: ids.b, userId: ids.shared, xpTotal: 800, streakCount: 20, bestStreakCount: 25, streakLastActiveAt: new Date() },
      { communityId: ids.a, userId: ids.alice, xpTotal: 50 }, { communityId: ids.b, userId: ids.bob, xpTotal: 900 },
    ] });
    ids.game = (await db.game.create({ data: { name: "Jeu", source: "MANUAL", addedById: ids.shared } })).id;
    for (const c of ["a", "b"]) {
      ids[`badge-${c}`] = (await db.badge.create({ data: { name: `Badge ${c}`, icon: "X", description: c, category: "PARTICIPATION", rarity: "COMMON", criteria: {}, modifiedById: ids.shared } })).id;
      await db.userBadge.create({ data: { communityId: ids[c], userId: ids.shared, badgeId: ids[`badge-${c}`] } });
      await db.levelUpEvent.create({ data: { communityId: ids[c], userId: ids.shared, level: c === "a" ? 2 : 77 } });
      await db.xpEvent.create({ data: { communityId: ids[c], userId: ids.shared, sourceId: `purged-${c}`, reason: "PARTICIPATE", amount: c === "a" ? 10 : 700 } });
      await db.sessionResult.create({ data: { communityId: ids[c], userId: ids.shared, placement: c === "a" ? 2 : 1, gameId: ids.game, gameName: c } });
    }
    currentUser.mockImplementation(async () => {
      const user = await db.user.findUniqueOrThrow({ where: { id: ids.shared } });
      const stats = await import("./member-stats");
      return stats.projectUserProgress(user, await stats.getMemberStatsForViewer(user.id, user.id));
    });
  });
  const choose = async (c: string) => db.user.update({ where: { id: ids.shared }, data: { activeCommunityId: ids[c] } });

  it("classement et rang : le membre commun a deux soldes et niveaux distincts", async () => {
    const { getScoreboard } = await import("./scoreboard");
    const { getGlobalRank } = await import("./profile-stats");
    const a = await getScoreboard("global", { communityId: ids.a });
    const b = await getScoreboard("global", { communityId: ids.b });
    expect(a.map((u) => [u.userId, u.periodXp])).toEqual([[ids.alice, 50], [ids.shared, 30]]);
    expect(b.map((u) => [u.userId, u.periodXp])).toEqual([[ids.bob, 900], [ids.shared, 800]]);
    expect(a.find((u) => u.userId === ids.shared)?.level).not.toBe(b.find((u) => u.userId === ids.shared)?.level);
    expect(await getGlobalRank(30, ids.shared)).toEqual({ position: 2, total: 2 });
    expect(await getScoreboard("week", { communityId: ids.a })).toContainEqual(expect.objectContaining({ userId: ids.shared, periodXp: 10 }));
  });
  it("profil : XP, participations, streak et ancien record projetés dans le serveur actif", async () => {
    const stats = await import("./profile-stats");
    expect(await stats.getProfileStats(ids.shared, 2)).toMatchObject({ sessionsParticipated: 1, streakCount: 2 });
    const user = await currentUser(); expect(user).toMatchObject({ xpTotal: 30, streakCount: 2, bestStreakCount: 3 });
    await choose("b"); expect(await currentUser()).toMatchObject({ xpTotal: 800, streakCount: 20, bestStreakCount: 25 });
  });
  it("vues badges propre/pote : le lecteur choisit la communauté, aucun badge B dans A", async () => {
    const mine = (await import("@/app/profil/badges/page")).default;
    const friend = (await import("@/app/potes/[id]/badges/page")).default;
    const read = (tree: unknown) => elements(tree).find((e) => Array.isArray(e.props.badges))?.props.badges as Array<{ id: string; unlockedAt: Date | null }>;
    const own = read(await mine());
    expect(own.find((b) => b.id === ids["badge-a"])?.unlockedAt).not.toBeNull();
    expect(own.find((b) => b.id === ids["badge-b"])?.unlockedAt).toBeNull();
    // Alice ne possède que A ; le pote shared a sélectionné B mais Alice lit A.
    await choose("b"); currentUser.mockResolvedValue(await db.user.findUniqueOrThrow({ where: { id: ids.alice } }));
    const other = read(await friend({ params: Promise.resolve({ id: ids.shared }) }));
    expect(other.find((b) => b.id === ids["badge-a"])?.unlockedAt).not.toBeNull();
    expect(other.find((b) => b.id === ids["badge-b"])?.unlockedAt).toBeNull();
  });
  it("profil aperçu : podium durable et courbe XP restent dans A après purge du parent", async () => {
    const page = (await import("@/app/profil/page")).default;
    const tree = await page();
    const chart = elements(tree).find((e) => Array.isArray(e.props.data));
    expect(chart).toBeDefined();
    const points = chart!.props.data as Array<{ xp: number }>;
    expect(points.at(-1)?.xp).toBe(30);
    const text = JSON.stringify(elements(tree).map((element) => element.props), (key, value) =>
      key === "type" || key === "_owner" ? undefined : value);
    expect(text).toContain('"a"'); expect(text).not.toContain('"b"');
    const percentages = elements(tree).map((element) => element.props.children).filter((child) => typeof child === "string" && /^\d+%$/.test(child));
    expect(percentages).toEqual(["0%"]);
  });
  it("badges d'un pote retiré de A mais encore dans B : refus dans A, même avec un lecteur A/B", async () => {
    await db.membership.create({ data: { userId: ids.alice, communityId: ids.b, status: "ACTIVE" } });
    await db.user.update({ where: { id: ids.alice }, data: { activeCommunityId: ids.a } });
    await db.membership.update({ where: { communityId_userId: { communityId: ids.a, userId: ids.shared } }, data: { status: "REMOVED" } });
    currentUser.mockResolvedValue(await db.user.findUniqueOrThrow({ where: { id: ids.alice } }));
    const page = (await import("@/app/potes/[id]/badges/page")).default;
    await expect(page({ params: Promise.resolve({ id: ids.shared }) })).rejects.toThrow("NOT_FOUND");
    await db.user.update({ where: { id: ids.alice }, data: { activeCommunityId: ids.b } });
    const tree = await page({ params: Promise.resolve({ id: ids.shared }) });
    const badges = elements(tree).find((e) => Array.isArray(e.props.badges))!.props.badges as Array<{ id: string; unlockedAt: Date | null }>;
    expect(badges.find((b) => b.id === ids["badge-b"])?.unlockedAt).not.toBeNull();
    expect(badges.find((b) => b.id === ids["badge-a"])?.unlockedAt).toBeNull();
  });
  it("badges flags OFF : default seulement, sans exigence d'appartenance", async () => {
    await db.userBadge.create({ data: { communityId: ids.default, userId: ids.shared, badgeId: ids["badge-a"] } });
    await db.membership.updateMany({ where: { userId: ids.shared }, data: { status: "REMOVED" } });
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    const tree = await (await import("@/app/potes/[id]/badges/page")).default({ params: Promise.resolve({ id: ids.shared }) });
    const badges = elements(tree).find((e) => Array.isArray(e.props.badges))!.props.badges as Array<{ id: string; unlockedAt: Date | null }>;
    expect(badges.find((b) => b.id === ids["badge-a"])?.unlockedAt).not.toBeNull();
    expect(badges.find((b) => b.id === ids["badge-b"])?.unlockedAt).toBeNull();
  });
  it("accueil : feed et streak ne mélangent pas le membre commun A+B", async () => {
    const home = await import("./home");
    const feed = (await home.getRecentActivity(ids.shared, 20)).map((e) => e.text).join("|");
    expect(feed).toContain("Badge a"); expect(feed).not.toContain("Badge b"); expect(feed).not.toContain("77");
    expect((await home.getGroupStats(ids.shared)).bestActiveStreak).toEqual({ discordName: "shared", streakCount: 2 });
    await choose("b"); expect((await home.getGroupStats(ids.shared)).bestActiveStreak?.streakCount).toBe(20);
  });
  it("XP : retour flags OFF choisit default et ne mélange pas les événements B", async () => {
    await db.communityMemberStats.create({ data: { communityId: ids.default, userId: ids.shared, xpTotal: 7 } });
    await db.xpEvent.create({ data: { communityId: ids.default, userId: ids.shared, sourceId: "default", reason: "PARTICIPATE", amount: 7 } });
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    const home = await import("./home");
    expect((await home.getRecentActivity(ids.shared, 20)).map((e) => e.text).join("|")).not.toContain("Badge b");
    const entries = await (await import("./scoreboard")).getScoreboard("week");
    expect(entries.find((u) => u.userId === ids.shared)?.periodXp).toBe(7);
  });
  it("récap : inclut toutes sources XP communautaires durables même parent disparu", async () => {
    const lastMonth = new Date("2026-09-15T12:00:00Z");
    await db.xpEvent.updateMany({ data: { createdAt: lastMonth } });
    await db.session.create({ data: { communityId: ids.a, createdById: ids.shared, status: "DONE", date: lastMonth, decidedGameId: ids.game } });
    await db.xpEvent.create({ data: { communityId: ids.a, userId: ids.shared, sourceId: "purged-badge", reason: "BADGE_UNLOCKED", amount: 13, createdAt: lastMonth } });
    vi.spyOn(await import("./wallclock"), "wallClockNow").mockReturnValue(new Date("2026-10-01T12:00:00Z"));
    try {
      const recap = await import("./monthly-recap"); await recap.generateMonthlyRecapIfDue();
      expect((await recap.getMonthlyRecap(2026, 9, ids.shared))?.totalGroupXp).toBe(23);
      expect((await recap.getMonthlyRecap(2026, 9, ids.shared))?.bestStreak?.streak).toBe(2);
    } finally { vi.restoreAllMocks(); }
  });
  it("saison : un membre retiré conserve son snapshot, sans devenir champion annoncé", async () => {
    const seasons = await import("./seasons"); await seasons.ensureActiveSeasonExists(ids.a);
    await db.season.updateMany({ where: { communityId: ids.a }, data: { endDate: new Date("2026-01-01") } });
    await db.communityMemberStats.update({ where: { communityId_userId: { communityId: ids.a, userId: ids.alice } }, data: { xpTotal: 9000 } });
    await db.membership.update({ where: { communityId_userId: { communityId: ids.a, userId: ids.alice } }, data: { status: "REMOVED" } });
    await db.communityChannelConfig.create({ data: { communityId: ids.a, category: "SESSION", discordChannelId: "channel-a", enabled: true } });
    for (const flag of ["COMMUNITY_CHANNELS_ENABLED", "DISCORD_BOT_SESSION_ANNOUNCE_ENABLED"]) vi.stubEnv(flag, "true");
    await seasons.finalizeSeasonIfDue();
    expect((await db.seasonSnapshot.findFirstOrThrow({ where: { userId: ids.alice } })).xp).toBe(9000);
    const event = await db.notificationEvent.findFirstOrThrow({ where: { communityId: ids.a, category: "REWARD" } });
    expect(JSON.stringify(event.payload)).toContain("shared"); expect(JSON.stringify(event.payload)).not.toContain("alice");
    expect((await db.communityMemberStats.findUniqueOrThrow({ where: { communityId_userId: { communityId: ids.b, userId: ids.shared } } })).xpTotal).toBe(800);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("droits : un retrait ou une suspension ferme profil progression et classement", async () => {
    await db.membership.update({ where: { communityId_userId: { communityId: ids.a, userId: ids.shared } }, data: { status: "REMOVED" } });
    expect(await (await import("./member-stats")).getMemberStats(ids.shared, ids.a)).toMatchObject({ xpTotal: 0, streakCount: 0 });
    await db.community.update({ where: { id: ids.b }, data: { status: "SUSPENDED" } });
    expect(await (await import("./scoreboard")).getScoreboard("global", { communityId: ids.b })).toEqual([]);
    expect(await (await import("./member-stats")).getMemberStatsForViewer(ids.shared, ids.shared)).toMatchObject({ xpTotal: 0 });
  });
  it("historique de saisons : snapshots A seulement, puis default lorsque les flags sont OFF", async () => {
    const page = (await import("@/app/profil/saisons/page")).default;
    for (const c of ["default", "a", "b"]) {
      const season = await db.season.create({ data: { communityId: ids[c], number: 1, name: `Saison-${c}`, startDate: new Date(0), endDate: new Date(1), isActive: false } });
      await db.seasonSnapshot.create({ data: { seasonId: season.id, userId: ids.shared, xp: 7, level: 1, rank: "r", position: 1 } });
    }
    const names = (tree: unknown) => elements(tree).map((element) => element.props.children).flat().filter((child) => typeof child === "string" && child.startsWith("Saison-"));
    expect(names(await page())).toEqual(["Saison-a"]);
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    expect(names(await page())).toEqual(["Saison-default"]);
  });
});
