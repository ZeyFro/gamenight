import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const { currentUser, postDiscord } = vi.hoisted(() => ({ currentUser: vi.fn(), postDiscord: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: currentUser }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true, RATE_LIMIT_ERROR_KEY: "rate_limited" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("@/lib/discord", async () => ({
  ...(await vi.importActual<typeof import("./discord")>("./discord")),
  postToDiscord: postDiscord,
}));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

if (!TEST_DATABASE_URL) console.warn("[community-domains] TEST_DATABASE_URL absente : isolation des domaines NON validée (SKIPPÉE).");

describe.skipIf(!TEST_DATABASE_URL)("domaines collectifs : Postgres local, aucun réseau Discord", () => {
  let db: import("@prisma/client").PrismaClient;
  let instant: typeof import("./instant-sessions");
  let roulette: typeof import("./roulette");
  let weekly: typeof import("./weekly-challenges");
  let seasons: typeof import("./seasons");
  let recap: typeof import("./monthly-recap");
  let scope: typeof import("./community-scoped-client");
  let isolation: typeof import("./community-isolation");
  let defaults: typeof import("./default-community");
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    instant = await import("./instant-sessions");
    roulette = await import("./roulette");
    weekly = await import("./weekly-challenges");
    seasons = await import("./seasons");
    recap = await import("./monthly-recap");
    scope = await import("./community-scoped-client");
    isolation = await import("./community-isolation");
    defaults = await import("./default-community");
  });
  afterAll(async () => { await db?.$disconnect(); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "false");
    vi.stubEnv("DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED", "false");
    postDiscord.mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Un test tente un appel réseau !"); }));
    await db.$executeRawUnsafe(`TRUNCATE "WeeklyChallenge", "MonthlyRecap", "Season", "Notification", "NotificationDelivery", "NotificationEvent", "User", "Game", "Community" CASCADE`);
    defaults.resetDefaultCommunityIdCache();
    for (const name of ["default", "a", "b"]) ids[name] = (await db.community.create({ data: { slug: name, name, status: "ACTIVE" } })).id;
    for (const name of ["alice", "bob", "carol", "dave", "none"]) ids[name] = (await db.user.create({ data: { discordId: name, discordName: name, xpTotal: 100 } })).id;
    for (const [u, c] of [["alice", "a"], ["bob", "b"], ["carol", "a"], ["carol", "b"], ["dave", "default"]]) {
      await db.membership.create({ data: { userId: ids[u], communityId: ids[c], status: "ACTIVE" } });
    }
    await db.user.update({ where: { id: ids.carol }, data: { activeCommunityId: ids.a } });
    ids.game = (await db.game.create({ data: { name: "Coop", source: "MANUAL", addedById: ids.alice } })).id;
  });

  const makeInstant = async (communityId: string | null = ids.a, expired = false) => db.instantSession.create({
    data: { createdById: ids.alice, communityId, gameId: ids.game, createdAt: new Date("2026-09-01"), expiresAt: new Date(expired ? "2026-09-01" : "2099-01-01") },
  });
  const makeRoulette = async (communityId: string | null = ids.a, creator = ids.alice) => db.roulette.create({
    data: { createdById: creator, communityId, scheduledAt: new Date("2099-01-01"), deadline: new Date("2026-09-01"), notifiedUserIds: [creator, ids.carol] },
  });
  const makeSession = async (communityId: string | null = ids.a) => db.session.create({
    data: { createdById: ids.alice, communityId, date: new Date("2026-09-01"), status: "SCHEDULED", decidedGameId: ids.game },
  });
  const removeAlice = () => db.membership.update({ where: { communityId_userId: { communityId: ids.a, userId: ids.alice } }, data: { status: "REMOVED" } });

  it("roulette : un ID d’un autre serveur n’autorise ni lecture ni tirage paresseux", async () => {
    const r = await makeRoulette();
    currentUser.mockResolvedValue(await db.user.findUnique({ where: { id: ids.bob } }));
    const page = (await import("@/app/roulette/[id]/page")).default;
    await expect(page({ params: Promise.resolve({ id: r.id }) })).rejects.toThrow("NOT_FOUND");
    expect((await db.roulette.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("OPEN");
    expect(await db.session.count()).toBe(0);
    expect(await db.notificationEvent.count()).toBe(0);
  });

  it("roulette : un membre non invité du même serveur ne déclenche pas le tirage", async () => {
    const r = await makeRoulette(ids.a, ids.carol);
    await db.roulette.update({ where: { id: r.id }, data: { notifiedUserIds: [ids.carol] } });
    currentUser.mockResolvedValue(await db.user.findUnique({ where: { id: ids.alice } }));
    const page = (await import("@/app/roulette/[id]/page")).default;
    await expect(page({ params: Promise.resolve({ id: r.id }) })).rejects.toThrow("NOT_FOUND");
    expect((await db.roulette.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("OPEN");
  });

  it("roulette : un créateur retiré ne peut plus forcer le tirage", async () => {
    const r = await makeRoulette();
    await removeAlice();
    currentUser.mockResolvedValue({ id: ids.alice });
    const form = new FormData(); form.set("rouletteId", r.id);
    await (await import("@/app/roulette/actions")).forceSpinRouletteAction(form);
    expect((await db.roulette.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("OPEN");
    expect(await db.notificationEvent.count()).toBe(0);
  });

  it("roulette : la soirée garde A quand le créateur sélectionne B entre-temps", async () => {
    const r = await makeRoulette(ids.a, ids.carol);
    await db.rouletteEntry.createMany({ data: [ids.alice, ids.carol, ids.bob].map((userId) => ({ rouletteId: r.id, userId, gameId: ids.game })) });
    await db.user.update({ where: { id: ids.carol }, data: { activeCommunityId: ids.b } });
    await roulette.spinRoulette(r.id);
    const result = await db.roulette.findUniqueOrThrow({ where: { id: r.id } });
    const session = await db.session.findUniqueOrThrow({ where: { id: result.resultSessionId! }, include: { invites: true, proposals: { include: { votes: true } } } });
    expect(session.communityId).toBe(ids.a);
    expect(session.invites.map((i) => i.userId)).toEqual([ids.alice]);
    expect(session.proposals.flatMap((p) => p.votes.map((v) => v.userId)).sort()).toEqual([ids.alice, ids.carol].sort());
  });

  it("session instantanée étrangère : refus avant expiration/récompense, sans écritures", async () => {
    const s = await makeInstant(ids.a, true);
    await db.instantSessionPresenceInterval.create({ data: { instantSessionId: s.id, userId: ids.alice, startedAt: new Date("2026-09-01") } });
    expect(await instant.getInstantSessionView(s.id, ids.bob)).toBeNull();
    expect(await instant.joinInstantSession(s.id, ids.bob)).toEqual({ ok: false, reason: "not_found" });
    expect((await db.instantSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("ACTIVE");
    expect(await db.instantSessionPresenceInterval.count({ where: { endedAt: null } })).toBe(1);
    expect(await db.xpEvent.count()).toBe(0);
    expect(await db.notificationEvent.count()).toBe(0);
  });

  it("session instantanée : créateur retiré refusé pour lecture, changement et fin", async () => {
    const s = await makeInstant(); await removeAlice();
    expect(await instant.getInstantSessionView(s.id, ids.alice)).toBeNull();
    expect(await instant.changeInstantSessionGame(s.id, ids.alice, ids.game)).toEqual({ ok: false, reason: "not_found" });
    expect(await instant.endInstantSession(s.id, ids.alice, "creator_left")).toEqual({ ok: false, reason: "not_found" });
    expect((await db.instantSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("ACTIVE");
  });

  it("création instantanée : invités de A seulement et refus sans communauté", async () => {
    const result = await instant.createInstantSession({ creatorId: ids.alice, gameId: ids.game, notifiedUserIds: [ids.alice, ids.bob, ids.carol, ids.carol] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("création attendue");
    expect(result.instantSession.communityId).toBe(ids.a);
    expect(result.instantSession.notifiedUserIds).toEqual([ids.carol]);
    expect(await instant.createInstantSession({ creatorId: ids.none, gameId: ids.game, notifiedUserIds: [] })).toEqual({ ok: false, reason: "not_found" });
    expect(await db.instantSession.count()).toBe(1);
  });

  it("liste instantanée : le membre A+B voit le serveur sélectionné, sans traiter B", async () => {
    const a = await makeInstant(ids.a);
    const b = await makeInstant(ids.b, true);
    expect((await instant.listActiveInstantSessions(ids.carol)).map((s) => s.id)).toEqual([a.id]);
    expect((await db.instantSession.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("ACTIVE");
  });

  it("NULL historique n’est accessible qu’aux membres de default", async () => {
    const s = await makeInstant(null);
    expect(await instant.getInstantSessionView(s.id, ids.bob)).toBeNull();
    expect(await instant.getInstantSessionView(s.id, ids.dave)).not.toBeNull();
  });

  it("un serveur suspendu n’est pas traité par les crons", async () => {
    const s = await makeInstant(ids.a, true); const r = await makeRoulette();
    await db.community.update({ where: { id: ids.a }, data: { status: "SUSPENDED" } });
    expect(await instant.settleAllDueInstantSessions()).toEqual([]);
    await roulette.processOpenRoulettes();
    expect((await db.instantSession.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("ACTIVE");
    expect((await db.roulette.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("OPEN");
  });

  it("défis : une même semaine par serveur et concurrence idempotente", async () => {
    const [a1, a2, b] = await Promise.all([weekly.getCurrentWeeklyChallenge(ids.a), weekly.getCurrentWeeklyChallenge(ids.a), weekly.getCurrentWeeklyChallenge(ids.b)]);
    expect(a1.id).toBe(a2.id); expect(a1.id).not.toBe(b.id);
    expect(await db.weeklyChallenge.count()).toBe(2);
    expect(await weekly.getCurrentWeeklyChallengeForViewer(ids.none)).toBeNull();
    expect((await weekly.getCurrentWeeklyChallengeForViewer(ids.carol))?.id).toBe(a1.id);
  });

  it("compléter un défi n’écrit jamais dans le défi de B", async () => {
    const a = await weekly.getCurrentWeeklyChallenge(ids.a), b = await weekly.getCurrentWeeklyChallenge(ids.b);
    const session = await makeSession();
    await db.session.update({ where: { id: session.id }, data: { status: "DONE", date: a.weekStart } });
    expect((await weekly.completeWeeklyChallenge(session.id)).completed).toBe(true);
    expect((await db.weeklyChallenge.findUniqueOrThrow({ where: { id: b.id } })).completedAt).toBeNull();
  });

  it("saisons : même numéro par serveur ; aucun reset global sous isolation avant PR B", async () => {
    await Promise.all([seasons.ensureActiveSeasonExists(ids.a), seasons.ensureActiveSeasonExists(ids.b)]);
    expect((await db.season.findMany()).map((s) => s.number)).toEqual([1, 1]);
    await db.season.updateMany({ data: { endDate: new Date("2026-01-01") } });
    await seasons.finalizeSeasonIfDue();
    expect(await db.user.count({ where: { xpTotal: 100 } })).toBe(5);
    expect(await db.seasonSnapshot.count()).toBe(0);
    expect(await seasons.getSeasonProgress(ids.none)).toBeNull();
  });

  it("récap : même mois par serveur, lu dans le serveur actif et inaccessible sans membership", async () => {
    await db.monthlyRecap.createMany({ data: [ids.a, ids.b].map((communityId, i) => ({ communityId, year: 2026, month: 9, data: { sessionsPlayed: i + 1 } })) });
    expect((await recap.getMonthlyRecap(2026, 9, ids.carol))?.sessionsPlayed).toBe(1);
    await db.user.update({ where: { id: ids.carol }, data: { activeCommunityId: ids.b } });
    expect((await recap.getMonthlyRecap(2026, 9, ids.carol))?.sessionsPlayed).toBe(2);
    expect(await recap.getMonthlyRecap(2026, 9, ids.none)).toBeNull();
  });

  it("résumés : awards, pronostics et paris restent isolés après la purge de leur soirée", async () => {
    const session = await makeSession();
    const category = await db.superlativeCategory.create({ data: { name: "MVP", icon: "X", xpReward: 1, modifiedById: ids.alice } });
    await db.superlativeAward.create({ data: { communityId: ids.a, sessionId: session.id, categoryId: category.id, winnerUserId: ids.carol, voteCount: 2 } });
    await db.pronostic.create({ data: { communityId: ids.a, sessionId: session.id, voterId: ids.carol, predictedUserId: ids.alice } });
    await db.xpBet.create({ data: { communityId: ids.a, sessionId: session.id, voterId: ids.carol, targetUserId: ids.alice, amount: 10 } });
    await db.session.delete({ where: { id: session.id } });
    const scopedA = await scope.getActiveScopedPrisma(ids.carol);
    expect(await scopedA.superlativeAward.count()).toBe(1);
    await db.user.update({ where: { id: ids.carol }, data: { activeCommunityId: ids.b } });
    const scopedB = await scope.getActiveScopedPrisma(ids.carol);
    expect(await scopedB.superlativeAward.count()).toBe(0);
    expect(await scopedB.pronostic.count()).toBe(0);
    expect(await scopedB.xpBet.count()).toBe(0);
    expect((await db.superlativeAward.findFirstOrThrow()).communityId).toBe(ids.a);
  });

  it("pronostic et pari par ID étranger : aucune ligne ni débit", async () => {
    const session = await makeSession();
    expect(await (await import("./pronostics")).submitPronostic(session.id, ids.bob, ids.alice)).toBe(false);
    expect(await (await import("./xp-bets")).placeBet(session.id, ids.bob, ids.alice, 10)).toBe(false);
    expect(await db.pronostic.count()).toBe(0); expect(await db.xpBet.count()).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: ids.bob } })).xpTotal).toBe(100);
  });

  it("tournoi : un créateur retiré ne peut annuler ni supprimer", async () => {
    const t = await db.tournament.create({ data: { name: "T", createdById: ids.alice, communityId: ids.a, gameId: ids.game, maxPlayers: 4, status: "IN_PROGRESS" } });
    await removeAlice();
    const lib = await import("./tournaments");
    expect(await lib.cancelTournament(t.id, ids.alice)).toEqual({ ok: false, reason: "not_found" });
    expect(await lib.deleteTournament(t.id, ids.alice)).toEqual({ ok: false, reason: "not_found" });
    expect((await db.tournament.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("IN_PROGRESS");
    expect(await db.notificationEvent.count()).toBe(0);
  });

  it("appartenance relue à la livraison : départ et suspension coupent les invitations", async () => {
    expect(await isolation.isMemberOfCommunity(ids.alice, ids.a)).toBe(true);
    await removeAlice(); expect(await isolation.isMemberOfCommunity(ids.alice, ids.a)).toBe(false);
    await db.community.update({ where: { id: ids.a }, data: { status: "SUSPENDED" } });
    expect(await isolation.isMemberOfCommunity(ids.carol, ids.a)).toBe(false);
  });

  it.each(["removed", "suspended"])("MP différés : %s coupe SEND et EDIT avant tout appel Discord", async (state) => {
    vi.stubEnv("DISCORD_DM_ROULETTE_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_INSTANT_SESSION_INVITE_ENABLED", "true");
    const r = await makeRoulette();
    const i = await makeInstant();
    const rouletteDm = await import("./roulette-dm");
    const instantDm = await import("./instant-session-announce");
    await rouletteDm.enqueueRouletteDirectMessages(r.id, "created", [ids.alice]);
    await instantDm.enqueueInstantSessionInvites(i.id, [ids.alice]);
    const rows = await db.notificationDelivery.findMany({ include: { event: true } });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const resolver = row.event.category === "ROULETTE" ? rouletteDm.rouletteDmResolver : instantDm.instantSessionInviteResolver;
      expect((await resolver.resolve({ event: row.event, delivery: { ...row, targetMessage: null }, now: new Date() })).eligible).toBe(true);
    }
    if (state === "removed") await removeAlice();
    else await db.community.update({ where: { id: ids.a }, data: { status: "SUSPENDED" } });
    for (const row of rows) {
      const resolver = row.event.category === "ROULETTE" ? rouletteDm.rouletteDmResolver : instantDm.instantSessionInviteResolver;
      for (const operation of ["SEND", "EDIT"] as const) {
        expect(await resolver.resolve({ event: row.event, delivery: { ...row, operation, targetMessage: null }, now: new Date() }))
          .toEqual({ eligible: false, reason: "preference_declined" });
      }
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("flags OFF : comportement historique global et création sans membership", async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    const a = await makeInstant(ids.a), b = await makeInstant(ids.b);
    expect((await instant.listActiveInstantSessions(ids.none)).map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
    expect((await instant.createInstantSession({ creatorId: ids.none, gameId: ids.game, notifiedUserIds: [ids.bob] })).ok).toBe(true);
    expect(await isolation.isMemberOfCommunity(ids.none, ids.a)).toBe(true);
  });
});
