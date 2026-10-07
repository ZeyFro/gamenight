import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BOT_CHANNEL_PERMISSIONS, MEMBER_CHANNEL_DENY, MEMBER_CHANNEL_PERMISSIONS } from "./discord-setup-permissions";
import type { SetupChannel } from "./discord-rest";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
const response = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const GUILD = "111111111111111111";
const BOT = "999999999999999999";

describe.skipIf(!TEST_DATABASE_URL)("installation (Postgres isolé et Discord simulé)", () => {
  let db: import("@prisma/client").PrismaClient;
  let setup: typeof import("./community-setup").setupCommunityFromGuild;
  let inventory: SetupChannel[];
  let posts: Array<Record<string, unknown>>;
  let permissions: string;
  let serverName: string;
  let icon: string | null;
  let fail: "429" | "lost" | "lost-absent" | "500" | null;
  let fetchMock: ReturnType<typeof vi.fn>;
  let nextId = 1000;

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as typeof db;
    ({ setupCommunityFromGuild: setup } = await import("./community-setup"));
  });
  afterAll(async () => {
    await db.cronLock.deleteMany({ where: { name: { startsWith: "community-setup" } } });
    await db.$disconnect();
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "Community", "User" CASCADE');
    await db.cronLock.deleteMany({ where: { name: { startsWith: "community-setup" } } });
    vi.stubEnv("DISCORD_BOT_TOKEN", "simulated-token");
    inventory = []; posts = []; permissions = BOT_CHANNEL_PERMISSIONS.toString();
    serverName = "Les vrais potes"; icon = "icon1"; fail = null;
    fetchMock = vi.fn(async (url: string, options: RequestInit) => {
      const path = new URL(url).pathname;
      if (path === "/api/v10/users/@me") return response(200, { id: BOT });
      if (path === "/api/v10/users/@me/guilds") return response(200, [{ id: GUILD, name: serverName, icon }]);
      if (path === `/api/v10/guilds/${GUILD}/members/${BOT}`) return response(200, { roles: ["777"] });
      if (path === `/api/v10/guilds/${GUILD}`) return response(200, { id: GUILD, name: serverName, icon, roles: [
        { id: GUILD, permissions: "0" }, { id: "777", permissions },
      ] });
      if (path === `/api/v10/guilds/${GUILD}/channels`) {
        if (options.method === "GET") return response(200, inventory);
        const channel = JSON.parse(options.body as string);
        posts.push(channel);
        if (channel.topic?.endsWith(":TOURNAMENT") && fail) {
          if (fail === "429") { fail = null; return response(429, { retry_after: 1 }); }
          if (fail === "500") { fail = null; return response(500, {}); }
          if (fail === "lost") inventory.push({ ...channel, id: String(++nextId), guild_id: GUILD });
          fail = null;
          throw new Error("simulated lost response");
        }
        const created = { ...channel, id: String(++nextId), guild_id: GUILD };
        inventory.push(created);
        return response(201, created);
      }
      throw new Error(`Unexpected HTTP (real Discord forbidden): ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  const run = () => setup(GUILD, "888");
  async function community(status: "ACTIVE" | "PENDING" | "SUSPENDED" | "ARCHIVED" | "LEFT" = "ACTIVE", slug = "already-installed") {
    return db.community.create({ data: { slug, name: "Serveur provisoire", discordGuildId: GUILD, status } });
  }

  it("installe catégorie et salons, vrais nom/icône, configs et activation sans Membership", async () => {
    const result = await run();
    expect(result.action).toBe("activated");
    expect(await db.community.findUnique({ where: { id: result.communityId! } })).toMatchObject({ name: serverName, iconHash: icon, status: "ACTIVE" });
    expect(posts.map((p) => p.name)).toEqual(["GameNight", "soirées", "tournois"]);
    expect(posts[1].parent_id).toBe(inventory[0].id);
    expect(posts[1].permission_overwrites).toContainEqual({ id: BOT, type: 1, allow: permissions, deny: "0" });
    expect(posts[1].permission_overwrites).toContainEqual({ id: GUILD, type: 0, allow: MEMBER_CHANNEL_PERMISSIONS.toString(), deny: MEMBER_CHANNEL_DENY.toString() });
    expect(await db.communityChannelConfig.count()).toBe(2);
    expect(await db.membership.count()).toBe(0);
  });
  it("relancer sur ACTIVE complète les salons et ne duplique rien", async () => {
    const c = await community();
    expect((await run()).action).toBe("already_active");
    expect((await run()).action).toBe("already_active");
    expect(posts).toHaveLength(3);
    expect(await db.community.count()).toBe(1);
    expect(await db.communityChannelConfig.count({ where: { communityId: c.id } })).toBe(2);
  });
  it("corrige GameNight historique et actualise renommage/retrait d'icône sans changer le slug", async () => {
    const c = await community("ACTIVE", "default");
    await run();
    serverName = "Nouveau nom réel"; icon = null;
    await run();
    expect(await db.community.findUnique({ where: { id: c.id } })).toMatchObject({ slug: "default", name: serverName, iconHash: null });
    expect(posts).toHaveLength(3);
  });
  it("le cron suivant synchronise aussi le nom historique et l'icône des communautés existantes", async () => {
    const c = await community("ACTIVE", "default");
    const { syncCommunitiesWithBotGuilds } = await import("./community-guild-sync");
    const result = await syncCommunitiesWithBotGuilds({ deadline: new Date(Date.now() + 20_000) });
    expect(result.ok).toBe(true);
    expect(await db.community.findUnique({ where: { id: c.id } })).toMatchObject({ name: serverName, iconHash: icon, slug: "default", status: "ACTIVE" });
  });
  it.each(["PENDING", "LEFT"] as const)("reprend %s sans dupliquer la communauté", async (status) => {
    await community(status);
    expect((await run()).action).toBe("activated");
    expect(await db.community.count()).toBe(1);
  });
  it.each(["SUSPENDED", "ARCHIVED"] as const)("ne contourne jamais %s", async (status) => {
    await community(status);
    expect((await run()).action).toBe("blocked");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("refuse avant toute création et nomme les permissions manquantes", async () => {
    permissions = (BOT_CHANNEL_PERMISSIONS & ~(BigInt(1) << BigInt(36)) & ~(BigInt(1) << BigInt(4))).toString();
    const result = await run();
    expect(result).toMatchObject({ action: "incomplete" });
    expect(result.message).toContain("Gérer les salons");
    expect(result.message).toContain("Créer des fils privés");
    expect(posts).toHaveLength(0);
    expect((await db.community.findFirstOrThrow()).status).toBe("PENDING");
  });
  it("conserve un salon manuel et crée seulement celui qui manque", async () => {
    const c = await community();
    inventory.push({ id: "456", name: "salon-personnalisé", type: 0, guild_id: GUILD, permission_overwrites: [] });
    const saved = await db.communityChannelConfig.create({ data: { communityId: c.id, category: "SESSION", discordChannelId: "456" } });
    await run();
    expect(await db.communityChannelConfig.findUnique({ where: { id: saved.id } })).toEqual(saved);
    expect(posts.map((p) => p.name)).toEqual(["GameNight", "tournois"]);
  });
  it("historique : conserve les salons d'environnement du même guild et rattache default encore sans guild", async () => {
    vi.stubEnv("DISCORD_BOT_GUILD_ID", GUILD);
    vi.stubEnv("DISCORD_BOT_SESSION_CHANNEL_ID", "456");
    vi.stubEnv("DISCORD_BOT_TOURNAMENT_CHANNEL_ID", "457");
    const c = await db.community.create({ data: { slug: "default", name: "GameNight", status: "ACTIVE" } });
    inventory.push({ id: "456", name: "soirées-historiques", type: 0, permission_overwrites: [] });
    inventory.push({ id: "457", name: "tournois-historiques", type: 5, permission_overwrites: [] });
    expect((await run()).action).toBe("already_active");
    expect(posts).toHaveLength(0);
    expect((await db.community.findUniqueOrThrow({ where: { id: c.id } })).name).toBe(serverName);
    expect((await db.communityChannelConfig.findMany({ where: { communityId: c.id } })).map((r) => r.discordChannelId).sort()).toEqual(["456", "457"]);
  });
  it("salon enregistré absent : aucun remplacement ou repli", async () => {
    const c = await community();
    await db.communityChannelConfig.create({ data: { communityId: c.id, category: "SESSION", discordChannelId: "foreign" } });
    expect((await run()).message).toContain("introuvable dans ce serveur");
    expect(posts).toHaveLength(0);
  });
  it("salon désactivé : ne réarme pas la décision administrative", async () => {
    const c = await community();
    inventory.push({ id: "456", name: "manuel", type: 0, permission_overwrites: [] });
    await db.communityChannelConfig.create({ data: { communityId: c.id, category: "SESSION", discordChannelId: "456", enabled: false } });
    expect((await run()).message).toContain("désactivé");
    expect(posts).toHaveLength(0);
  });
  it("vérifie les overwrites existants sans les écraser", async () => {
    const c = await community();
    inventory.push({ id: "456", name: "restreint", type: 0, permission_overwrites: [{ id: BOT, type: 1, allow: "0", deny: "1024" }] });
    await db.communityChannelConfig.create({ data: { communityId: c.id, category: "SESSION", discordChannelId: "456" } });
    expect((await run()).message).toContain("Voir les salons");
    expect(posts).toHaveLength(0);
  });
  it("deux appels concurrents : une seule installation (verrou Postgres réel)", async () => {
    const outcomes = await Promise.all([run(), run(), run()]);
    expect(outcomes.filter((r) => r.action === "activated")).toHaveLength(1);
    expect(outcomes.every((r) => ["activated", "already_active", "in_progress"].includes(r.action))).toBe(true);
    expect(posts).toHaveLength(3);
  });
  it("429 partiel : garde la catégorie et SESSION, complète TOURNAMENT à la relance", async () => {
    fail = "429";
    expect((await run()).action).toBe("incomplete");
    expect(await db.communityChannelConfig.count()).toBe(1);
    expect((await db.community.findFirstOrThrow()).status).toBe("PENDING");
    expect((await run()).action).toBe("activated");
    expect(inventory).toHaveLength(3);
    expect(posts.filter((p) => p.name === "soirées")).toHaveLength(1);
  });
  it("réponse POST perdue : retrouve le salon par topic sans répéter le POST", async () => {
    fail = "lost";
    expect((await run()).action).toBe("incomplete");
    expect((await run()).action).toBe("activated");
    expect(posts).toHaveLength(3);
    expect(await db.cronLock.count({ where: { name: { startsWith: "community-setup-create:" } } })).toBe(0);
  });
  it("échec SQL après création Discord : récupère le salon marqué sans doublon", async () => {
    vi.spyOn(db.communityChannelConfig, "createMany").mockRejectedValueOnce(new Error("simulated SQL outage"));
    await expect(run()).rejects.toThrow("SQL outage");
    expect(inventory).toHaveLength(2);
    expect((await run()).action).toBe("activated");
    expect(posts).toHaveLength(3);
    expect(await db.communityChannelConfig.count()).toBe(2);
  });
  it.each(["lost-absent", "500"] as const)("résultat %s sans salon visible : protège de tout doublon et explique la reprise", async (failure) => {
    fail = failure;
    expect((await run()).action).toBe("incomplete");
    expect((await run()).message).toContain("encore incertaine");
    expect(posts).toHaveLength(3);
    expect(await db.communityChannelConfig.count()).toBe(1);
  });
  it("ancien bail expiré : reprend après arrêt de la précédente exécution", async () => {
    await db.cronLock.create({ data: { name: `community-setup:${GUILD}`, token: "old", lockedAt: new Date(Date.now() - 181_000) } });
    expect((await run()).action).toBe("activated");
  });
  it("identifiant invalide : aucun accès Discord", async () => {
    await expect(setup("invalid", "888")).rejects.toThrow("invalide");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
