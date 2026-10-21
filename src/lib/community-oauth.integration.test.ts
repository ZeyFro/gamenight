import type { AuthConfig } from "@auth/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/logger";

const url = process.env.TEST_DATABASE_URL;
const captured = vi.hoisted(() => ({ config: null as AuthConfig | null }));
vi.mock("next-auth", () => ({ default: (config: AuthConfig) => {
  captured.config = config;
  return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  if (url && new URL(url).hostname !== "127.0.0.1") throw new Error("Local Postgres only");
  return { prisma: url ? new PrismaClient({ datasourceUrl: url }) : {} };
});
if (!url) console.warn("[community-oauth] TEST_DATABASE_URL absent: integration SKIPPED");

describe.skipIf(!url)("OAuth memberships, local PostgreSQL", () => {
  let db: import("@prisma/client").PrismaClient;
  let sync: typeof import("./community-oauth").syncOAuthMemberships;
  const ids: Record<string, string> = {};
  const at = new Date("2026-10-07T10:00:00Z");
  const guilds = { a: "111111111111111111", b: "222222222222222222", pending: "333333333333333333", suspended: "444444444444444444" };
  const defaultGuild = "888888888888888888"; // serveur de la communauté par défaut (fictif)
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as typeof db;
    sync = (await import("./community-oauth")).syncOAuthMemberships;
    await import("../auth");
  });
  afterAll(async () => { await db?.$disconnect(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
    vi.stubEnv("AUTH_REQUIRE_GUILD_MEMBER", "");
    vi.stubEnv("ADMIN_DISCORD_IDS", "");
    vi.stubEnv("DISCORD_BOT_GUILD_ID", "");
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network"); }));
    await db.$executeRawUnsafe('TRUNCATE "User", "Community", "Badge" CASCADE');
    for (const key of ["default", "a", "b", "pending", "suspended"]) {
      ids[key] = (await db.community.create({ data: {
        slug: key, name: key, status: key === "pending" ? "PENDING" : key === "suspended" ? "SUSPENDED" : "ACTIVE",
        discordGuildId: guilds[key as keyof typeof guilds] ?? null,
      } })).id;
    }
    ids.user = (await db.user.create({ data: { discordId: "123", discordName: "Both" } })).id;
  });
  const reconcile = (list: string[], time = at) => db.$transaction((tx) => sync(tx, ids.user, list, time));
  const membership = (key: string) => db.membership.findUnique({ where: { communityId_userId: { communityId: ids[key], userId: ids.user } } });
  const signIn = (id = "123") => captured.config!.callbacks!.signIn!({
    user: { id, name: "Both" }, profile: { id, username: "Both" },
    account: { provider: "discord", providerAccountId: id, type: "oauth", access_token: "test-token", scope: "identify email guilds" },
  });
  it.each([[], [guilds.a], [guilds.a, guilds.b]].map((list) => ({ list })))("zero/one/multiple servers: $list", async ({ list }) => {
    expect(await reconcile(list)).toHaveLength(list.length);
    expect(await db.membership.count({ where: { userId: ids.user, status: "ACTIVE" } })).toBe(list.length);
  });
  it("unknown, PENDING, SUSPENDED never activate or grant membership; OAuth permissions do not grant admin", async () => {
    await reconcile([...Object.values(guilds), "555555555555555555"]);
    expect(await membership("pending")).toBeNull();
    expect(await membership("suspended")).toBeNull();
    expect((await membership("a"))?.role).toBe("MEMBER");
    expect((await db.community.findUniqueOrThrow({ where: { id: ids.pending } })).status).toBe("PENDING");
  });
  it("departure clears invalid preference; return reactivates LEFT and preserves role", async () => {
    await reconcile([guilds.a, guilds.b]);
    await db.user.update({ where: { id: ids.user }, data: { activeCommunityId: ids.a } });
    await db.membership.update({ where: { communityId_userId: { communityId: ids.a, userId: ids.user } }, data: { role: "ADMIN" } });
    await reconcile([guilds.b], new Date(at.getTime() + 1));
    expect((await membership("a"))?.status).toBe("LEFT");
    expect((await db.user.findUniqueOrThrow({ where: { id: ids.user } })).activeCommunityId).toBeNull();
    await reconcile([guilds.a, guilds.b], new Date(at.getTime() + 2));
    expect(await membership("a")).toMatchObject({ status: "ACTIVE", role: "ADMIN", leftAt: null });
  });
  it("REMOVED stays removed on all replays, suspension prevents synchronization", async () => {
    await reconcile([guilds.a, guilds.b]);
    await db.membership.update({ where: { communityId_userId: { communityId: ids.a, userId: ids.user } }, data: { status: "REMOVED" } });
    await db.community.update({ where: { id: ids.b }, data: { status: "SUSPENDED" } });
    expect(await reconcile([guilds.a, guilds.b], new Date(at.getTime() + 1))).toEqual([]);
    expect((await membership("a"))?.status).toBe("REMOVED");
    expect((await membership("b"))?.lastVerifiedAt).toEqual(at);
    expect(await (await import("./community-picker")).getActiveCommunityState(ids.user)).toEqual({ kind: "none" });
  });
  it("complete empty snapshot proves departure; no hidden fallback to default", async () => {
    await reconcile([guilds.a]);
    expect(await reconcile([], new Date(at.getTime() + 1))).toEqual([]);
    expect((await membership("a"))?.status).toBe("LEFT");
    expect(await (await import("./community-isolation")).resolveActiveCommunityId(ids.user)).toBeNull();
  });
  it("missing guild association is not an authorization; seed-reconcile cannot admit a zero-guild account", async () => {
    await db.membership.create({ data: { communityId: ids.default, userId: ids.user } });
    expect(await reconcile([guilds.a])).toEqual([ids.a]);
    expect((await membership("default"))?.status).toBe("LEFT");
    const outsider = await db.user.create({ data: { discordId: "outsider", discordName: "None" } });
    expect((await (await import("./default-community")).ensureDefaultCommunity()).membershipsCreated).toBe(0);
    expect(await db.membership.count({ where: { userId: outsider.id } })).toBe(0);
  });
  it.each(["true", "false"])("seed-reconcile never grants a default membership, even with AUTH_REQUIRE_GUILD_MEMBER=%s and every other flag OFF", async (value) => {
    vi.stubEnv("AUTH_REQUIRE_GUILD_MEMBER", value);
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "false");
    const outsider = await db.user.create({ data: { discordId: "gate-outsider", discordName: "No guild" } });
    expect((await (await import("./default-community")).ensureDefaultCommunity()).membershipsCreated).toBe(0);
    expect(await db.membership.count({ where: { userId: outsider.id } })).toBe(0);
  });
  it("eight concurrent replays produce exactly one membership per guild", async () => {
    await Promise.all(Array.from({ length: 8 }, () => reconcile([guilds.a, guilds.b])));
    expect(await db.membership.count({ where: { userId: ids.user } })).toBe(2);
  });
  it("older interrupted snapshot cannot undo a newer departure", async () => {
    await reconcile([guilds.a, guilds.b]);
    await reconcile([guilds.b], new Date(at.getTime() + 10));
    expect(await reconcile([guilds.a, guilds.b], at)).toEqual([ids.b]);
    expect((await membership("a"))?.status).toBe("LEFT");
  });
  it("foreign saved preference with multiple memberships requires an explicit choice", async () => {
    await reconcile([guilds.a, guilds.b]);
    await db.user.update({ where: { id: ids.user }, data: { activeCommunityId: ids.pending } });
    await reconcile([guilds.a, guilds.b]);
    expect((await (await import("./community-picker")).getActiveCommunityState(ids.user)).kind).toBe("needs-choice");
    expect(await (await import("./community-isolation")).resolveActiveCommunityId(ids.user)).toBeNull();
  });
  it("partial paginated error denies fresh login without revocation or grants", async () => {
    await reconcile([guilds.a]);
    const http = vi.fn().mockResolvedValueOnce(Response.json(Array.from({ length: 200 }, (_, i) => ({ id: String(i + 1) }))))
      .mockResolvedValueOnce(new Response("error", { status: 500 }));
    vi.stubGlobal("fetch", http);
    expect(await signIn()).toBe(false);
    expect(await membership("a")).toMatchObject({ status: "ACTIVE", lastVerifiedAt: at });
    expect(await db.membership.count({ where: { userId: ids.user } })).toBe(1);
  });
  it.each(["true", "false", ""])("new denied account is rolled back, never becomes an exempt existing account (AUTH_REQUIRE_GUILD_MEMBER=%j)", async (value) => {
    vi.stubEnv("AUTH_REQUIRE_GUILD_MEMBER", value);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json([])));
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    try {
      expect(await signIn("new-account")).toBe(false);
      expect(await db.user.findUnique({ where: { discordId: "new-account" } })).toBeNull();
      expect(await signIn("new-account")).toBe(false);
      // Prisma doit renvoyer NotAdmitted intacte : warn neutre, jamais error.
      expect(warn).toHaveBeenCalledWith("auth", "OAuth login denied: no ACTIVE community.", { discordId: "new-account" });
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
  describe("S0 — connexion fermée par défaut (comptes fictifs, serveurs simulés)", () => {
    const stubGuilds = (list: string[]) => vi.stubGlobal("fetch", vi.fn(async () => Response.json(list.map((id) => ({ id })))));
    const setDefaultGuild = (discordGuildId: string | null, status: "ACTIVE" | "PENDING" | "SUSPENDED" = "ACTIVE") =>
      db.community.update({ where: { id: ids.default }, data: { discordGuildId, status } });
    // Les autres communautés ne doivent pas admettre à leur place.
    const suspendOthers = () => db.community.updateMany({ where: { slug: { not: "default" } }, data: { status: "SUSPENDED" } });
    const defaultMembership = () => db.membership.findUnique({ where: { communityId_userId: { communityId: ids.default, userId: ids.user } } });

    it("(i) pote légitime : ligne User historique sans appartenance + serveur de la communauté par défaut → accepté, appartenance ACTIVE créée", async () => {
      await setDefaultGuild(defaultGuild);
      expect(await db.membership.count({ where: { userId: ids.user } })).toBe(0);
      stubGuilds([defaultGuild, "999999999999999990"]);
      expect(await signIn("123")).toBe(true);
      expect(await defaultMembership()).toMatchObject({ status: "ACTIVE", role: "MEMBER" });
    });

    it("(ii) inconnu : serveur absent de sa liste → refusé, aucune ligne User créée", async () => {
      await setDefaultGuild(defaultGuild);
      stubGuilds(["999999999999999990"]);
      expect(await signIn("stranger")).toBe(false);
      expect(await db.user.findUnique({ where: { discordId: "stranger" } })).toBeNull();
      expect(await db.membership.count()).toBe(0);
    });

    it("(iii) membre ACTIVE ayant quitté le serveur : appartenance passée à LEFT puis refus", async () => {
      await setDefaultGuild(defaultGuild);
      await db.membership.create({ data: { communityId: ids.default, userId: ids.user } });
      stubGuilds(["999999999999999990"]);
      expect(await signIn("123")).toBe(false);
      expect(await defaultMembership()).toMatchObject({ status: "LEFT" });
      expect((await defaultMembership())?.leftAt).not.toBeNull();
    });

    it("(iv) communauté par défaut sans discordGuildId (DISCORD_BOT_GUILD_ID vide) : tout le monde refusé sauf admin", async () => {
      await suspendOthers();
      vi.stubEnv("ADMIN_DISCORD_IDS", "admin-1");
      stubGuilds([defaultGuild, guilds.a, guilds.b]);
      expect(await signIn("123")).toBe(false);
      expect(await signIn("stranger")).toBe(false);
      expect(await db.user.findUnique({ where: { discordId: "stranger" } })).toBeNull();
      expect(await signIn("admin-1")).toBe(true);
      expect(await db.user.findUnique({ where: { discordId: "admin-1" } })).not.toBeNull();
      expect(await db.membership.count({ where: { status: "ACTIVE" } })).toBe(0);
    });

    it.each(["PENDING", "SUSPENDED"] as const)("(v) communauté par défaut %s : refus, aucune appartenance", async (status) => {
      await suspendOthers();
      await setDefaultGuild(defaultGuild, status);
      stubGuilds([defaultGuild]);
      expect(await signIn("123")).toBe(false);
      expect(await signIn("stranger")).toBe(false);
      expect(await db.user.findUnique({ where: { discordId: "stranger" } })).toBeNull();
      expect(await db.membership.count()).toBe(0);
    });

    it("(vi) admin accepté même sans aucune communauté ACTIVE, et même si Discord échoue (aucune synchronisation)", async () => {
      await suspendOthers();
      await setDefaultGuild(null, "SUSPENDED");
      vi.stubEnv("ADMIN_DISCORD_IDS", "admin-1, admin-2");
      stubGuilds([defaultGuild]);
      expect(await signIn("admin-1")).toBe(true);
      vi.stubGlobal("fetch", vi.fn(async () => new Response("error", { status: 500 })));
      expect(await signIn("admin-2")).toBe(true);
      expect(await signIn("admin-2")).toBe(true); // reconnexion : upsert idempotent
      expect(await db.user.count({ where: { discordId: { in: ["admin-1", "admin-2"] } } })).toBe(2);
      expect(await db.membership.count()).toBe(0);
      expect(await signIn("stranger")).toBe(false);
    });

    it("(vii) DISCORD_BOT_GUILD_ID renseigné complète le serveur de la communauté par défaut", async () => {
      vi.stubEnv("DISCORD_BOT_GUILD_ID", defaultGuild);
      expect((await db.community.findUniqueOrThrow({ where: { id: ids.default } })).discordGuildId).toBeNull();
      stubGuilds([defaultGuild]);
      expect(await signIn("123")).toBe(true);
      expect((await db.community.findUniqueOrThrow({ where: { id: ids.default } })).discordGuildId).toBe(defaultGuild);
      expect(await defaultMembership()).toMatchObject({ status: "ACTIVE" });
    });

    it("(vii bis) communauté par défaut absente : créée depuis DISCORD_BOT_GUILD_ID à la première connexion, qui est acceptée", async () => {
      await db.community.delete({ where: { id: ids.default } });
      vi.stubEnv("DISCORD_BOT_GUILD_ID", defaultGuild);
      stubGuilds([defaultGuild]);
      expect(await signIn("123")).toBe(true);
      const created = await db.community.findUniqueOrThrow({ where: { slug: "default" } });
      expect(created).toMatchObject({ status: "ACTIVE", discordGuildId: defaultGuild });
      expect(await db.membership.count({ where: { userId: ids.user, communityId: created.id, status: "ACTIVE" } })).toBe(1);
    });

    it("compte existant avec seulement une appartenance REMOVED et serveur présent : refusé, REMOVED non réactivé", async () => {
      await setDefaultGuild(defaultGuild);
      await db.membership.create({ data: { communityId: ids.default, userId: ids.user, status: "REMOVED" } });
      stubGuilds([defaultGuild]);
      expect(await signIn("123")).toBe(false);
      expect(await defaultMembership()).toMatchObject({ status: "REMOVED" });
    });

    it("compte avec seulement une appartenance LEFT et serveur revenu : accepté, réactivée ACTIVE (isolation et sélecteur à false)", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
      vi.stubEnv("COMMUNITY_PICKER_ENABLED", "false");
      await setDefaultGuild(defaultGuild);
      await db.membership.create({ data: { communityId: ids.default, userId: ids.user, status: "LEFT", leftAt: at } });
      stubGuilds([defaultGuild]);
      expect(await signIn("123")).toBe(true);
      expect(await defaultMembership()).toMatchObject({ status: "ACTIVE", leftAt: null });
    });

    it("compte JAMAIS VU dont le serveur correspond : accepté, ligne User et appartenance créées (drapeaux absents)", async () => {
      vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "");
      vi.stubEnv("COMMUNITY_PICKER_ENABLED", "");
      await setDefaultGuild(defaultGuild);
      stubGuilds([defaultGuild]);
      expect(await signIn("brand-new")).toBe(true);
      const created = await db.user.findUniqueOrThrow({ where: { discordId: "brand-new" } });
      expect(await db.membership.findUnique({ where: { communityId_userId: { communityId: ids.default, userId: created.id } } }))
        .toMatchObject({ status: "ACTIVE", role: "MEMBER" });
    });
  });
  it("old account relogin populates memberships without altering forceReloginAt", async () => {
    await db.user.update({ where: { id: ids.user }, data: { forceReloginAt: at } });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json([{ id: guilds.a }])));
    expect(await signIn()).toBe(true);
    const oldUser = await db.user.findUniqueOrThrow({ where: { id: ids.user } });
    const { shouldForceRelogin } = await import("./force-relogin");
    expect(shouldForceRelogin(oldUser.forceReloginAt, at.getTime() - 1)).toBe(true);
    const token = await captured.config!.callbacks!.jwt!({ token: {}, user: { id: "123" }, account: { provider: "discord", providerAccountId: "123", type: "oauth", access_token: "test-token" }, trigger: "signIn" });
    expect(shouldForceRelogin(oldUser.forceReloginAt, token!.sessionCreatedAt as number)).toBe(false);
    expect((await membership("a"))?.status).toBe("ACTIVE");
  });
  it("server C added through automatic setup and channel configuration, no production IDs", async () => {
    const guildId = "666666666666666666";
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-bot");
    const channels = [
      { id: "777777777777777770", name: "GameNight", type: 4 },
      { id: "777777777777777777", name: "soirées", type: 0, topic: `GameNight:${guildId}:SESSION` },
      { id: "777777777777777778", name: "tournois", type: 0, topic: `GameNight:${guildId}:TOURNAMENT` },
    ];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      if (path === `/api/v10/guilds/${guildId}`) return Response.json({ id: guildId, name: "Nouveau serveur C", icon: null, roles: [{ id: "role-bot", permissions: "8" }] });
      if (path === "/api/v10/users/@me") return Response.json({ id: "999" });
      if (path === `/api/v10/guilds/${guildId}/members/999`) return Response.json({ roles: ["role-bot"] });
      if (path === `/api/v10/guilds/${guildId}/channels`) return Response.json(channels);
      throw new Error("Unexpected simulated setup HTTP");
    }));
    const setup = await (await import("./community-setup")).setupCommunityFromGuild(guildId, "123");
    expect(setup.action).toBe("activated");
    await reconcile([guildId]);
    expect(await db.communityChannelConfig.count({ where: { communityId: setup.communityId! } })).toBe(2);
    vi.stubEnv("COMMUNITY_CHANNELS_ENABLED", "true");
    expect(await (await import("./community-channels")).resolveSessionAnnounceConfig(setup.communityId)).toEqual({ guildId, channelId: "777777777777777777" });
  });
  it("shared user A then B: home, sessions, XP, badges, scoreboard and notifications follow selection", async () => {
    await reconcile([guilds.a, guilds.b]);
    const other = await db.user.create({ data: { discordId: "b-only", discordName: "B-only" } });
    await db.membership.create({ data: { userId: other.id, communityId: ids.b } });
    const badge = await db.badge.create({ data: { name: "Scoped", description: "Scoped", icon: "x", category: "PARTICIPATION", rarity: "COMMON", criteria: {}, modifiedById: ids.user } });
    for (const [key, amount] of [["a", 10], ["b", 700]] as const) {
      ids[`session-${key}`] = (await db.session.create({ data: { createdById: ids.user, communityId: ids[key], status: "SCHEDULED", date: new Date(Date.now() + (key === "b" ? 1000 : 2000)) } })).id;
      await db.communityMemberStats.create({ data: { communityId: ids[key], userId: ids.user, xpTotal: amount } });
      await db.userBadge.create({ data: { communityId: ids[key], userId: ids.user, badgeId: badge.id } });
      await db.notification.create({ data: { communityId: ids[key], userId: ids.user, type: "SESSION_CREATED", title: key, message: key } });
    }
    for (const key of ["a", "b"] as const) {
      expect(await (await import("./community-picker")).setActiveCommunity(ids.user, ids[key])).toBe(true);
      const scopedDb = await (await import("./community-scoped-client")).getActiveScopedPrisma(ids.user);
      const sessions = await scopedDb.session.findMany({ where: await (await import("./session-access")).accessibleSessionWhereFor(ids.user) });
      expect(sessions.map((s) => s.id)).toEqual([ids[`session-${key}`]]);
      expect((await (await import("./home")).getNextSessionForHome(ids.user))?.id).toBe(ids[`session-${key}`]);
      expect((await (await import("./member-stats")).getMemberStatsForViewer(ids.user, ids.user)).xpTotal).toBe(key === "a" ? 10 : 700);
      expect((await scopedDb.userBadge.findMany({ where: { userId: ids.user } })).map((b) => b.communityId)).toEqual([ids[key]]);
      expect((await (await import("./notifications")).listRecentNotifications(ids.user)).map((n) => n.title)).toEqual([key]);
      const ranking = await (await import("./scoreboard")).getScoreboard("global", { communityId: ids[key] });
      expect(ranking.map((r) => r.userId)).toContain(ids.user);
      if (key === "a") expect(ranking.map((r) => r.userId)).not.toContain(other.id);
      else expect(ranking.map((r) => r.userId)).toContain(other.id);
    }
  });
  it("missing channel or foreign guild never falls back to another server", async () => {
    vi.stubEnv("COMMUNITY_CHANNELS_ENABLED", "true");
    vi.stubEnv("DISCORD_BOT_SESSION_CHANNEL_ID", "999999999999999999");
    const { resolveSessionAnnounceConfig } = await import("./community-channels");
    expect(await resolveSessionAnnounceConfig(ids.a)).toBeNull();
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-bot");
    const http = vi.fn().mockImplementation(async () => Response.json({ id: "777777777777777777", guild_id: guilds.b, type: 0 }));
    vi.stubGlobal("fetch", http);
    expect(await (await import("./community-admin")).setCommunityChannel({ communityId: ids.a, category: "SESSION", channelId: "777777777777777777" })).toEqual({ ok: false, reason: "unusable_channel" });
    expect(await resolveSessionAnnounceConfig(ids.a)).toBeNull();
    expect(http).toHaveBeenCalledOnce();
  });
});
