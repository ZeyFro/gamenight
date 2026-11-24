import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: process.env.TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: process.env.TEST_DATABASE_URL }) : {} };
});
vi.mock("next/server", () => ({ after: (task: () => Promise<unknown>) => void task() }));

/** Journal d'erreurs serveur (audit du 23/11/2026) sur PostgreSQL isolée : écriture, regroupement par empreinte, purge à 30 jours. */
describe.skipIf(!process.env.TEST_DATABASE_URL)("journal d'erreurs serveur (PostgreSQL isolée)", () => {
  let db: PrismaClient;
  beforeAll(async () => {
    expect(new URL(process.env.TEST_DATABASE_URL!).hostname).toBe("127.0.0.1");
    db = (await import("@/lib/prisma")).prisma as unknown as PrismaClient;
  });
  afterAll(async () => { await db?.$disconnect(); });
  beforeEach(async () => {
    await db.serverErrorLog.deleteMany();
    (await import("@/lib/error-log")).resetErrorLogLimiter();
  });

  it("écrit une ligne nettoyée, puis incrémente le compteur de la même empreinte au lieu d'écrire 1000 lignes", async () => {
    const { buildServerErrorEntry, writeServerError } = await import("@/lib/error-log");
    const at = (minutes: number) => new Date(Date.UTC(2026, 10, 24, 3, minutes));
    for (let i = 0; i < 5; i++) {
      await writeServerError(buildServerErrorEntry("cron:reminders", new Error(`délai dépassé après ${1500 + i} ms sur https://u:mdp@h/db`), { route: "cron/reminders" }), at(i));
    }
    const rows = await db.serverErrorLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ context: "cron:reminders", route: "cron/reminders", count: 5, createdAt: at(0), lastAt: at(4) });
    expect(rows[0].message).not.toContain("mdp");
    expect(rows[0].message).toContain("[url]");
  });

  it("des erreurs différentes font des lignes différentes, lues de la plus récente à la plus ancienne", async () => {
    const { buildServerErrorEntry, writeServerError, listServerErrors } = await import("@/lib/error-log");
    await writeServerError(buildServerErrorEntry("cron:a", new Error("première")), new Date("2026-11-24T01:00:00Z"));
    await writeServerError(buildServerErrorEntry("cron:b", new Error("seconde")), new Date("2026-11-24T02:00:00Z"));
    expect((await listServerErrors()).map((row) => row.context)).toEqual(["cron:b", "cron:a"]);
  });

  it("persistServerError écrit en tâche de fond hors test (le plafond par minute est respecté)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const { persistServerError } = await import("@/lib/error-log");
      persistServerError("notification-executor", new Error("livraison en échec terminal : unsupported_transport"), { code: "unsupported_transport", route: "executor/livraison" });
      await vi.waitFor(async () => expect(await db.serverErrorLog.count()).toBe(1));
      expect(await db.serverErrorLog.findFirstOrThrow()).toMatchObject({ context: "notification-executor", code: "unsupported_transport", count: 1 });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("la purge supprime ce qui est plus vieux que 30 jours (dernière occurrence) et garde le reste", async () => {
    const { buildServerErrorEntry, writeServerError, purgeServerErrors } = await import("@/lib/error-log");
    const now = new Date("2026-11-24T04:00:00Z");
    await writeServerError(buildServerErrorEntry("cron:vieux", new Error("ancien")), new Date("2026-10-20T00:00:00Z"));
    await writeServerError(buildServerErrorEntry("cron:limite", new Error("limite")), new Date("2026-10-25T04:00:01Z")); // 29 j 23 h 59 min 59 s
    await writeServerError(buildServerErrorEntry("cron:recent", new Error("récent")), new Date("2026-11-23T00:00:00Z"));
    expect(await purgeServerErrors(now)).toBe(1);
    expect((await db.serverErrorLog.findMany({ orderBy: { context: "asc" } })).map((row) => row.context)).toEqual(["cron:limite", "cron:recent"]);
  });

  it("une erreur ancienne qui se reproduit aujourd'hui n'est pas purgée (la purge suit la dernière occurrence)", async () => {
    const { buildServerErrorEntry, writeServerError, purgeServerErrors } = await import("@/lib/error-log");
    const entry = buildServerErrorEntry("cron:chronique", new Error("toujours là"));
    await writeServerError(entry, new Date("2026-09-01T00:00:00Z"));
    await writeServerError(entry, new Date("2026-11-23T00:00:00Z"));
    expect(await purgeServerErrors(new Date("2026-11-24T04:00:00Z"))).toBe(0);
    expect(await db.serverErrorLog.findFirstOrThrow()).toMatchObject({ count: 2 });
  });
});
