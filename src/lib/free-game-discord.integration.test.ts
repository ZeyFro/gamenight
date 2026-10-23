import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Offres gratuites : producteur → NotificationEvent/Delivery réels (Postgres
 * isolé) → executor + DISPATCH_RESOLVER réels → Discord HTTP SIMULÉ (`fetch`
 * mocké, aucun appel réel). Le flux GamerPower est un double : seule la
 * plomberie Discord/executor est exercée ici, pas la disponibilité réelle en
 * boutique.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const gp = vi.hoisted(() => ({ list: vi.fn(), status: vi.fn() }));

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
vi.mock("@/lib/gamerpower-free-games", () => ({
  listAutomaticFreeGameOffers: gp.list,
  getAutomaticFreeGameOfferStatus: gp.status,
}));

const GUILD = "111111111111111111";
const CHANNEL = "222222222222222222";
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const OFFER = { id: "gamerpower-steam-42", store: "STEAM", title: "Portal", storeUrl: "https://store.steampowered.com/app/620/Portal/", source: "gamerpower" };

describe.skipIf(!TEST_DATABASE_URL)("jeux gratuits : producteur → executor → Discord simulé", () => {
  let db: import("@prisma/client").PrismaClient;
  let posts: Array<Record<string, unknown>>;
  let postStatus: number[];
  const run = async () => {
    const { runExecutorBatch } = await import("./notification-executor");
    const { DISPATCH_RESOLVER } = await import("./notification-dispatch");
    return runExecutorBatch({ resolver: DISPATCH_RESOLVER, owner: "test", now: new Date() });
  };
  const produce = async () => (await import("./free-game-discord")).enqueueFreeGameAnnouncements();
  const makeDue = () => db.notificationDelivery.updateMany({ where: { status: "PENDING" }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });

  beforeAll(async () => { db = (await import("@/lib/prisma")).prisma as typeof db; });
  afterAll(async () => { await db.$disconnect(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "NotificationEvent", "Community", "User" CASCADE');
    vi.resetAllMocks();
    for (const k of ["FREE_GAME_FEED_ENABLED", "COMMUNITY_CHANNELS_ENABLED", "DISCORD_BOT_FREE_GAME_ANNOUNCE_ENABLED", "NOTIFICATION_EXECUTOR_ENABLED"]) vi.stubEnv(k, "true");
    vi.stubEnv("DISCORD_BOT_TOKEN", "simulated-bot");
    vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/123/forbidden");
    gp.list.mockResolvedValue([OFFER]);
    gp.status.mockResolvedValue("active");
    await db.community.create({
      data: {
        id: "c1", slug: "serveur-a", name: "A", status: "ACTIVE", discordGuildId: GUILD, freeGamesEnabled: true,
        channelConfigs: { create: { category: "FREE_GAMES", discordChannelId: CHANNEL, enabled: true } },
      },
    });
    posts = []; postStatus = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = new URL(url).pathname.replace("/api/v10", "");
      const method = init.method ?? "GET";
      if (path === `/channels/${CHANNEL}` && method === "GET") return json(200, { id: CHANNEL, guild_id: GUILD, type: 0 });
      if (path === `/channels/${CHANNEL}/messages` && method === "POST") {
        posts.push(JSON.parse(init.body as string));
        const status = postStatus.shift() ?? 200;
        return status === 200 ? json(200, { id: `m${posts.length}`, channel_id: CHANNEL }) : json(status, { message: "boom" });
      }
      throw new Error("HTTP inattendu (aucun Discord réel autorisé): " + method + " " + url);
    }));
  });

  it("envoie une annonce sans mention, puis rien de plus à la relance du producteur et de l'executor", async () => {
    await expect(produce()).resolves.toMatchObject({ enqueued: 1 });
    await expect(run()).resolves.toMatchObject({ sent: 1, failed: 0 });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ allowed_mentions: { parse: [] } });
    expect(String(posts[0].content)).toContain("Portal");
    expect(String(posts[0].content)).toContain("https://store.steampowered.com/app/620/Portal/");

    await produce();
    await run();
    expect(posts).toHaveLength(1);
    expect(await db.notificationDelivery.count({ where: { status: "SENT" } })).toBe(1);
  });

  it("n'envoie rien si l'offre a expiré entre la mise en file et l'envoi", async () => {
    await produce();
    gp.status.mockResolvedValue("expired");
    await run();
    expect(posts).toHaveLength(0);
    expect(await db.notificationDelivery.count({ where: { status: "SENT" } })).toBe(0);
  });

  it("reporte sans envoyer si la source est indisponible, puis envoie une seule fois à la reprise", async () => {
    await produce();
    gp.status.mockResolvedValue("unavailable");
    await expect(run()).resolves.toMatchObject({ sent: 0, retrying: 1 });
    expect(posts).toHaveLength(0);

    gp.status.mockResolvedValue("active");
    await makeDue();
    await expect(run()).resolves.toMatchObject({ sent: 1 });
    expect(posts).toHaveLength(1);
  });

  it("réessaie après une erreur Discord 500 et n'envoie qu'un message au final", async () => {
    await produce();
    postStatus = [500];
    await expect(run()).resolves.toMatchObject({ sent: 0, retrying: 1 });
    await makeDue();
    await expect(run()).resolves.toMatchObject({ sent: 1 });
    expect(posts).toHaveLength(2);
    expect(await db.notificationDelivery.count({ where: { status: "SENT" } })).toBe(1);
  });

  it("permission refusée (403) : FAILED terminal observable, jamais réessayé ni republié", async () => {
    await produce();
    postStatus = [403];
    await expect(run()).resolves.toMatchObject({ sent: 0, failed: 1 });
    await makeDue();
    await run();
    expect(posts).toHaveLength(1);
    expect(await db.notificationDelivery.count({ where: { status: "FAILED" } })).toBe(1);
  });

  it("rate limit (429) : reprise différée selon Retry-After, un seul message au final", async () => {
    await produce();
    postStatus = [429];
    await expect(run()).resolves.toMatchObject({ sent: 0, retrying: 1 });
    const row = await db.notificationDelivery.findFirstOrThrow();
    expect(row.status).toBe("PENDING");
    expect(row.nextAttemptAt).not.toBeNull();
    await makeDue();
    await expect(run()).resolves.toMatchObject({ sent: 1 });
    expect(await db.notificationDelivery.count({ where: { status: "SENT" } })).toBe(1);
  });

  it("n'envoie rien si la communauté désactive les offres après la mise en file", async () => {
    await produce();
    await db.community.update({ where: { id: "c1" }, data: { freeGamesEnabled: false } });
    await run();
    expect(posts).toHaveLength(0);
  });
});
