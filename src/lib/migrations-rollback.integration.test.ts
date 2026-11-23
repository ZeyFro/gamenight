import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { readMigration, readRollback, rollbackNames, sqlStatements } from "./migrations-rollback-files";

/**
 * Cahier §21.4 « validation de la bascule » : pour chaque retour arrière, sur la base de test, DANS UNE TRANSACTION
 * TOUJOURS ANNULÉE (le DDL PostgreSQL est transactionnel) : retour arrière, puis migration rejouée. Les deux doivent
 * passer sans erreur, et le schéma est inchangé à la fin. Jamais sur Neon (adresse 127.0.0.1 exigée).
 */
const url = process.env.TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!["postgres:", "postgresql:"].includes(target.protocol) || target.hostname !== "127.0.0.1" || target.searchParams.has("host")) {
    throw new Error("PostgreSQL loopback isolé requis");
  }
}

class Rollback extends Error {}

describe.skipIf(!url)("retours arrière des migrations : validés dans une transaction annulée", () => {
  let db: PrismaClient;
  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    db = new PrismaClient({ datasourceUrl: url });
  });
  afterAll(async () => { await db?.$disconnect(); });

  const columns = () => db.$queryRaw<{ c: bigint }[]>`SELECT COUNT(*)::bigint AS c FROM information_schema.columns WHERE table_schema = 'public'`;

  it.each(rollbackNames().map(name => [name]))("%s : retour arrière puis migration rejouée", async name => {
    const [applied] = await db.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "_prisma_migrations" WHERE migration_name = ${name} AND finished_at IS NOT NULL`;
    expect(applied.n, `${name} doit être appliquée sur la base de test (prisma migrate deploy)`).toBe(BigInt(1));
    const before = await columns();
    await expect(db.$transaction(async tx => {
      for (const statement of sqlStatements(readRollback(name))) await tx.$executeRawUnsafe(statement);
      for (const statement of sqlStatements(readMigration(name))) await tx.$executeRawUnsafe(statement);
      throw new Rollback("annulation volontaire");
    }, { timeout: 20_000 })).rejects.toBeInstanceOf(Rollback);
    expect(await columns()).toEqual(before);
  });
});
