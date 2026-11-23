import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

const url = process.env.TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!["postgres:", "postgresql:"].includes(target.protocol) || target.hostname !== "127.0.0.1" || target.searchParams.has("host")) {
    throw new Error("PostgreSQL loopback isolé requis");
  }
}
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: url ? new PrismaClient({ datasourceUrl: url }) : {} };
});
// Simule plusieurs instances Vercel : la limite en mémoire ne bloque jamais, seule la base compte.
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true }));

describe.skipIf(!url)("limitation de débit partagée (PostgreSQL)", () => {
  let db: PrismaClient;
  let limiter: typeof import("./shared-rate-limit");
  const user = "rl-" + randomUUID();
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as PrismaClient;
    limiter = await import("./shared-rate-limit");
  });
  afterAll(async () => {
    if (db) { await db.rateLimitWindow.deleteMany({ where: { key: { contains: user } } }); await db.$disconnect(); }
  });

  it("20 appels simultanés de « plusieurs instances » : exactement la limite passe", async () => {
    const now = Date.UTC(2026, 10, 23, 10, 0, 30);
    const results = await Promise.all(Array.from({ length: 20 }, () => limiter.checkSharedRateLimit(user, "deleteMyAccount", { limit: 3, windowMs: 60_000 }, now)));
    expect(results.filter(Boolean)).toHaveLength(3);
    const [row] = await db.rateLimitWindow.findMany({ where: { key: `deleteMyAccount:${user}` } });
    expect(row.count).toBe(20);
  });

  it("nouvelle fenêtre : le compteur repart et l'ancienne ligne est supprimée", async () => {
    const next = Date.UTC(2026, 10, 23, 10, 1, 5);
    expect(await limiter.checkSharedRateLimit(user, "deleteMyAccount", { limit: 3, windowMs: 60_000 }, next)).toBe(true);
    const rows = await db.rateLimitWindow.findMany({ where: { key: `deleteMyAccount:${user}` } });
    expect(rows.map(row => [row.windowStart.toISOString(), row.count])).toEqual([["2026-11-23T10:01:00.000Z", 1]]);
  });

  it("clés distinctes par action", async () => {
    const now = Date.UTC(2026, 10, 23, 11, 0, 0);
    expect(await limiter.checkSharedRateLimit(user, "exportAccountData", { limit: 1, windowMs: 60_000 }, now)).toBe(true);
    expect(await limiter.checkSharedRateLimit(user, "exportAccountData", { limit: 1, windowMs: 60_000 }, now)).toBe(false);
    expect(await limiter.checkSharedRateLimit(user, "forceRelogin", { limit: 1, windowMs: 60_000 }, now)).toBe(true);
  });
});
