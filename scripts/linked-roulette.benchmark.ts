import { it, expect, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [{ emit: "event", level: "query" }] }) };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
it("roulette liée : chaque échantillon décide une nouvelle soirée VOTING, sans mesurer les fixtures", async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  expect(url.hostname).toBe("127.0.0.1");
  expect(url.pathname).toMatch(/^\/gamenight_load_/);
  const { prisma: db } = await import("@/lib/prisma");
  const { drawSessionGame } = await import("@/lib/sessions");
  vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("HTTP interdit"); }));
  const date = new Date(Date.UTC(2026, 11, 1, 20));
  for (const id of ["linked-owner-a", "linked-owner-b"]) {
    await db.user.upsert({ where: { id }, update: {}, create: { id, discordId: id, discordName: id } });
  }
  const game = await db.game.upsert({ where: { id: "linked-game" }, update: {}, create: { id: "linked-game", name: "Linked", source: "MANUAL", addedById: "linked-owner-a", minPlayers: 2 } });
  for (const userId of ["linked-owner-a", "linked-owner-b"]) {
    await db.userGame.upsert({ where: { userId_gameId: { userId, gameId: game.id } }, update: { owned: true }, create: { userId, gameId: game.id } });
    await db.availabilityOverride.upsert({ where: { userId_date: { userId, date: new Date(Date.UTC(2026, 11, 1)) } }, update: { available: true }, create: { userId, date: new Date(Date.UTC(2026, 11, 1)), available: true } });
  }
  let queries = 0;
  db.$on("query" as never, (() => queries++) as never);
  const results = [];
  for (let sample = -1; sample < 10; sample++) {
    const session = await db.session.create({ data: { createdById: "linked-owner-a", date, status: "VOTING", announceViaBot: true } });
    await db.proposal.create({ data: { sessionId: session.id, gameId: game.id, proposedById: "linked-owner-a" } });
    const before = queries, start = performance.now();
    const result = await drawSessionGame(session.id, "linked-owner-a");
    const count = queries - before, elapsed = performance.now() - start;
    expect(result.kind).toBe("drawn");
    expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).decidedGameId).toBe(game.id);
    expect(await db.notificationEvent.count({ where: { sourceId: session.id } })).toBeGreaterThan(0);
    expect((await drawSessionGame(session.id, "linked-owner-a")).kind).toBe("not_voting");
    if (sample >= 0) results.push({ queries: count, ms: elapsed });
  }
  expect(fetch).not.toHaveBeenCalled();
  writeFileSync(join(tmpdir(), "gamenight-linked-roulette.json"), JSON.stringify({ samples: 10, warmup: 1, fixturesExcluded: true, results }, null, 2));
  await db.$disconnect();
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
});
