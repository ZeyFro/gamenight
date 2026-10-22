import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
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
  const run = (extra: string[], env: Record<string, string> = {}) => {
    const clean: NodeJS.ProcessEnv = { ...process.env, ...env };
    delete clean.DATABASE_URL;
    return spawnSync(process.execPath, ["scripts/db-migrate.mjs", "--allow-local", ...extra], { env: clean, encoding: "utf8" });
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

  it("refuse (2) sans variable, sans liste attendue, avec un argument inconnu, et n'écrit rien en dry-run (0)", () => {
    expect(run([`--expect=${ALL.join(",")}`]).status).toBe(2);
    const url = withDatabase(NEW_DB);
    expect(run([], { MIGRATION_DATABASE_URL: url }).status).toBe(2);
    expect(run(["--bogus"], { MIGRATION_DATABASE_URL: url }).status).toBe(2);
    const dry = run([`--expect=${ALL.join(",")}`], { MIGRATION_DATABASE_URL: url });
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toContain("DRY-RUN");
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
});
