import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

describe.skipIf(!url)("journal des opérations sensibles (§19.1) sur PostgreSQL", () => {
  let db: PrismaClient;
  let log: typeof import("./sensitive-operation-log");
  const scope = "sensitive-" + randomUUID();
  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as PrismaClient;
    log = await import("./sensitive-operation-log");
  });
  afterAll(async () => {
    if (db) {
      await db.sensitiveOperationLog.deleteMany({ where: { target: { startsWith: scope } } });
      await db.user.deleteMany({ where: { id: scope + "-admin" } });
      await db.$disconnect();
    }
  });
  beforeEach(async () => {
    await db.sensitiveOperationLog.deleteMany({ where: { target: { startsWith: scope } } });
    await db.user.deleteMany({ where: { id: scope + "-admin" } });
    await db.user.create({ data: { id: scope + "-admin", discordId: scope, discordName: "Admin du test" } });
  });

  it("écrit une ligne lisible sur /admin/journal, la plus récente d'abord, avec le pseudo de l'auteur", async () => {
    await log.recordSensitiveOperation({ actorId: scope + "-admin", action: "community.teams", communityId: "c1", target: scope + "-1", outcome: "teams-ok" });
    await log.recordSensitiveOperation({ actorId: null, action: "auth.force_relogin", target: scope + "-2", outcome: "ok" });
    const rows = (await log.listSensitiveOperations(500)).filter(row => row.target?.startsWith(scope));
    expect(rows.map(row => [row.action, row.actorName, row.outcome])).toEqual([
      ["auth.force_relogin", "Système", "ok"],
      ["community.teams", "Admin du test", "teams-ok"],
    ]);
  });

  it("n'enregistre que des codes : un texte libre devient « invalid »", async () => {
    await log.recordSensitiveOperation({ actorId: scope + "-admin", action: "player.xp_adjust", target: scope + "-3", outcome: "triche avérée, voir capture" });
    const row = await db.sensitiveOperationLog.findFirstOrThrow({ where: { target: scope + "-3" } });
    expect(row.outcome).toBe("invalid");
  });
});
