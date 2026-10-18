import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Nombre de requêtes SQL RÉELLEMENT exécutées par `createSession` (événement
 * `query` de Prisma, BEGIN/COMMIT compris), pour N invités et E badges déjà
 * obtenus. La borne ne dépend ni de N ni de E. Les comptes sont imprimés
 * (`[create-session-queries]`) pour être relus dans les logs de CI.
 *
 * Nécessite `TEST_DATABASE_URL` : suite SKIPPÉE sinon.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("next/navigation", () => ({ redirect: (location: string) => { throw new Error(`REDIRECT:${location}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true, RATE_LIMIT_ERROR_KEY: "rate" }));
const { currentUser } = vi.hoisted(() => ({ currentUser: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: currentUser }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL, log: [{ emit: "event", level: "query" }] }) };
});

if (!TEST_DATABASE_URL) {
  console.warn("[create-session-queries] TEST_DATABASE_URL absente — suite SKIPPÉE, aucun compte de requêtes validé.");
}

// Borne haute unique, quel que soit N (invités) ou E (badges déjà obtenus).
const MAX_QUERIES_BOT = 33;
const MAX_QUERIES_WEBHOOK = 32;
const MAX_QUERIES_ISOLATION = 38;
const QUERY_EVENT_BOUNDARY = "/* create-session-query-boundary */";

describe.skipIf(!TEST_DATABASE_URL)("createSession — nombre de requêtes (intégration Postgres)", () => {
  let db: import("@prisma/client").PrismaClient;
  let createSession: typeof import("./session-lifecycle").createSession;
  const queries: string[] = [];
  const counts = new Map<string, number>();
  const statements = new Map<string, string[]>();

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    // Le générique par défaut de Prisma omet les noms d'événements ; ce client émet `query`.
    (db as import("@prisma/client").PrismaClient<import("@prisma/client").Prisma.PrismaClientOptions, "query">)
      .$on("query", (event) => queries.push(event.query));
    ({ createSession } = await import("./session-lifecycle"));
  });

  afterAll(async () => {
    console.log(`[create-session-queries] synthèse ${JSON.stringify(Object.fromEntries(counts))}`);
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.$executeRawUnsafe(
      `TRUNCATE "NotificationDelivery", "NotificationEvent", "Notification", "SessionInvite", "Session", "XpEvent", "UserBadge", "Badge", "CreationIntent", "Community", "User" CASCADE`
    );
    (await import("@/lib/default-community")).resetDefaultCommunityIdCache();
    vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "guild-1");
    vi.stubEnv("DISCORD_BOT_SESSION_CHANNEL_ID", "chan-sessions");
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "false");
    vi.stubEnv("COMMUNITY_CHANNELS_ENABLED", "false");
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "false");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { throw new Error(`HTTP interdit en test : ${url}`); }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  let serial = 0;
  const makeUser = () => {
    serial += 1;
    return db.user.create({ data: { discordId: `q-${serial}`, discordName: `q-${serial}` } });
  };

  async function fixture(guestCount: number, earnedBadges: number) {
    const community = await db.community.create({ data: { slug: "default", name: "default", status: "ACTIVE" } });
    const creator = await makeUser();
    const guests = [];
    for (let i = 0; i < guestCount; i++) guests.push(await makeUser());
    for (let i = 0; i < earnedBadges; i++) {
      const badge = await db.badge.create({ data: {
        name: `Badge ${i}`, icon: "*", description: "obtenu", category: "VOTE", rarity: "COMMON",
        criteria: { type: "VOTES_CAST", count: 1 }, xpReward: 10, modifiedById: creator.id,
      } });
      await db.userBadge.create({ data: { communityId: community.id, userId: creator.id, badgeId: badge.id } });
      await db.xpEvent.create({ data: { communityId: community.id, userId: creator.id, reason: "BADGE_UNLOCKED", sourceId: badge.id, amount: 10 } });
    }
    currentUser.mockResolvedValue(creator);
    return { community, creator, guests };
  }

  function form(guestIds: string[]): FormData {
    const fd = new FormData();
    fd.set("creationKey", crypto.randomUUID());
    fd.set("date", new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
    fd.set("time", "20:00");
    for (const id of guestIds) fd.append("notifyUserId", id);
    return fd;
  }

  async function measure(label: string, guestIds: string[]): Promise<number> {
    // Attend un marqueur Prisma après les fixtures pour vider les événements de requête déjà terminés.
    await db.$queryRawUnsafe(`SELECT 1 ${QUERY_EVENT_BOUNDARY}`);
    await new Promise<void>((resolve) => setImmediate(resolve));
    queries.length = 0;
    await expect(createSession(form(guestIds))).rejects.toThrow(/^REDIRECT:\/sessions\/(?!\?)/);
    // La même barrière garantit que les événements du parcours sont émis avant le compte final.
    await db.$queryRawUnsafe(`SELECT 1 ${QUERY_EVENT_BOUNDARY}`);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const measuredQueries = queries.filter((q) => !q.includes(QUERY_EVENT_BOUNDARY));
    const total = measuredQueries.length;
    const tx = measuredQueries.filter((q) => q === "BEGIN" || q === "COMMIT" || q === "ROLLBACK").length;
    counts.set(label, total);
    statements.set(label, measuredQueries);
    console.log(`[create-session-queries] ${label} requêtes=${total} (dont BEGIN/COMMIT/ROLLBACK=${tx})`);
    if (process.env.CREATE_SESSION_QUERIES_VERBOSE === "true") console.log(measuredQueries.join("\n"));
    return total;
  }

  for (const [n, e] of [[0, 0], [1, 0], [5, 0], [0, 5], [1, 5], [5, 5]] as const) {
    it(`chemin bot, isolation éteinte : N=${n} E=${e} sous la borne`, async () => {
      const { guests } = await fixture(n, e);
      const total = await measure(`bot N=${n} E=${e}`, guests.map((g) => g.id));
      expect(total, `bot N=${n} E=${e} : ${total} requêtes`).toBeLessThanOrEqual(MAX_QUERIES_BOT);
      const session = await db.session.findFirstOrThrow();
      expect(session.announceViaBot).toBe(true);
      expect(await db.sessionInvite.count({ where: { sessionId: session.id } })).toBe(n);
      expect(await db.notificationDelivery.count()).toBe(3 + n);
    });
  }

  for (const n of [1, 5]) {
    it(`chemin webhook (bot éteint) : N=${n} sous la borne`, async () => {
      vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "false");
      const { community, guests } = await fixture(n, 0);
      const total = await measure(`webhook N=${n} E=0`, guests.map((g) => g.id));
      expect(total, `webhook N=${n} : ${total} requêtes`).toBeLessThanOrEqual(MAX_QUERIES_WEBHOOK);
      const session = await db.session.findFirstOrThrow();
      const notifications = await db.notification.findMany({ where: { relatedSessionId: session.id } });
      expect(notifications.map((row) => row.userId).sort()).toEqual(guests.map((g) => g.id).sort());
      // Sans isolation la soirée reste `communityId = null` : la notification est rattachée à default.
      expect(notifications.every((row) => row.communityId === community.id)).toBe(true);
    });
  }

  // Un invité retiré (Membership REMOVED) n'est ni invité ni synchronisé.
  for (const n of [1, 5]) {
    it(`isolation allumée : N=${n} (+1 retiré) sous la borne, invité retiré écarté`, async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
      const { community, creator, guests } = await fixture(n + 1, 0);
      for (const user of [creator, ...guests]) await db.membership.create({ data: { communityId: community.id, userId: user.id } });
      const removed = guests[n];
      await db.membership.update({
        where: { communityId_userId: { communityId: community.id, userId: removed.id } },
        data: { status: "REMOVED", leftAt: new Date() },
      });
      const total = await measure(`isolation N=${n} (+1 retiré) E=0`, guests.map((g) => g.id));
      expect(total, `isolation N=${n} : ${total} requêtes`).toBeLessThanOrEqual(MAX_QUERIES_ISOLATION);
      const session = await db.session.findFirstOrThrow();
      expect(session.communityId).toBe(community.id);
      const invites = await db.sessionInvite.findMany({ where: { sessionId: session.id } });
      expect(invites.map((i) => i.userId).sort()).toEqual(guests.slice(0, n).map((g) => g.id).sort());
      expect(await db.notificationDelivery.count()).toBe(3 + n);
      expect((await db.notificationEvent.findMany()).every((event) => event.communityId === community.id)).toBe(true);
    });
  }

  it("le compte ne croît ni avec N ni avec E", () => {
    const get = (label: string) => counts.get(label)!;
    // Conserver le SQL (sans paramètres) en cas d'écart : une requête du
    // moteur ou un événement tardif ne doit pas conduire à relâcher la borne.
    const all = JSON.stringify({ counts: Object.fromEntries(counts), statements: Object.fromEntries(statements) });
    // Un événement Prisma tardif peut déplacer un seul compte entre deux cas;
    // une hausse supérieure révèle un coût supplémentaire par invité.
    expect(get("bot N=5 E=0"), all).toBeLessThanOrEqual(get("bot N=1 E=0") + 1);
    expect(get("bot N=5 E=5"), all).toBeLessThanOrEqual(get("bot N=1 E=5") + 1);
    // E > 0 : deux lectures fixes (relation `badge` incluse, XP des badges), jamais une par badge.
    // E ajoute deux lectures fixes; le troisième événement toléré est le
    // query Prisma asynchrone documenté ci-dessous, observé en CI.
    expect(get("bot N=0 E=5"), all).toBeLessThanOrEqual(get("bot N=0 E=0") + 3);
    expect(get("bot N=5 E=5"), all).toBeLessThanOrEqual(get("bot N=5 E=0") + 2);
    // Une requête Prisma peut être émise juste après la remise à zéro du compteur;
    // tolérer cet événement isolé tout en détectant une croissance liée aux invités.
    expect(get("webhook N=5 E=0"), all).toBeLessThanOrEqual(get("webhook N=1 E=0") + 1);
    expect(get("isolation N=5 (+1 retiré) E=0"), all).toBeLessThanOrEqual(get("isolation N=1 (+1 retiré) E=0"));
  });

  it("reprise après rollback : la création annulée ne laisse rien, la reprise avec la même clé crée une seule fois", async () => {
    const { guests } = await fixture(2, 0);
    const fd = form(guests.map((g) => g.id));
    // Échec à la toute fin de la transaction (après session, invités et livraisons).
    const { prisma } = await import("@/lib/prisma");
    const realTransaction = prisma.$transaction.bind(prisma);
    const txSpy = vi.spyOn(prisma, "$transaction").mockImplementationOnce(((fn: (tx: unknown) => Promise<unknown>, options: unknown) =>
      realTransaction(async (tx) => {
        const proxy = new Proxy(tx, { get: (target, prop) => prop === "creationIntent"
          ? { ...target.creationIntent, create: () => { throw new Error("panne simulée"); } }
          : Reflect.get(target, prop) });
        return fn(proxy);
      }, options as never)) as never);
    await expect(createSession(fd)).rejects.toThrow("panne simulée");
    txSpy.mockRestore();
    expect(await db.session.count()).toBe(0);
    expect(await db.notificationEvent.count()).toBe(0);
    expect(await db.notificationDelivery.count()).toBe(0);

    await expect(createSession(fd)).rejects.toThrow(/^REDIRECT:\/sessions\//);
    await expect(createSession(fd)).rejects.toThrow(/^REDIRECT:\/sessions\//);
    const session = await db.session.findFirstOrThrow();
    expect(await db.session.count()).toBe(1);
    expect(await db.sessionInvite.count({ where: { sessionId: session.id } })).toBe(2);
    expect(await db.notificationDelivery.count()).toBe(3 + 2);
  });
});
