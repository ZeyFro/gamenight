import type { AuthConfig } from "@auth/core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
    vi.stubEnv("AUTH_REQUIRE_GUILD_MEMBER", "false");
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
  it("admission gate alone prevents seed-reconcile from granting a denied default membership", async () => {
    vi.stubEnv("AUTH_REQUIRE_GUILD_MEMBER", "true");
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
  it("new denied account is rolled back, never becomes an exempt existing account", async () => {
    vi.stubEnv("AUTH_REQUIRE_GUILD_MEMBER", "true");
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json([])));
    expect(await signIn("new-account")).toBe(false);
    expect(await db.user.findUnique({ where: { discordId: "new-account" } })).toBeNull();
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
  it("server C added through existing setup and channel configuration, no code/env IDs", async () => {
    const guildId = "666666666666666666";
    const setup = await (await import("./community-setup")).setupCommunityFromGuild(guildId, "123");
    expect(setup.action).toBe("activated");
    await reconcile([guildId]);
    const http = vi.fn().mockImplementation(async () => Response.json({ id: "777777777777777777", guild_id: guildId, type: 0 }));
    vi.stubGlobal("fetch", http);
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-bot");
    const configured = await (await import("./community-admin")).setCommunityChannel({ communityId: setup.communityId!, category: "SESSION", channelId: "777777777777777777" });
    expect(configured).toEqual({ ok: true });
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
