import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const { currentUser } = vi.hoisted(() => ({ currentUser: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: currentUser }));
vi.mock("@/lib/discord-level-up", () => ({ announceLevelUp: vi.fn() }));
vi.mock("@/lib/discord-badge-unlocked", () => ({ announceBadgeUnlocked: vi.fn() }));
vi.mock("@/lib/community-announce", () => ({ postToCommunity: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (TEST_DATABASE_URL && new URL(TEST_DATABASE_URL).hostname !== "127.0.0.1") throw new Error("Postgres local 127.0.0.1 uniquement");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
if (!TEST_DATABASE_URL) console.warn("[community-progression] Postgres local absent : tests SKIPPÉS.");

describe.skipIf(!TEST_DATABASE_URL)("progression par communauté, mutations Postgres sans réseau", () => {
  let db: import("@prisma/client").PrismaClient;
  let xp: typeof import("./xp-actions");
  let badges: typeof import("./badges");
  let members: typeof import("./member-stats");
  let bets: typeof import("./xp-bets");
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma;
    xp = await import("./xp-actions"); badges = await import("./badges");
    members = await import("./member-stats"); bets = await import("./xp-bets");
  });
  afterAll(async () => { await db?.$disconnect(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true"); vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED", "false");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Réseau interdit dans ce test"); }));
    await db.$executeRawUnsafe('TRUNCATE "Notification", "NotificationEvent", "CommunityMemberStats", "User", "Community", "Game", "Badge" CASCADE');
    (await import("./default-community")).resetDefaultCommunityIdCache();
    for (const c of ["default", "a", "b"]) ids[c] = (await db.community.create({ data: { slug: c, name: c, status: "ACTIVE" } })).id;
    for (const u of ["both", "alice", "bob", "none"]) ids[u] = (await db.user.create({ data: { discordId: u, discordName: u, xpTotal: 777, streakCount: 30, bestStreakCount: 99 } })).id;
    for (const [u, c] of [["both", "a"], ["both", "b"], ["alice", "a"], ["bob", "b"]]) await db.membership.create({ data: { userId: ids[u], communityId: ids[c] } });
    await db.user.update({ where: { id: ids.both }, data: { activeCommunityId: ids.a } });
    ids.game = (await db.game.create({ data: { name: "Jeu", source: "MANUAL", addedById: ids.both } })).id;
    currentUser.mockResolvedValue(await db.user.findUniqueOrThrow({ where: { id: ids.both } }));
  });
  const stats = (c: string, u = "both") => db.communityMemberStats.findUnique({ where: { communityId_userId: { communityId: ids[c], userId: ids[u] } } });
  const setStats = (c: string, data: { xpTotal?: number; streakCount?: number; streakLastActiveAt?: Date; bestStreakCount?: number }) => db.communityMemberStats.create({ data: { communityId: ids[c], userId: ids.both, ...data } });
  const session = (c: string) => db.session.create({ data: { communityId: ids[c], createdById: ids.both, date: new Date(), status: "SCHEDULED", decidedGameId: ids.game } });

  it("20 badges crédités ne reprennent aucune transaction ; un crédit manquant reste réparable", async () => {
    const badgeIds = Array.from({ length: 20 }, (_, i) => `earned-${i}`);
    await db.badge.createMany({ data: badgeIds.map((id) => ({ id, name: id,
      category: "ENGAGEMENT" as const, rarity: "COMMON" as const, modifiedById: ids.both,
      icon: "B", description: "Historique", active: false, criteria: { type: "SESSIONS_CREATED", count: 1 }, xpReward: 10,
    })) });
    await db.userBadge.createMany({ data: badgeIds.map((badgeId) => ({ userId: ids.both, communityId: ids.a, badgeId })) });
    await db.xpEvent.createMany({ data: badgeIds.map((sourceId) => ({ userId: ids.both, communityId: ids.a, reason: "BADGE_UNLOCKED" as const, sourceId, amount: 10 })) });
    await setStats("a", { xpTotal: 200 });
    const transaction = vi.spyOn(db, "$transaction");
    try {
      await badges.checkSessionsCreatedBadges(ids.both, ids.a);
      expect(transaction).not.toHaveBeenCalled();
      expect((await stats("a"))?.xpTotal).toBe(200);
      await db.xpEvent.deleteMany({ where: { communityId: ids.a, sourceId: badgeIds[0] } });
      await db.communityMemberStats.updateMany({ where: { communityId: ids.a, userId: ids.both }, data: { xpTotal: 190 } });
      await badges.checkSessionsCreatedBadges(ids.both, ids.a);
      expect(transaction).toHaveBeenCalledOnce();
      expect((await stats("a"))?.xpTotal).toBe(200);
      expect(await db.xpEvent.count({ where: { communityId: ids.a, reason: "BADGE_UNLOCKED" } })).toBe(20);
      expect(await stats("b")).toBeNull();
    } finally { transaction.mockRestore(); }
  });

  it("même source dans deux communautés : deux gains indépendants, User historique intact", async () => {
    await xp.awardXp(ids.both, ids.a, "VOTE", "same-source", 30, { applyStreak: false });
    await xp.awardXp(ids.both, ids.b, "VOTE", "same-source", 10, { applyStreak: false });
    expect((await stats("a"))?.xpTotal).toBe(30); expect((await stats("b"))?.xpTotal).toBe(10);
    expect(await db.xpEvent.count()).toBe(2);
    expect((await db.user.findUniqueOrThrow({ where: { id: ids.both } })).xpTotal).toBe(777);
  });
  it("réessais simultanés : un seul événement et un seul crédit", async () => {
    await Promise.all(Array.from({ length: 8 }, () => xp.awardXp(ids.both, ids.a, "VOTE", "retry", 30, { applyStreak: false })));
    expect(await db.xpEvent.count()).toBe(1); expect((await stats("a"))?.xpTotal).toBe(30);
  });
  it.each(["STEAM_LINK_FIRST", "AVAILABILITY_FIRST"] as const)("premier geste global %s : un seul crédit malgré deux communautés concurrentes", async (reason) => {
    await Promise.all([xp.awardXp(ids.both, ids.a, reason, ids.both, 20), xp.awardXp(ids.both, ids.b, reason, ids.both, 20)]);
    expect(await db.xpEvent.count({ where: { userId: ids.both, reason } })).toBe(1);
    expect(((await stats("a"))?.xpTotal ?? 0) + ((await stats("b"))?.xpTotal ?? 0)).toBe(20);
  });
  it("gains distincts simultanés : solde exact et un seul passage du niveau 2", async () => {
    await Promise.all([xp.awardXp(ids.both, ids.a, "VOTE", "one", 25), xp.awardXp(ids.both, ids.a, "VOTE", "two", 30)]);
    expect((await stats("a"))?.xpTotal).toBe(55);
    expect(await db.levelUpEvent.count({ where: { communityId: ids.a, level: 2 } })).toBe(1);
    expect(await db.levelUpEvent.count({ where: { communityId: ids.b } })).toBe(0);
  });
  it("multiplicateur de streak propre au serveur", async () => {
    await setStats("a", { streakCount: 11 }); await setStats("b", { streakCount: 1 });
    await xp.awardXp(ids.both, ids.a, "VOTE", "a", 10); await xp.awardXp(ids.both, ids.b, "VOTE", "b", 10);
    expect((await stats("a"))?.xpTotal).toBe(15); expect((await stats("b"))?.xpTotal).toBe(10);
  });
  it("membre absent ou révoqué : aucun XP, badge ou streak", async () => {
    await db.membership.update({ where: { communityId_userId: { communityId: ids.a, userId: ids.both } }, data: { status: "REMOVED" } });
    for (const u of [ids.both, ids.none]) {
      await xp.awardXp(u, ids.a, "VOTE", "denied", 100);
      await xp.touchStreak(u, ids.a); await badges.checkTemporalBadges({ id: u, streakCount: 30, createdAt: new Date(0) }, ids.a);
    }
    expect(await db.communityMemberStats.count()).toBe(0); expect(await db.xpEvent.count()).toBe(0); expect(await db.userBadge.count()).toBe(0);
  });
  it("serveur suspendu : aucune mutation de progression", async () => {
    await db.community.update({ where: { id: ids.a }, data: { status: "SUSPENDED" } });
    await xp.awardXp(ids.both, ids.a, "VOTE", "denied", 100); await xp.touchStreak(ids.both, ids.a);
    expect(await db.communityMemberStats.count()).toBe(0); expect(await db.xpEvent.count()).toBe(0);
  });
  it("streak concurrent : incrément unique sans contamination du deuxième serveur", async () => {
    await setStats("a", { streakCount: 5, bestStreakCount: 8, streakLastActiveAt: new Date(Date.now() - 13 * 3600_000) });
    await Promise.all(Array.from({ length: 6 }, () => xp.touchStreak(ids.both, ids.a)));
    expect((await stats("a"))?.streakCount).toBe(6); expect((await stats("a"))?.bestStreakCount).toBe(8); expect(await stats("b")).toBeNull();
  });
  it("badge participation : seuil limité aux événements du serveur", async () => {
    const badge = await db.badge.create({ data: { category: "ENGAGEMENT", rarity: "COMMON", modifiedById: ids.both, name: "Deux", icon: "B", description: "Deux soirées", criteria: { type: "SESSIONS_PARTICIPATED", count: 2 }, xpReward: 10 } });
    for (const [c, source] of [["a", "a1"], ["a", "a2"], ["b", "b1"]]) await db.xpEvent.create({ data: { communityId: ids[c], userId: ids.both, reason: "PARTICIPATE", sourceId: source, amount: 20 } });
    await badges.checkSessionsParticipatedBadges(ids.both, ids.a); await badges.checkSessionsParticipatedBadges(ids.both, ids.b);
    expect(await db.userBadge.count({ where: { communityId: ids.a, badgeId: badge.id } })).toBe(1);
    expect(await db.userBadge.count({ where: { communityId: ids.b, badgeId: badge.id } })).toBe(0);
  });
  it("ancien badge désactivé, streak cassé : réparation du gain manquant une seule fois", async () => {
    const badge = await db.badge.create({ data: { category: "ENGAGEMENT", rarity: "COMMON", modifiedById: ids.both, name: "Ancien", icon: "B", description: "Streak", active: false, criteria: { type: "STREAK_DAYS", count: 30 }, xpReward: 40 } });
    await db.userBadge.create({ data: { communityId: ids.a, userId: ids.both, badgeId: badge.id } });
    await badges.checkTemporalBadges({ id: ids.both, streakCount: 1, createdAt: new Date() }, ids.a);
    await badges.checkTemporalBadges({ id: ids.both, streakCount: 1, createdAt: new Date() }, ids.a);
    expect((await stats("a"))?.xpTotal).toBe(40); expect(await db.xpEvent.count()).toBe(1); expect(await stats("b")).toBeNull();
  });
  it.each([
    ["SESSIONS_CREATED", "CREATE_SESSION", "checkSessionsCreatedBadges"],
    ["VOTES_CAST", "VOTE", "checkVotesCastBadges"],
    ["CHALLENGES_COMPLETED", "CHALLENGE_COMPLETE", "checkChallengeBadges"],
    ["TOURNAMENTS_WON", "TOURNAMENT_RESULT", "checkTournamentBadges"],
  ] as const)("badge ledger %s : seuil indépendant par communauté", async (type, reason, helper) => {
    const badge = await db.badge.create({ data: { category: "ENGAGEMENT", rarity: "COMMON", modifiedById: ids.both, name: type, icon: "B", description: type, criteria: { type, count: 2 } } });
    for (const [community, source] of [["a", "one:1st"], ["a", "two:1st"], ["b", "three:1st"]])
      await db.xpEvent.create({ data: { communityId: ids[community], userId: ids.both, reason, sourceId: source, amount: 10 } });
    await badges[helper](ids.both, ids.a); await badges[helper](ids.both, ids.b);
    expect(await db.userBadge.count({ where: { badgeId: badge.id, communityId: ids.a } })).toBe(1);
    expect(await db.userBadge.count({ where: { badgeId: badge.id, communityId: ids.b } })).toBe(0);
  });
  it("projection profil utilise le serveur du lecteur, aucune lecture ne crée de stats", async () => {
    await setStats("a", { xpTotal: 50 }); await setStats("b", { xpTotal: 900 });
    expect((await members.getMemberStatsForViewer(ids.both, ids.both)).xpTotal).toBe(50);
    expect((await members.getMemberStatsForViewer(ids.alice, ids.bob)).xpTotal).toBe(0);
    expect(await db.communityMemberStats.count()).toBe(2);
  });
  it.each([
    ["SUPERLATIVES_WON", "checkSuperlativesWonBadges"],
    ["PRONOSTICS_CORRECT", "checkPronosticBadges"],
    ["BETS_WON", "checkBetBadges"],
  ] as const)("badge durable %s : parents purgés, seuil limité au serveur", async (type, helper) => {
    const badge = await db.badge.create({ data: { category: "ENGAGEMENT", rarity: "COMMON", modifiedById: ids.both, name: type, icon: "B", description: type, criteria: { type, count: 2 } } });
    const category = await db.superlativeCategory.create({ data: { name: type, icon: "S", modifiedById: ids.both } });
    for (const c of ["a", "a", "b"]) {
      if (type === "SUPERLATIVES_WON") await db.superlativeAward.create({ data: { communityId: ids[c], winnerUserId: ids.both, categoryId: category.id, voteCount: 1 } });
      if (type === "PRONOSTICS_CORRECT") await db.pronostic.create({ data: { communityId: ids[c], voterId: ids.both, predictedUserId: ids.both, correct: true } });
      if (type === "BETS_WON") await db.xpBet.create({ data: { communityId: ids[c], voterId: ids.both, targetUserId: ids.both, won: true, amount: 10 } });
    }
    await badges[helper](ids.both, ids.a); await badges[helper](ids.both, ids.b);
    expect(await db.userBadge.count({ where: { badgeId: badge.id, communityId: ids.a } })).toBe(1);
    expect(await db.userBadge.count({ where: { badgeId: badge.id, communityId: ids.b } })).toBe(0);
  });
  it("badge ALL_IN_WIN : le gain B ne débloque pas le badge A", async () => {
    const badge = await db.badge.create({ data: { category: "ENGAGEMENT", rarity: "COMMON", modifiedById: ids.both, name: "all-in", icon: "B", description: "all-in", criteria: { type: "ALL_IN_WIN", count: 1 } } });
    await db.xpBet.create({ data: { communityId: ids.b, voterId: ids.both, targetUserId: ids.both, won: true, amount: 10, allIn: true } });
    await badges.checkBetBadges(ids.both, ids.a); await badges.checkBetBadges(ids.both, ids.b);
    expect(await db.userBadge.count({ where: { badgeId: badge.id, communityId: ids.a } })).toBe(0);
    expect(await db.userBadge.count({ where: { badgeId: badge.id, communityId: ids.b } })).toBe(1);
  });
  it("badge TOURNAMENTS_PARTICIPATED : compteurs communautaires durables", async () => {
    const badge = await db.badge.create({ data: { category: "ENGAGEMENT", rarity: "COMMON", modifiedById: ids.both, name: "Gladiateur", icon: "B", description: "tournois", criteria: { type: "TOURNAMENTS_PARTICIPATED", count: 2 } } });
    await db.communityMemberStats.createMany({ data: [{ communityId: ids.a, userId: ids.both, tournamentsParticipatedCount: 2 }, { communityId: ids.b, userId: ids.both, tournamentsParticipatedCount: 1 }] });
    await badges.checkTournamentBadges(ids.both, ids.a); await badges.checkTournamentBadges(ids.both, ids.b);
    expect(await db.userBadge.count({ where: { badgeId: badge.id, communityId: ids.a } })).toBe(1);
    expect(await db.userBadge.count({ where: { badgeId: badge.id, communityId: ids.b } })).toBe(0);
  });
  it("mises concurrentes : débit du bon solde communautaire et allIn calculé sous verrou", async () => {
    await setStats("a", { xpTotal: 100 }); await setStats("b", { xpTotal: 1000 });
    const [s1, s2] = await Promise.all([session("a"), session("a")]);
    const results = await Promise.all([bets.placeBet(s1.id, ids.both, ids.both, 50), bets.placeBet(s2.id, ids.both, ids.both, 50)]);
    expect(results.filter(Boolean)).toHaveLength(1); expect((await stats("a"))?.xpTotal).toBe(50); expect((await stats("b"))?.xpTotal).toBe(1000);
    expect((await db.xpBet.findFirstOrThrow()).allIn).toBe(true);
  });
  it("tournois : compteur durable limité au parent, inscription/réinscription idempotentes", async () => {
    const actions = await import("@/app/tournois/actions");
    const tournaments = await Promise.all(["a", "b"].map((c) => db.tournament.create({ data: { communityId: ids[c], name: c, gameId: ids.game, createdById: ids.both, maxPlayers: 8 } })));
    for (const t of tournaments) { const f = new FormData(); f.set("tournamentId", t.id); await actions.registerForTournamentAction(f); await actions.registerForTournamentAction(f); }
    expect((await stats("a"))?.tournamentsParticipatedCount).toBe(1); expect((await stats("b"))?.tournamentsParticipatedCount).toBe(1);
    const f = new FormData(); f.set("tournamentId", tournaments[0].id); await actions.unregisterFromTournamentAction(f);
    expect((await stats("a"))?.tournamentsParticipatedCount).toBe(0); expect((await stats("b"))?.tournamentsParticipatedCount).toBe(1);
  });
  it("flags OFF : default concrète, ancien User jamais utilisé comme solde", async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    await xp.awardXp(ids.both, null, "VOTE", "legacy", 20, { applyStreak: false });
    expect((await stats("default"))?.xpTotal).toBe(20); expect((await stats("a"))).toBeNull();
  });
  it("badge concurrent : une attribution, un crédit et aucune récompense sur B", async () => {
    const badge = await db.badge.create({ data: { category: "ENGAGEMENT", rarity: "COMMON", modifiedById: ids.both, name: "Concurrent", icon: "B", description: "Premier jour", criteria: { type: "STREAK_DAYS", count: 1 }, xpReward: 10 } });
    await Promise.all(Array.from({ length: 6 }, () => badges.checkTemporalBadges({ id: ids.both, streakCount: 1, createdAt: new Date() }, ids.a)));
    expect(await db.userBadge.count({ where: { badgeId: badge.id } })).toBe(1);
    expect(await db.xpEvent.count({ where: { reason: "BADGE_UNLOCKED" } })).toBe(1);
    expect((await stats("a"))?.xpTotal).toBe(10); expect(await stats("b")).toBeNull();
  });
  it("même badge dans deux serveurs : acquisitions et récompenses indépendantes", async () => {
    const badge = await db.badge.create({ data: { category: "ENGAGEMENT", rarity: "COMMON", modifiedById: ids.both, name: "Deux serveurs", icon: "B", description: "Premier jour", criteria: { type: "STREAK_DAYS", count: 1 }, xpReward: 10 } });
    for (const c of ["a", "b"]) await badges.checkTemporalBadges({ id: ids.both, streakCount: 1, createdAt: new Date() }, ids[c]);
    expect(await db.userBadge.count({ where: { badgeId: badge.id } })).toBe(2);
    expect((await stats("a"))?.xpTotal).toBe(10); expect((await stats("b"))?.xpTotal).toBe(10);
  });
  it("mises : un gros solde B ne permet pas de miser au-delà du solde A", async () => {
    await setStats("a", { xpTotal: 20 }); await setStats("b", { xpTotal: 1000 });
    expect(await bets.placeBet((await session("a")).id, ids.both, ids.both, 50)).toBe(false);
    expect(await db.xpBet.count()).toBe(0); expect((await stats("a"))?.xpTotal).toBe(20);
  });
  it("désinscription historique : compteur absent reste zéro, sans crédit négatif", async () => {
    const actions = await import("@/app/tournois/actions");
    const tournament = await db.tournament.create({ data: { communityId: ids.a, name: "Historique", gameId: ids.game, createdById: ids.both, maxPlayers: 8 } });
    await db.tournamentParticipant.create({ data: { tournamentId: tournament.id, userId: ids.both } });
    const form = new FormData(); form.set("tournamentId", tournament.id);
    await actions.unregisterFromTournamentAction(form);
    expect((await members.getMemberStats(ids.both, ids.a)).tournamentsParticipatedCount).toBe(0);
    expect(await db.tournamentParticipant.count()).toBe(0);
  });
  it("saison concurrente et premier gain d'un membre : aucune perte et un seul snapshot", async () => {
    const seasons = await import("./seasons");
    await setStats("a", { xpTotal: 10 }); await setStats("b", { xpTotal: 900 });
    await seasons.ensureActiveSeasonExists(ids.a);
    await db.season.updateMany({ where: { communityId: ids.a }, data: { endDate: new Date(0) } });
    await Promise.all([seasons.finalizeSeasonIfDue(), seasons.finalizeSeasonIfDue(), xp.awardXp(ids.alice, ids.a, "VOTE", "first-during-close", 30, { applyStreak: false })]);
    const snapshot = await db.seasonSnapshot.findMany({ where: { userId: ids.alice } });
    expect(snapshot.reduce((sum, row) => sum + row.xp, 0) + ((await stats("a", "alice"))?.xpTotal ?? 0)).toBe(30);
    expect(await db.season.count({ where: { communityId: ids.a, isActive: true } })).toBe(1);
    expect(await db.season.count({ where: { communityId: ids.a } })).toBe(2);
    expect((await stats("b"))?.xpTotal).toBe(900);
  });
  it("backfill rejoué : ne duplique pas un gain historique migré default dans son autre serveur", async () => {
    const s = await session("a");
    await db.xpEvent.create({ data: { communityId: ids.default, userId: ids.both, reason: "CREATE_SESSION", sourceId: s.id, amount: 30 } });
    const { backfillXp } = await import("./backfill-xp");
    await backfillXp(); await backfillXp();
    expect(await db.xpEvent.count({ where: { userId: ids.both, reason: "CREATE_SESSION", sourceId: s.id } })).toBe(1);
    expect(await stats("a")).toBeNull();
  });
  it("replay live : un gain historique migré default n'est pas crédité dans le serveur du parent", async () => {
    const s = await session("a");
    await db.xpEvent.create({ data: { communityId: ids.default, userId: ids.both, reason: "CREATE_SESSION", sourceId: s.id, amount: 30 } });
    expect(await xp.awardXp(ids.both, ids.a, "CREATE_SESSION", s.id, 30)).toEqual({ awarded: false, leveledUp: false });
    expect(await db.xpEvent.count()).toBe(1); expect(await stats("a")).toBeNull();
  });
  it("backfill Steam : ne recrédite pas default après un premier gain live sur B", async () => {
    await db.membership.create({ data: { communityId: ids.default, userId: ids.both } });
    await db.user.update({ where: { id: ids.both }, data: { steamId64: "76561197960287930" } });
    await xp.awardXp(ids.both, ids.b, "STEAM_LINK_FIRST", ids.both, 20);
    await (await import("./backfill-xp")).backfillXp();
    expect(await db.xpEvent.count({ where: { userId: ids.both, reason: "STEAM_LINK_FIRST" } })).toBe(1);
    expect(await stats("default")).toBeNull(); expect((await stats("b"))?.xpTotal).toBe(20);
  });
  it("gains et annonces de paris/pronostics : replay concurrent dans le serveur source uniquement", async () => {
    const s = await session("b"); await setStats("a", { xpTotal: 900 });
    const bet = await db.xpBet.create({ data: { communityId: ids.b, sessionId: s.id, voterId: ids.both, targetUserId: ids.both, amount: 10 } });
    const pronostic = await db.pronostic.create({ data: { communityId: ids.b, sessionId: s.id, voterId: ids.both, predictedUserId: ids.both } });
    const predictions = await import("./pronostics");
    for (let retry = 0; retry < 2; retry++) await Promise.all([
      bets.resolveBets(s.id, new Set([ids.both])), bets.resolveBets(s.id, new Set([ids.both])),
      predictions.resolvePronostics(s.id, new Set([ids.both])), predictions.resolvePronostics(s.id, new Set([ids.both])),
    ]);
    expect(await db.xpEvent.count({ where: { communityId: ids.b, reason: "XP_BET_WON", sourceId: bet.id } })).toBe(1);
    expect(await db.xpEvent.count({ where: { communityId: ids.b, reason: "PRONOSTIC_CORRECT", sourceId: pronostic.id } })).toBe(1);
    expect(await db.notification.count({ where: { type: "XP_BET" } })).toBe(1);
    expect(await db.notification.count({ where: { type: "PRONOSTIC" } })).toBe(1);
    expect((await stats("a"))?.xpTotal).toBe(900);
    expect((await stats("b"))?.xpTotal).toBeGreaterThan(20);
    expect(fetch).not.toHaveBeenCalled();
  });
});
