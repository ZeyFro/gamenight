import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

// Le CLI scripts/db-migrate.mjs de bout en bout sur une base neuve `gamenight_dbmigrate_*` créée dans le
// PostgreSQL de test (127.0.0.1 uniquement). Une seule suite par base : lancé par `npm run test:postgres`.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const ALL = readdirSync("prisma/migrations", { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
const NEW_DB = `gamenight_dbmigrate_${Date.now()}`;

if (!TEST_DATABASE_URL) console.warn("[db-migrate-cli] TEST_DATABASE_URL absente : tests du CLI SKIPPÉS.");

describe.skipIf(!TEST_DATABASE_URL)("db-migrate CLI : codes de sortie sur base neuve", () => {
  let admin: PrismaClient;
  const withDatabase = (database: string, user?: string, password?: string) => {
    const base = new URL(TEST_DATABASE_URL!);
    if (!["127.0.0.1", "localhost"].includes(base.hostname)) throw new Error("PostgreSQL local uniquement");
    base.pathname = `/${database}`;
    if (user) { base.username = user; base.password = password ?? ""; }
    return base.toString();
  };
  const SCRIPT = resolve("scripts/db-migrate.mjs");
  const run = (extra: string[], env: Record<string, string> = {}, options: { flags?: string[]; cwd?: string } = {}) => {
    const clean: NodeJS.ProcessEnv = { ...process.env };
    delete clean.DATABASE_URL;
    return spawnSync(process.execPath, [SCRIPT, ...(options.flags ?? ["--allow-local"]), ...extra], { env: { ...clean, ...env }, encoding: "utf8", cwd: options.cwd });
  };
  const historyTableExists = async (database: string) => {
    const client = new PrismaClient({ datasourceUrl: withDatabase(database) });
    try {
      const rows = await client.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM information_schema.tables WHERE table_name = '_prisma_migrations'`);
      return Number(rows[0].n) > 0;
    } finally { await client.$disconnect(); }
  };

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: TEST_DATABASE_URL });
    await admin.$executeRawUnsafe(`CREATE DATABASE "${NEW_DB}"`);
  }, 60_000);
  afterAll(async () => {
    await admin?.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${NEW_DB}" WITH (FORCE)`);
    await admin?.$executeRawUnsafe(`DROP ROLE IF EXISTS gn_cli_lowpriv`);
    await admin?.$disconnect();
  }, 60_000);

  it("refuse (2) sans variable, sans liste attendue, avec un argument inconnu, et n'écrit rien en dry-run (0)", async () => {
    expect(run([`--expect=${ALL.join(",")}`]).status).toBe(2);
    const url = withDatabase(NEW_DB);
    expect(run([], { MIGRATION_DATABASE_URL: url }).status).toBe(2);
    expect(run(["--bogus"], { MIGRATION_DATABASE_URL: url }).status).toBe(2);
    const dry = run([`--expect=${ALL.join(",")}`], { MIGRATION_DATABASE_URL: url });
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toContain("DRY-RUN");
    expect(await historyTableExists(NEW_DB), "le dry-run ne doit rien écrire").toBe(false);
  });

  it("refuse (2) une cible inattendue : hôte distant sans cible attendue ou différente, base locale hors gamenight_*, locale sans --allow-local", () => {
    const expectAll = `--expect=${ALL.join(",")}`;
    const remote = `${"postgresql:"}//gn_migrator:pw-remote@db-direct.example.invalid:5432/appdb`;
    const sans = run([expectAll], { MIGRATION_DATABASE_URL: remote });
    expect(sans.status).toBe(2);
    expect(sans.stderr).toContain("GAMENIGHT_EXPECTED_TARGET");
    const autre = run([expectAll], { MIGRATION_DATABASE_URL: remote, GAMENIGHT_EXPECTED_TARGET: "db-direct.example.invalid/autre" });
    expect(autre.status).toBe(2);
    expect(autre.stderr).toContain("Cible inattendue");
    expect(autre.stdout + autre.stderr).not.toContain("pw-remote");
    expect(run([expectAll], { MIGRATION_DATABASE_URL: withDatabase("postgres") }).status).toBe(2);
    const noFlag = run([expectAll], { MIGRATION_DATABASE_URL: withDatabase(NEW_DB) }, { flags: [] });
    expect(noFlag.status).toBe(2);
    expect(noFlag.stderr).toContain("--allow-local");
  });

  it("refuse (2) un rôle de migration identique au rôle runtime (URL ou nom) sans toucher la base", async () => {
    const expectAll = `--expect=${ALL.join(",")}`;
    const url = withDatabase(NEW_DB);
    const sameUrl = run([expectAll], { MIGRATION_DATABASE_URL: url, DATABASE_URL: url });
    expect(sameUrl.status).toBe(2);
    expect(sameUrl.stderr).toContain("autre rôle");
    const sameRole = run([expectAll], { MIGRATION_DATABASE_URL: url, GAMENIGHT_RUNTIME_ROLE: new URL(url).username });
    expect(sameRole.status).toBe(2);
    const exec = run([expectAll, "--execute", `--confirm-database=${NEW_DB}`], { MIGRATION_DATABASE_URL: url, DATABASE_URL: url });
    expect(exec.status).toBe(2);
    expect(await historyTableExists(NEW_DB)).toBe(false);
  });

  it("refuse (2) --execute sans confirmation et ne divulgue aucun mot de passe", () => {
    const url = withDatabase(NEW_DB);
    const out = run([`--expect=${ALL.join(",")}`, "--execute"], { MIGRATION_DATABASE_URL: url });
    expect(out.status).toBe(2);
    const password = new URL(url).password;
    if (password.length >= 4) expect(out.stdout + out.stderr).not.toContain(password);
  });

  it("échec de migration (3) avec un rôle sans droit de création, puis succès (0) avec le propriétaire", async () => {
    await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS gn_cli_lowpriv`);
    await admin.$executeRawUnsafe(`CREATE ROLE gn_cli_lowpriv LOGIN PASSWORD 'lowpriv-pass' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    await admin.$executeRawUnsafe(`REVOKE ALL ON DATABASE "${NEW_DB}" FROM PUBLIC`);
    await admin.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${NEW_DB}" TO gn_cli_lowpriv`);
    const low = run([`--expect=${ALL.join(",")}`, "--execute", `--confirm-database=${NEW_DB}`], {
      MIGRATION_DATABASE_URL: withDatabase(NEW_DB, "gn_cli_lowpriv", "lowpriv-pass"),
    });
    expect(low.status, low.stdout + low.stderr).toBe(3);
    expect(low.stdout + low.stderr).not.toContain("lowpriv-pass");

    const ok = run([`--expect=${ALL.join(",")}`, "--execute", `--confirm-database=${NEW_DB}`], { MIGRATION_DATABASE_URL: withDatabase(NEW_DB) });
    expect(ok.status, ok.stdout + ok.stderr).toBe(0);
    expect(ok.stdout).toContain(`${ALL.length} migration(s) appliquée(s)`);

    const again = run([`--expect=${ALL.at(-1)}`], { MIGRATION_DATABASE_URL: withDatabase(NEW_DB) });
    expect(again.status).toBe(2);
  }, 240_000);

  it("migration qui échoue en cours de route (3) : la première reste appliquée, la fautive est consignée inachevée, la reprise est refusée (2)", async () => {
    const midDb = `gamenight_dbmigrate_mid_${Date.now()}`;
    const work = mkdtempSync(join(tmpdir(), "gn-dbmigrate-mid-"));
    await admin.$executeRawUnsafe(`CREATE DATABASE "${midDb}"`);
    try {
      mkdirSync(join(work, "prisma", "migrations", "20260101000000_ok"), { recursive: true });
      mkdirSync(join(work, "prisma", "migrations", "20260101000001_boom"), { recursive: true });
      writeFileSync(join(work, "prisma", "schema.prisma"), "datasource db {\n  provider = \"postgresql\"\n  url      = env(\"DATABASE_URL\")\n}\n");
      writeFileSync(join(work, "prisma", "migrations", "migration_lock.toml"), "provider = \"postgresql\"\n");
      writeFileSync(join(work, "prisma", "migrations", "20260101000000_ok", "migration.sql"), "CREATE TABLE \"Ok\" (\"id\" INTEGER PRIMARY KEY);\n");
      writeFileSync(join(work, "prisma", "migrations", "20260101000001_boom", "migration.sql"), "CREATE TABLE \"Boom\" (\"id\" INTEGER PRIMARY KEY);\nSELECT 1/0;\n");
      symlinkSync(resolve("node_modules"), join(work, "node_modules"), "junction");
      const env = { MIGRATION_DATABASE_URL: withDatabase(midDb) };
      const args = ["--expect=20260101000000_ok,20260101000001_boom", "--execute", `--confirm-database=${midDb}`];
      const failed = run(args, env, { cwd: work });
      expect(failed.status, failed.stdout + failed.stderr).toBe(3);
      expect(failed.stdout).toContain("ÉCHEC de prisma migrate deploy");
      expect(failed.stdout).toContain("migrate resolve");

      const client = new PrismaClient({ datasourceUrl: withDatabase(midDb) });
      try {
        const rows = await client.$queryRawUnsafe<{ migration_name: string; finished: boolean }[]>(
          `SELECT migration_name, (finished_at IS NOT NULL) AS finished FROM _prisma_migrations ORDER BY migration_name`);
        expect(rows).toEqual([{ migration_name: "20260101000000_ok", finished: true }, { migration_name: "20260101000001_boom", finished: false }]);
        const tables = await client.$queryRawUnsafe<{ table_name: string }[]>(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('Ok','Boom')`);
        expect(tables.map((t) => t.table_name)).toEqual(["Ok"]);
      } finally { await client.$disconnect(); }

      const retry = run(args, env, { cwd: work });
      expect(retry.status).toBe(2);
      expect(retry.stderr).toContain("inachevée");
    } finally {
      rmSync(work, { recursive: true, force: true });
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${midDb}" WITH (FORCE)`);
    }
  }, 240_000);
});
