import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Plafond de 10 soirées créées par personne et par jour (audit 1.14, décision du propriétaire) — preuve sur un
 * PostgreSQL réel : le compteur partagé (`RateLimitWindow`) fait foi, la limite en mémoire est neutralisée ici pour
 * simuler plusieurs instances Vercel. La 11ᵉ soirée du jour est refusée AVANT toute écriture (ni soirée, ni
 * notification, ni XP), le compteur reste à 10, un rejeu de la même intention ne consomme rien, une série récurrente
 * compte pour une soirée, la commande Discord `/soiree creer` partage le même compteur.
 *
 * Nécessite `TEST_DATABASE_URL` (PostgreSQL local isolé) — suite entièrement SKIPPÉE si absente.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((location: string) => {
    throw new Error(`REDIRECT:${location}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Plusieurs instances : la limite en mémoire ne bloque jamais, seule la base compte.
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true, RATE_LIMIT_ERROR_KEY: "rate_limited" }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (!TEST_DATABASE_URL) return { prisma: {} as unknown };
  return { prisma: new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) };
});

if (!TEST_DATABASE_URL) {
  console.warn(
    "[session-daily-limit.integration.test] TEST_DATABASE_URL absente — suite SKIPPÉE. " +
      "Le plafond de 10 soirées par jour n'est PAS validé sur PostgreSQL."
  );
}

// Jour UTC fixe (midi) : la fenêtre du compteur ne change pas pendant le test.
const NOON = new Date("2026-11-23T12:00:00.000Z");
const futureDate = (days: number, from: Date = new Date()) => new Date(from.getTime() + days * 86_400_000).toISOString().slice(0, 10);
const REDIRECT_TO_SESSION = /^REDIRECT:\/sessions\/[^/?]+/;
const QUOTA_REDIRECT = "REDIRECT:/sessions?error=quota_soirees_jour";

describe.skipIf(!TEST_DATABASE_URL)("plafond de 10 soirées par jour (intégration Postgres isolée)", () => {
  let db: import("@prisma/client").PrismaClient;
  let currentUserMock: ReturnType<typeof vi.fn>;
  let createSession: typeof import("./session-lifecycle").createSession;
  let createSessionFromDiscord: typeof import("@/lib/discord-session-commands").createSessionFromDiscord;
  let defaultCommunityId: string;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as import("@prisma/client").PrismaClient;
    currentUserMock = vi.fn();
    vi.doMock("@/lib/current-user", () => ({ getCurrentUser: currentUserMock }));
    ({ createSession } = await import("./session-lifecycle"));
    ({ createSessionFromDiscord } = await import("@/lib/discord-session-commands"));
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOON);
    // Bot activé : une création réussie enfile des notifications, un refus ne doit en écrire AUCUNE.
    vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "guild-1");
    vi.stubEnv("DISCORD_BOT_SESSION_CHANNEL_ID", "chan-sessions");
    vi.stubEnv("SESSION_SERIES_CANCEL_ENABLED", "false");
    vi.stubEnv("NOTIFICATION_EXECUTOR_ENABLED", "false");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Réseau interdit dans cette intégration."); }));
    await db.$executeRawUnsafe(
      `TRUNCATE "NotificationDelivery", "NotificationEvent", "SessionInvite", "Vote", "Proposal", "Session", "XpEvent", "CreationIntent", "RateLimitWindow", "Game", "User" CASCADE`
    );
    await db.community.upsert({ where: { slug: "default" }, update: { status: "ACTIVE" }, create: { slug: "default", name: "default", status: "ACTIVE" } });
    (await import("@/lib/default-community")).resetDefaultCommunityIdCache();
    defaultCommunityId = await (await import("@/lib/default-community")).getDefaultCommunityId();
    vi.clearAllMocks();
    redirectMock.mockImplementation((location: string) => {
      throw new Error(`REDIRECT:${location}`);
    });
  });

  let counter = 0;
  async function makeUser() {
    counter += 1;
    const id = `quota-user-${counter}`;
    const user = await db.user.create({ data: { discordId: id, discordName: id } });
    await db.membership.create({ data: { userId: user.id, communityId: defaultCommunityId, status: "ACTIVE" } });
    return user;
  }

  function formData(fields: Record<string, string | string[]>, key: string = crypto.randomUUID()): FormData {
    const fd = new FormData();
    fd.set("creationKey", key);
    for (const [name, value] of Object.entries(fields)) {
      if (Array.isArray(value)) for (const v of value) fd.append(name, v);
      else fd.set(name, value);
    }
    return fd;
  }

  const dailyCount = async (userId: string) =>
    (await db.rateLimitWindow.findMany({ where: { key: `dailyCreateSession:${userId}` } })).map((row) => row.count);

  it("la 11ᵉ soirée du jour est refusée : message clair, aucune soirée, aucune notification, aucun XP ; une autre personne n'est pas touchée ; le lendemain repart", async () => {
    const creator = await makeUser();
    const guest = await makeUser();
    const other = await makeUser();
    currentUserMock.mockResolvedValue(creator);

    for (let day = 1; day <= 10; day++) {
      await expect(
        createSession(formData({ date: futureDate(day), time: "20:00", notifyUserId: [guest.id] }))
      ).rejects.toThrow(REDIRECT_TO_SESSION);
    }
    expect(await db.session.count({ where: { createdById: creator.id } })).toBe(10);
    expect(await dailyCount(creator.id)).toEqual([10]);

    const before = {
      sessions: await db.session.count(),
      invites: await db.sessionInvite.count(),
      events: await db.notificationEvent.count(),
      deliveries: await db.notificationDelivery.count(),
      xp: await db.xpEvent.count(),
      intents: await db.creationIntent.count(),
    };
    expect(before.deliveries).toBeGreaterThan(0);

    await expect(
      createSession(formData({ date: futureDate(11), time: "20:00", notifyUserId: [guest.id] }))
    ).rejects.toThrow(QUOTA_REDIRECT);

    expect({
      sessions: await db.session.count(),
      invites: await db.sessionInvite.count(),
      events: await db.notificationEvent.count(),
      deliveries: await db.notificationDelivery.count(),
      xp: await db.xpEvent.count(),
      intents: await db.creationIntent.count(),
    }).toEqual(before);
    // Le refus annule la transaction entière : le compteur ne dérive pas au-delà du plafond.
    expect(await dailyCount(creator.id)).toEqual([10]);

    // Par personne : une autre personne crée normalement.
    currentUserMock.mockResolvedValue(other);
    await expect(createSession(formData({ date: futureDate(1), time: "20:00" }))).rejects.toThrow(REDIRECT_TO_SESSION);

    // Jour UTC suivant : nouvelle fenêtre, l'ancienne ligne est supprimée.
    vi.setSystemTime(new Date("2026-11-24T00:30:00.000Z"));
    currentUserMock.mockResolvedValue(creator);
    await expect(createSession(formData({ date: futureDate(1, new Date("2026-11-24T00:30:00.000Z")), time: "20:00" }))).rejects.toThrow(REDIRECT_TO_SESSION);
    expect(await dailyCount(creator.id)).toEqual([1]);
  }, 60_000);

  it("un rejeu de la même intention ne consomme pas le plafond ; une série récurrente compte pour une soirée", async () => {
    const creator = await makeUser();
    currentUserMock.mockResolvedValue(creator);
    const key = crypto.randomUUID();
    const fields = { date: futureDate(5), time: "20:00" };
    await expect(createSession(formData(fields, key))).rejects.toThrow(REDIRECT_TO_SESSION);
    await expect(createSession(formData(fields, key))).rejects.toThrow(REDIRECT_TO_SESSION);
    expect(await db.session.count({ where: { createdById: creator.id } })).toBe(1);
    expect(await dailyCount(creator.id)).toEqual([1]);

    await expect(
      createSession(formData({ date: futureDate(10), time: "20:00", recurrence: "weekly", recurrenceCount: "4" }))
    ).rejects.toThrow(REDIRECT_TO_SESSION);
    expect(await db.session.count({ where: { createdById: creator.id } })).toBe(5);
    expect(await dailyCount(creator.id)).toEqual([2]);
  }, 60_000);

  it("la commande Discord /soiree creer partage le même compteur que le site : 8 + 2 = 10, puis refus des deux côtés", async () => {
    const creator = await makeUser();
    currentUserMock.mockResolvedValue(creator);
    await db.game.create({ data: { name: "Valheim", source: "MANUAL", addedById: creator.id } });
    for (let day = 1; day <= 8; day++) {
      await expect(createSession(formData({ date: futureDate(day), time: "20:00" }))).rejects.toThrow(REDIRECT_TO_SESSION);
    }
    for (let day = 20; day <= 21; day++) {
      const created = await createSessionFromDiscord({
        userId: creator.id, communityId: defaultCommunityId, gameQuery: "Valheim", dateStr: futureDate(day), timeStr: "21:00", places: null,
      });
      expect(created.status).toBe("CREATED");
    }
    expect(await dailyCount(creator.id)).toEqual([10]);
    const sessionsBefore = await db.session.count();

    const refusedDiscord = await createSessionFromDiscord({
      userId: creator.id, communityId: defaultCommunityId, gameQuery: "Valheim", dateStr: futureDate(22), timeStr: "21:00", places: null,
    });
    expect(refusedDiscord.status).toBe("DAILY_LIMIT");
    await expect(createSession(formData({ date: futureDate(23), time: "20:00" }))).rejects.toThrow(QUOTA_REDIRECT);
    expect(await db.session.count()).toBe(sessionsBefore);
    expect(await dailyCount(creator.id)).toEqual([10]);
  }, 60_000);
});
