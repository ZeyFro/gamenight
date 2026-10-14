import { it, expect, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL, log: [{ emit: "event", level: "query" }] }) };
});
it("file vide : SQL émis par le vrai batch, sans réseau", async () => {
  const url = new URL(process.env.TEST_DATABASE_URL!);
  expect(url.hostname).toBe("127.0.0.1");
  expect(url.pathname).toMatch(/^\/gamenight_load_/);
  const { prisma: db } = await import("@/lib/prisma");
  const { runExecutorBatch } = await import("@/lib/notification-executor");
  await db.notificationDelivery.deleteMany();
  const network = vi.fn(() => { throw new Error("HTTP interdit"); });
  vi.stubGlobal("fetch", network);
  let queries = 0;
  db.$on("query" as never, (() => queries++) as never);
  const counts = [];
  const times = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now(), before = queries;
    const result = await runExecutorBatch({ owner: "benchmark", resolver: { resolve: async () => ({ eligible: false, reason: "expired" }) } });
    expect(result.processed).toBe(0);
    counts.push(queries - before);
    times.push(performance.now() - start);
  }
  expect(network).not.toHaveBeenCalled();
  writeFileSync(join(tmpdir(), "gamenight-queue-load.json"), JSON.stringify({ counts, times }, null, 2));
  await db.$disconnect();
  vi.unstubAllGlobals();
});
