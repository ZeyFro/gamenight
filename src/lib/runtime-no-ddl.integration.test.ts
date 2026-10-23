import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

// Un rôle runtime sans droit DDL sur une base neuve `gamenight_noddl_*` (PostgreSQL de test, 127.0.0.1 uniquement),
// migrée par le propriétaire. Une seule suite par base : lancé par `npm run test:postgres`.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const DB = `gamenight_noddl_${Date.now()}`;
const ROLE = "gn_noddl_runtime";
const PASSWORD = "noddl-runtime-pass";

if (!TEST_DATABASE_URL) console.warn("[runtime-no-ddl] TEST_DATABASE_URL absente : tests du rôle runtime SKIPPÉS.");

describe.skipIf(!TEST_DATABASE_URL)("rôle runtime sans DDL", () => {
  let admin: PrismaClient;
  let owner: PrismaClient;
  let runtime: PrismaClient;
  const urlFor = (user?: string, password?: string) => {
    const url = new URL(TEST_DATABASE_URL!);
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("PostgreSQL local uniquement");
    url.pathname = `/${DB}`;
    if (user) { url.username = user; url.password = password ?? ""; }
    return url.toString();
  };
  /** Message de refus PostgreSQL (42501) pour une instruction exécutée par le rôle runtime. */
  const denied = async (sql: string) => {
    const error = await runtime.$executeRawUnsafe(sql).then(() => null, (e: Error) => e);
    expect(error, `${sql} aurait dû être refusé`).not.toBeNull();
    return error!.message;
  };

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
    await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS ${ROLE}`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${DB}"`);
    const deploy = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: urlFor() }, encoding: "utf8",
    });
    expect(deploy.status, deploy.stdout + deploy.stderr).toBe(0);
    owner = new PrismaClient({ datasourceUrl: urlFor() });
    for (const sql of [
      `CREATE ROLE ${ROLE} LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
      `REVOKE ALL ON DATABASE "${DB}" FROM PUBLIC`,
      `GRANT CONNECT ON DATABASE "${DB}" TO ${ROLE}`,
      `REVOKE CREATE ON SCHEMA public FROM PUBLIC`,
      `GRANT USAGE ON SCHEMA public TO ${ROLE}`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`,
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`,
      `REVOKE ALL ON TABLE "_prisma_migrations" FROM ${ROLE}`,
    ]) await owner.$executeRawUnsafe(sql);
    runtime = new PrismaClient({ datasourceUrl: urlFor(ROLE, PASSWORD) });
  }, 240_000);

  afterAll(async () => {
    await runtime?.$disconnect();
    await owner?.$disconnect();
    await admin?.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await admin?.$executeRawUnsafe(`DROP ROLE IF EXISTS ${ROLE}`);
    await admin?.$disconnect();
  }, 60_000);

  it("le rôle n'a aucun attribut dangereux", async () => {
    const rows = await owner.$queryRawUnsafe<Record<string, boolean>[]>(
      `SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname = '${ROLE}'`);
    expect(rows[0]).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolbypassrls: false });
  });

  it("CREATE / ALTER / DROP / TRUNCATE sont refusés (42501) et ne changent rien", async () => {
    for (const sql of [
      `CREATE TABLE "RuntimeIntrus" ("id" INTEGER)`,
      `CREATE SCHEMA runtime_intrus`,
      `CREATE INDEX "RuntimeIntrus_idx" ON "User" ("discordName")`,
      `ALTER TABLE "User" ADD COLUMN "runtimeIntrus" TEXT`,
      `ALTER TABLE "User" DROP COLUMN "discordName"`,
      `DROP TABLE "User"`,
      `TRUNCATE TABLE "User"`,
      `DROP TABLE "_prisma_migrations"`,
    ]) expect(await denied(sql), sql).toMatch(/permission denied|must be owner/i);
    const leftovers = await owner.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT (SELECT count(*) FROM information_schema.columns WHERE table_name = 'User' AND column_name IN ('runtimeIntrus')) + (SELECT count(*) FROM information_schema.tables WHERE table_name = 'RuntimeIntrus') AS n`);
    expect(Number(leftovers[0].n)).toBe(0);
  });

  it("l'historique des migrations est illisible et non modifiable par le runtime", async () => {
    expect(await denied(`DELETE FROM "_prisma_migrations"`)).toMatch(/permission denied/i);
    const read = await runtime.$queryRawUnsafe(`SELECT 1 FROM "_prisma_migrations" LIMIT 1`).then(() => null, (e: Error) => e);
    expect(read?.message).toMatch(/permission denied/i);
  });

  it("les opérations applicatives (SELECT / INSERT / UPDATE / DELETE) fonctionnent", async () => {
    const id = "noddl-user-1";
    expect(await runtime.$executeRawUnsafe(`INSERT INTO "User" ("id", "discordId", "discordName") VALUES ('${id}', 'noddl-discord-1', 'Runtime')`)).toBe(1);
    expect(await runtime.$queryRawUnsafe<{ discordName: string }[]>(`SELECT "discordName" FROM "User" WHERE "id" = '${id}'`)).toEqual([{ discordName: "Runtime" }]);
    expect(await runtime.$executeRawUnsafe(`UPDATE "User" SET "discordName" = 'Runtime2' WHERE "id" = '${id}'`)).toBe(1);
    expect(await runtime.$executeRawUnsafe(`DELETE FROM "User" WHERE "id" = '${id}'`)).toBe(1);
  });

  it("Prisma Client (chemin applicatif réel) lit et écrit avec ce rôle", async () => {
    const created = await runtime.user.create({ data: { discordId: "noddl-discord-2", discordName: "ViaClient" } });
    expect((await runtime.user.update({ where: { id: created.id }, data: { discordName: "ViaClient2" } })).discordName).toBe("ViaClient2");
    await runtime.user.delete({ where: { id: created.id } });
    expect(await runtime.user.count({ where: { id: created.id } })).toBe(0);
  });
});
