import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { levelForXp, rankForLevel, titleForLevel } from "./xp";

const url = process.env.TEST_DATABASE_URL;
const statements = readFileSync("prisma/migrations/20261019190000_separate_xp_balance/migration.sql", "utf8").replace(/^--.*$/gm, "").split(";").filter((sql) => sql.trim());

describe.skipIf(!url)("migration du solde XP : PostgreSQL local", () => {
  let db: PrismaClient;
  beforeAll(() => {
    if (new URL(url!).hostname !== "127.0.0.1") throw new Error("Postgres local uniquement");
    db = new PrismaClient({ datasourceUrl: url });
  });
  afterAll(async () => { await db?.$disconnect(); });

  it("initialise les soldes existants sans changer leur progression et garde le défaut zéro", async () => {
    await db.$transaction(async (tx) => {
      // La table temporaire masque la table métier sur cette connexion seulement.
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "CommunityMemberStats" ("userId" TEXT PRIMARY KEY, "xpTotal" INTEGER NOT NULL DEFAULT 0) ON COMMIT DROP');
      await tx.$executeRawUnsafe('INSERT INTO "CommunityMemberStats" VALUES (\'existing\', 1750), (\'zero\', 0)');
      for (const statement of statements) await tx.$executeRawUnsafe(statement);
      await tx.$executeRawUnsafe('INSERT INTO "CommunityMemberStats" ("userId") VALUES (\'new\')');
      expect(await tx.$queryRawUnsafe('SELECT * FROM "CommunityMemberStats" ORDER BY "userId"')).toEqual([
        { userId: "existing", xpTotal: 1750, xpBalance: 1750 },
        { userId: "new", xpTotal: 0, xpBalance: 0 },
        { userId: "zero", xpTotal: 0, xpBalance: 0 },
      ]);
    });
  });

  it("refuse un solde négatif en base", async () => {
    await expect(db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "CommunityMemberStats" ("userId" TEXT PRIMARY KEY, "xpTotal" INTEGER NOT NULL DEFAULT 0) ON COMMIT DROP');
      for (const statement of statements) await tx.$executeRawUnsafe(statement);
      await tx.$executeRawUnsafe('INSERT INTO "CommunityMemberStats" ("userId", "xpBalance") VALUES (\'negative\', -1)');
    })).rejects.toThrow(/CommunityMemberStats_xpBalance_nonnegative/);
  });

  it("conserve les grades, seuils de niveau et équipements existants", async () => {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "CommunityMemberStats" ("userId" TEXT PRIMARY KEY, "xpTotal" INTEGER NOT NULL, "equippedTitleId" TEXT, "streakCount" INTEGER) ON COMMIT DROP');
      for (const xp of [0, 49, 50, 799, 800, 4049, 4050, 10_000_000, 2_147_483_647]) {
        await tx.$executeRaw`INSERT INTO "CommunityMemberStats" VALUES (${String(xp)}, ${xp}, 'title-strategist', 7)`;
      }
      type Row = { userId: string; xpTotal: number; equippedTitleId: string; streakCount: number };
      const before = await tx.$queryRaw<Row[]>`SELECT "userId", "xpTotal", "equippedTitleId", "streakCount" FROM "CommunityMemberStats" ORDER BY "userId"`;
      for (const statement of statements) await tx.$executeRawUnsafe(statement);
      const after = await tx.$queryRaw<(Row & { xpBalance: number })[]>`SELECT "userId", "xpTotal", "equippedTitleId", "streakCount", "xpBalance" FROM "CommunityMemberStats" ORDER BY "userId"`;
      expect(after.map(({ xpBalance, ...row }) => {
        expect(xpBalance).toBe(row.xpTotal);
        return row;
      })).toEqual(before);
      const grade = (row: Row) => ({ level: levelForXp(row.xpTotal), rank: rankForLevel(levelForXp(row.xpTotal)), title: titleForLevel(levelForXp(row.xpTotal)) });
      expect(after.map(grade)).toEqual(before.map(grade));
    });
  });
});
