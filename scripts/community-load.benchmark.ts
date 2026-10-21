import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthConfig } from "@auth/core";
import { afterAll, expect, it, vi } from "vitest";

const url = process.env.TEST_DATABASE_URL!;
if (new URL(url).hostname !== "127.0.0.1" || !/^\/gamenight_load_[a-z0-9_]+$/.test(new URL(url).pathname)) throw new Error("Dedicated local load DB required");
const captured = vi.hoisted(() => ({ config: null as AuthConfig | null }));
vi.mock("next-auth", () => ({ default: (config: AuthConfig) => {
  captured.config = config;
  return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: url, log: [{ emit: "event", level: "query" }] }) };
});

afterAll(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("100 then 1000 communities: actual application functions, sequential scenarios", async () => {
  const { prisma: db } = await import("@/lib/prisma");
  const isolation = await import("@/lib/community-isolation");
  const picker = await import("@/lib/community-picker");
  const { loadHomeData } = await import("@/lib/home-data");
  const { getScoreboard } = await import("@/lib/scoreboard");
  const { getMemberStatsForViewer } = await import("@/lib/member-stats");
  const { getActiveScopedPrisma } = await import("@/lib/community-scoped-client");
  const { accessibleSessionWhereFor } = await import("@/lib/session-access");
  await import("../src/auth");
  vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "true");
  vi.stubEnv("COMMUNITY_PICKER_ENABLED", "true");
  vi.stubEnv("DISCORD_BOT_GUILD_ID", "");
  let queries = 0;
  let unboundedCommunityReads = 0;
  let guildRequests = 0;
  db.$on("query" as never, ((event: { query: string }) => {
    queries++;
    if (/SELECT.*FROM "public"\."Community"/.test(event.query) && !/WHERE/.test(event.query)) unboundedCommunityReads++;
  }) as never);
  const reports: unknown[] = [];
  try {
    for (const count of [100, 1000]) {
      const seedStart = performance.now();
      await db.$executeRawUnsafe('TRUNCATE "User", "Community", "Badge", "Game" CASCADE');
      (await import("@/lib/default-community")).resetDefaultCommunityIdCache();
      const guild = (i: number) => String(BigInt("100000000000000000") + BigInt(i));
      await db.community.createMany({ data: Array.from({ length: count }, (_, i) => ({ id: `load-c${i}`, slug: i === 0 ? "default" : `load-${i}`, name: `Fictive ${i}`, status: "ACTIVE", discordGuildId: guild(i) })) });
      await db.user.createMany({ data: [
        { id: "load-shared", discordId: "load-shared", discordName: "Shared", activeCommunityId: "load-c0" },
        ...Array.from({ length: count * 5 }, (_, i) => ({ id: `load-u${i}`, discordId: `load-u${i}`, discordName: `Member ${i}` })),
      ] });
      const members = [
        { userId: "load-shared", communityId: "load-c0" }, { userId: "load-shared", communityId: "load-c1" },
        ...Array.from({ length: count * 5 }, (_, i) => ({ userId: `load-u${i}`, communityId: `load-c${Math.floor(i / 5)}` })),
      ];
      await db.membership.createMany({ data: members });
      await db.communityMemberStats.createMany({ data: members.map((m, i) => ({ ...m, xpTotal: i + 10 })) });
      await db.badge.create({ data: { id: "load-badge", name: "Fictive", description: "Load", icon: "x", xpReward: 0, category: "PARTICIPATION", rarity: "COMMON", criteria: {}, modifiedById: "load-shared" } });
      await db.userBadge.createMany({ data: members.map((m) => ({ ...m, badgeId: "load-badge" })) });
      await db.xpEvent.createMany({ data: members.flatMap((m) => Array.from({ length: 5 }, (_, i) => ({ ...m, reason: "PARTICIPATE" as const, sourceId: `load-source${i}`, amount: 1 }))) });
      const date = new Date(Date.now() + 86400000);
      await db.session.createMany({ data: Array.from({ length: count * 3 }, (_, i) => ({ id: `load-s${i}`, communityId: `load-c${Math.floor(i / 3)}`, createdById: Math.floor(i / 3) < 2 ? "load-shared" : `load-u${Math.floor(i / 3) * 5}`, date, status: "SCHEDULED" })) });
      await db.notification.createMany({ data: Array.from({ length: count * 2 }, (_, i) => ({ userId: Math.floor(i / 2) < 2 ? "load-shared" : `load-u${Math.floor(i / 2) * 5}`, communityId: `load-c${Math.floor(i / 2)}`, type: "SESSION_CREATED", title: "Fictive", message: "Load" })) });
      const user = await db.user.findUniqueOrThrow({ where: { id: "load-shared" } });
      vi.stubGlobal("fetch", vi.fn(async (input: URL | string) => {
        if (String(input).startsWith("https://discord.com/api/v10/users/@me/guilds?")) {
          guildRequests++;
          return Response.json([{ id: guild(0) }, { id: guild(1) }]);
        }
        throw new Error("Unexpected network request in benchmark");
      }));
      const scenarios: Record<string, () => Promise<unknown>> = {
        oauth: async () => {
          expect(await captured.config!.callbacks!.signIn!({ user: { id: "load-shared", name: "Shared" }, profile: { id: "load-shared" }, account: { provider: "discord", providerAccountId: "load-shared", type: "oauth", access_token: "simulated", scope: "guilds identify email" } })).toBe(true);
        },
        resolution: () => isolation.resolveActiveCommunityId(user.id),
        selector: () => picker.listPickableCommunities(user.id),
        home: () => loadHomeData(user),
        scoreboard: () => getScoreboard("global", { communityId: "load-c0" }),
        progression: () => getMemberStatsForViewer(user.id, user.id),
        sessions: async () => {
          const scopedDb = await getActiveScopedPrisma(user.id);
          return scopedDb.session.findMany({ where: await accessibleSessionWhereFor(user.id), select: { id: true } });
        },
      };
      const measurements = [];
      for (const [name, action] of Object.entries(scenarios)) {
        await action(); // warmup, including lazy season bootstrap
        const times: number[] = [];
        const queryCounts: number[] = [];
        const networkCounts: number[] = [];
        unboundedCommunityReads = 0;
        for (let sample = 0; sample < 10; sample++) {
          const q = queries, g = guildRequests, start = performance.now();
          await action();
          times.push(performance.now() - start);
          queryCounts.push(queries - q);
          networkCounts.push(guildRequests - g);
        }
        times.sort((a, b) => a - b);
        const q = queries, g = guildRequests, start = performance.now();
        const concurrent = await Promise.allSettled(Array.from({ length: 8 }, () => action()));
        const failed = concurrent.filter((r) => r.status === "rejected");
        measurements.push({ name, samples: 10, p50Ms: +times[4].toFixed(2), p95Ms: +times[9].toFixed(2), queriesMin: Math.min(...queryCounts), queriesMax: Math.max(...queryCounts), discordRequests: networkCounts,
          concurrency: 8, concurrentMs: +(performance.now() - start).toFixed(2), concurrentQueries: queries - q, concurrentDiscordRequests: guildRequests - g, failures: failed.length, unboundedCommunityReads });
        expect(failed).toEqual([]);
        expect(unboundedCommunityReads).toBe(0);
        if (name !== "oauth") expect(networkCounts.every((n) => n === 0)).toBe(true);
      }
      reports.push({ communities: count, users: count * 5 + 1, memberships: members.length, sessions: count * 3, xpEvents: members.length * 5, badges: members.length, notifications: count * 2, totalScenarioAndSeedMs: +(performance.now() - seedStart).toFixed(2), measurements });
    }
    const report = { localOnly: true, measuredAt: new Date().toISOString(), node: process.version, postgres: await db.$queryRaw`SELECT version(), current_setting('TimeZone') AS timezone`, reports };
    const output = join(tmpdir(), "gamenight-community-load.json");
    writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(`BENCHMARK_REPORT=${output}\n${JSON.stringify(report)}`);
  } finally { await db.$disconnect(); }
});
