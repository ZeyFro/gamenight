import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BOT_CHANNEL_PERMISSIONS } from "./discord-setup-permissions";
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const { currentUser } = vi.hoisted(() => ({ currentUser: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: currentUser }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); }, notFound: () => { throw new Error("404"); } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});
const GUILDS = ["111111111111111111", "222222222222222222"];
type Channel = { id: string; guild_id: string; type: number; name: string; parent_id?: string; topic?: string; permission_overwrites: object[] };
const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });

describe.skipIf(!TEST_DATABASE_URL)("installation → choix → création → annonce/fil (2 serveurs simulés)", () => {
  let db: import("@prisma/client").PrismaClient;
  let channels: Channel[];
  let requests: Array<{ path: string; method: string; body: Record<string, unknown> }>;
  let serial = 0;
  const id = () => String(++serial + 800000);
  beforeAll(async () => { db = (await import("@/lib/prisma")).prisma as typeof db; });
  afterAll(async () => {
    await db.cronLock.deleteMany({ where: { name: { startsWith: "community-setup" } } });
    await db.$disconnect();
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    await db.$executeRawUnsafe('TRUNCATE "Community", "User", "Game", "NotificationEvent" CASCADE');
    await db.cronLock.deleteMany({ where: { name: { startsWith: "community-setup" } } });
    channels = []; requests = [];
    for (const key of ["COMMUNITY_PICKER_ENABLED", "COMMUNITY_CHANNELS_ENABLED", "COMMUNITY_ISOLATION_ENABLED",
      "DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED", "NOTIFICATION_EXECUTOR_ENABLED"]) vi.stubEnv(key, "true");
    vi.stubEnv("DISCORD_BOT_TOKEN", "simulated-bot");
    vi.stubEnv("DISCORD_BOT_GUILD_ID", GUILDS[0]);
    vi.stubEnv("DISCORD_BOT_SESSION_CHANNEL_ID", "historical-session");
    vi.stubEnv("DISCORD_BOT_TOURNAMENT_CHANNEL_ID", "historical-tournament");
    vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/123/simulated-forbidden-fallback");
    vi.stubEnv("DISCORD_DM_SESSION_ENABLED", "false");
    vi.stubEnv("DISCORD_DM_TOURNAMENT_ENABLED", "false");
    vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
      const path = new URL(url).pathname.replace("/api/v10", "");
      const method = options.method ?? "GET";
      const body = options.body ? JSON.parse(options.body as string) : {};
      requests.push({ path, method, body });
      if (path === "/users/@me") return json({ id: "999" });
      const guild = path.match(/^\/guilds\/(\d+)(.*)$/);
      if (guild && GUILDS.includes(guild[1])) {
        const guildId = guild[1], rest = guild[2];
        if (!rest) return json({ id: guildId, name: `Serveur réel ${GUILDS.indexOf(guildId) + 1}`, icon: null,
          roles: [{ id: guildId, permissions: "0" }, { id: "role-bot", permissions: BOT_CHANNEL_PERMISSIONS.toString() }] });
        if (rest === "/members/999") return json({ roles: ["role-bot"] });
        if (rest === "/channels") {
          if (method === "GET") return json(channels.filter((c) => c.guild_id === guildId));
          const channel = { ...body, id: id(), guild_id: guildId } as Channel;
          channels.push(channel); return json(channel);
        }
      }
      const match = path.match(/^\/channels\/([^/]+)(.*)$/);
      if (match) {
        const channel = channels.find((c) => c.id === match[1]);
        if (!channel) throw new Error("Unconfigured channel: " + path);
        const rest = match[2];
        if (!rest && method === "GET") return json(channel);
        if (rest.endsWith("/threads") && method === "POST") {
          const thread = { id: id(), parent_id: channel.id, guild_id: channel.guild_id, type: body.type ?? 11, name: body.name, permission_overwrites: [] };
          channels.push(thread as Channel); return json(thread);
        }
        if (rest === "/messages" && method === "POST") return json({ id: id(), channel_id: channel.id });
        if (rest.startsWith("/thread-members/") && method === "PUT") return new Response(null, { status: 204 });
      }
      throw new Error("Unexpected HTTP (no real Discord allowed): " + url);
    }));
  });

  async function fixture() {
    const { setupCommunityFromGuild } = await import("./community-setup");
    const ids: string[] = [];
    for (const guild of GUILDS) {
      const setup = await setupCommunityFromGuild(guild, "123");
      expect(setup.action).toBe("activated"); ids.push(setup.communityId!);
    }
    await db.community.update({ where: { id: ids[0] }, data: { slug: "default" } });
    const creator = await db.user.create({ data: { discordId: "123", discordName: "Créateur" } });
    const a = await db.user.create({ data: { discordId: "124", discordName: "Invité A" } });
    const b = await db.user.create({ data: { discordId: "125", discordName: "Invité B" } });
    const outsider = await db.user.create({ data: { discordId: "126", discordName: "Non invité" } });
    for (const communityId of ids) await db.membership.create({ data: { communityId, userId: creator.id } });
    await db.membership.create({ data: { communityId: ids[0], userId: a.id } });
    await db.membership.create({ data: { communityId: ids[1], userId: b.id } });
    await db.membership.create({ data: { communityId: ids[1], userId: outsider.id } });
    const game = await db.game.create({ data: { name: "Jeu simulé", source: "MANUAL", addedById: creator.id } });
    currentUser.mockResolvedValue(creator);
    requests = [];
    return { ids, creator, a, b, outsider, game };
  }
  async function deliver(sourceId: string, category: "SESSION" | "TOURNAMENT") {
    const { processNextDelivery } = await import("./notification-executor");
    const { sessionAnnounceResolver } = await import("./session-announce");
    const { tournamentAnnounceResolver } = await import("./tournament-announce");
    const resolver = category === "SESSION" ? sessionAnnounceResolver : tournamentAnnounceResolver;
    for (let round = 0; round < 8; round++) {
      const rows = await db.notificationDelivery.findMany({ where: { event: { sourceId, category }, status: "PENDING" }, orderBy: { createdAt: "asc" } });
      if (!rows.length) break;
      for (const row of rows) await processNextDelivery({ deliveryId: row.id, resolver, owner: "simulated-worker", now: new Date(Date.now() + round * 60_000) });
    }
    const rows = await db.notificationDelivery.findMany({ where: { event: { sourceId, category } } });
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.filter((r) => r.status !== "SENT" && r.status !== "SKIPPED").map((r) => ({ slot: r.targetSlot, status: r.status, error: r.lastError, errorClass: r.errorClass }))).toEqual([]);
  }
  it("chaque création suit le choix sauvegardé ; soirées privées, tournois publics et accès isolés", async () => {
    const { ids, creator, a, b, outsider, game } = await fixture();
    const { changeCommunityAction } = await import("@/app/serveurs/actions");
    const { createSession } = await import("@/app/sessions/actions/session-lifecycle");
    const { createTournamentAction } = await import("@/app/tournois/actions");
    const { canAccessSession } = await import("./session-access");
    for (const [index, communityId] of ids.entries()) {
      expect(await changeCommunityAction(communityId)).toBe(true);
      const form = new FormData();
      form.set("creationKey", crypto.randomUUID());
      form.set("date", new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
      form.set("time", "20:00");
      form.append("notifyUserId", a.id); form.append("notifyUserId", b.id);
      await expect(createSession(form)).rejects.toThrow(/^REDIRECT:\/sessions\//);
      const session = await db.session.findFirstOrThrow({ where: { communityId } });
      expect(session.announceViaBot).toBe(true);
      const invited = index === 0 ? a : b;
      expect(await canAccessSession(creator.id, session.id)).toBe(true);
      expect(await canAccessSession(invited.id, session.id)).toBe(true);
      expect(await canAccessSession((index === 0 ? b : a).id, session.id)).toBe(false);
      expect(await canAccessSession(outsider.id, session.id)).toBe(false);
      await deliver(session.id, "SESSION");
      const tournamentForm = new FormData();
      tournamentForm.set("creationKey", crypto.randomUUID());
      tournamentForm.set("name", "Tournoi"); tournamentForm.set("gameId", game.id); tournamentForm.set("maxPlayers", "4");
      tournamentForm.append("notifyUserId", invited.id);
      await expect(createTournamentAction(tournamentForm)).rejects.toThrow(/^REDIRECT:\/tournois\//);
      const tournament = await db.tournament.findFirstOrThrow({ where: { communityId } });
      expect(tournament).toMatchObject({ announceViaBot: true, discordGuildId: GUILDS[index] });
      await deliver(tournament.id, "TOURNAMENT");
      const sent = await db.notificationDelivery.findMany({ where: { event: { sourceId: { in: [session.id, tournament.id] } }, status: "SENT" } });
      for (const delivery of sent) {
        const destination = channels.find((c) => c.id === (delivery.discordThreadId ?? delivery.discordChannelId));
        expect(destination?.guild_id).toBe(GUILDS[index]);
      }
    }
    const privateCreates = requests.filter((r) => r.method === "POST" && r.body.type === 12);
    expect(privateCreates).toHaveLength(2);
    expect(privateCreates.every((r) => r.body.invitable === false)).toBe(true);
    const sessionMessages = requests.filter((r) => r.path.endsWith("/messages") && channels.find((c) => c.id === r.path.split("/")[2])?.type === 12);
    expect(sessionMessages.length).toBeGreaterThanOrEqual(2);
    expect(requests.some((r) => r.path.includes("webhooks") || r.path.includes("historical"))).toBe(false);
    expect(requests.filter((r) => r.method === "PUT").some((r) => r.path.endsWith("/126"))).toBe(false);
  });
  it("configuration du serveur B absente ou flags bot OFF : refuse les créations avant toute annonce historique", async () => {
    const { ids, game } = await fixture();
    const { changeCommunityAction } = await import("@/app/serveurs/actions");
    await changeCommunityAction(ids[1]);
    await db.communityChannelConfig.deleteMany({ where: { communityId: ids[1] } });
    const { createTournamentAction } = await import("@/app/tournois/actions");
    const form = new FormData();
    form.set("creationKey", crypto.randomUUID());
    form.set("name", "Refusé"); form.set("gameId", game.id); form.set("maxPlayers", "4");
    await expect(createTournamentAction(form)).rejects.toThrow("ne sont pas configurées");
    vi.stubEnv("DISCORD_BOT_SESSION_ANNOUNCE_ENABLED", "false");
    const { createSession } = await import("@/app/sessions/actions/session-lifecycle");
    const sessionForm = new FormData();
    sessionForm.set("creationKey", crypto.randomUUID());
    sessionForm.set("date", new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)); sessionForm.set("time", "20:00");
    await expect(createSession(sessionForm)).rejects.toThrow("ne sont pas configurées");
    expect(await db.session.count()).toBe(0); expect(await db.tournament.count()).toBe(0);
    expect(requests).toHaveLength(0);
  });
});
