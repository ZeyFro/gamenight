import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RefusalError } from "../../scripts/db-migrate-lib.mjs";
import { ALLOWED_SQL, DEFAULT_LOT, SQL, evaluate, guard, readPrecheckArgs } from "../../scripts/prod-precheck-lib.mjs";
import { EXPECTED_ROLLOUT_MIGRATIONS } from "../../scripts/xp-rollout-migration-gate.mjs";

const PASSWORD = "pw-precheck-secret";
const remote = `${"postgresql:"}//owner:${PASSWORD}@db.example.invalid:5432/appdb`;
const run = (argv: string[], env: Record<string, string> = {}) => {
  const clean: NodeJS.ProcessEnv = { ...process.env };
  for (const k of ["DATABASE_URL", "GAMENIGHT_PRECHECK_DATABASE_URL", "GAMENIGHT_EXPECTED_TARGET"]) delete clean[k];
  return spawnSync(process.execPath, [resolve("scripts/prod-precheck.mjs"), ...argv], { env: { ...clean, ...env }, encoding: "utf8", timeout: 20000 });
};

describe("prod-precheck : liste blanche", () => {
  it("accepte exactement ses constantes, refuse tout le reste avant envoi (code 2)", () => {
    for (const sql of ALLOWED_SQL) expect(guard(sql)).toBe(sql);
    for (const bad of [
      "INSERT INTO \"User\" (id) VALUES ('x')", "UPDATE _prisma_migrations SET finished_at = now()", "DROP TABLE \"User\"", "TRUNCATE \"XpEvent\"",
      "select 1", `${SQL.migrations};`, `${SQL.migrations}; DROP TABLE x`, ` ${SQL.identity}`, `${SQL.identity} -- x`, "SELECT pg_terminate_backend(pid) FROM pg_stat_activity",
      "SELECT query FROM pg_stat_activity", "SELECT rolpassword FROM pg_authid", "ALTER ROLE x NOLOGIN", "BEGIN READ WRITE", "SET TRANSACTION READ WRITE", "",
    ]) {
      expect(() => guard(bad), bad).toThrow(RefusalError);
    }
    expect(() => guard("DROP TABLE x")).toThrow(expect.objectContaining({ exitCode: 2 }));
  });

  it("n'autorise que des SELECT (plus SET TRANSACTION READ ONLY), sans mutation, sans texte de requête ni condensat de mot de passe", () => {
    const forbidden = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|call|do|set_config|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_sleep|nextval|setval|lo_\w+|dblink\w*|pg_read_file|pg_ls_dir|rolpassword|pg_authid|pg_shadow|query)\b/i;
    for (const sql of ALLOWED_SQL as Set<string>) {
      if (sql === SQL.readOnly) continue;
      expect(sql, sql).toMatch(/^SELECT /);
      expect(sql, sql).not.toContain(";");
      expect(sql, sql).not.toMatch(forbidden);
    }
    expect(SQL.readOnly).toBe("SET TRANSACTION READ ONLY");
  });
});

describe("prod-precheck : arguments", () => {
  it("exige --state, refuse toute URL ou forme inconnue sans l'afficher", () => {
    expect(readPrecheckArgs(["--state=pre"])).toMatchObject({ state: "pre", lot: DEFAULT_LOT, allowLocal: false });
    expect(() => readPrecheckArgs([])).toThrow(/--state/);
    expect(() => readPrecheckArgs(["--state=autre"])).toThrow(RefusalError);
    for (const arg of [remote, `--url=${remote}`, "--password=x", "pre"]) {
      expect(() => readPrecheckArgs(["--state=pre", arg]), arg).toThrow(RefusalError);
      try { readPrecheckArgs(["--state=pre", arg]); } catch (error) { expect((error as Error).message).not.toContain(PASSWORD); }
    }
    expect(() => readPrecheckArgs(["--state=pre", "--allow-local=1"])).toThrow(/sans valeur/);
    expect(readPrecheckArgs(["--state=post", "--require-no-sessions-of=neondb_owner"]).noSessionsOf).toBe("neondb_owner");
    expect(() => readPrecheckArgs(["--state=post", "--require-no-sessions-of=a;b"])).toThrow(RefusalError);
  });

  it("le lot par défaut = lot du garde de déploiement, et chaque migration existe", () => {
    expect(DEFAULT_LOT).toEqual(EXPECTED_ROLLOUT_MIGRATIONS);
    const dirs = new Set(readdirSync("prisma/migrations", { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name));
    for (const name of DEFAULT_LOT) expect(dirs.has(name), name).toBe(true);
  });
});

describe("prod-precheck : CLI sans base (refus avant toute connexion)", () => {
  it("code 2 : sans variable, URL en argument, cible inattendue, locale sans --allow-local, URL concurrente ; aucun mot de passe affiché", () => {
    const cases = [
      run(["--state=pre"]),
      run(["--state=pre", remote]),
      run(["--state=pre"], { GAMENIGHT_PRECHECK_DATABASE_URL: remote }),
      run(["--state=pre"], { GAMENIGHT_PRECHECK_DATABASE_URL: remote, GAMENIGHT_EXPECTED_TARGET: "autre.example.invalid/appdb" }),
      run(["--state=pre"], { GAMENIGHT_PRECHECK_DATABASE_URL: `${"postgresql:"}//u:${PASSWORD}@127.0.0.1:55485/gamenight_x`, GAMENIGHT_EXPECTED_TARGET: "127.0.0.1/gamenight_x" }),
      run(["--state=pre"], { GAMENIGHT_PRECHECK_DATABASE_URL: remote, GAMENIGHT_EXPECTED_TARGET: "db.example.invalid:5432/appdb", DIRECT_URL: remote }),
    ];
    for (const out of cases) {
      expect(out.status, out.stdout + out.stderr).toBe(2);
      expect(out.stdout + out.stderr).not.toContain(PASSWORD);
    }
  });
});

const base = {
  args: readPrecheckArgs(["--state=pre"]), checkout: ["a", ...DEFAULT_LOT].sort(),
  migrations: [{ migration_name: "a", finished: true, rolled_back: false }],
  roles: [{ rolname: "neondb_owner", rolsuper: false, rolcanlogin: true, rolcreatedb: true, rolcreaterole: true, rolreplication: false, rolbypassrls: true }],
  members: [] as [string, string, boolean][], tableOwners: [["neondb_owner", 86]] as [string, number][], sessions: [] as [string, string, string, number][],
  stats: { rows: 5, negativeTotals: 0, sumTotal: "10", relationBytes: 8192, databaseBytes: 1, balance: null as null | { negatives: number; divergent: number; sum: string } },
  runtimeRole: "gn_runtime", migrationRole: "gn_migrator",
};
const done = DEFAULT_LOT.map((migration_name) => ({ migration_name, finished: true, rolled_back: false }));

describe("prod-precheck : évaluation", () => {
  it("avant : conforme quand le lot entier est en attente, sinon écart", () => {
    expect(evaluate(base).gaps).toBe(0);
    expect(evaluate({ ...base, migrations: [...base.migrations, done[0]] }).gaps).toBeGreaterThan(0);
  });

  it("détecte inachevée, annulée sans reprise, absente du checkout, négatif ; une annulée reprise est admise", () => {
    const gaps = (migrations: typeof base.migrations) => evaluate({ ...base, migrations }).lines.filter((l) => l.level === "ÉCART").map((l) => l.text).join("|");
    expect(gaps([...base.migrations, { migration_name: "a", finished: false, rolled_back: false }])).toMatch(/inachevée/);
    expect(gaps([...base.migrations, { migration_name: DEFAULT_LOT[0], finished: false, rolled_back: true }])).toMatch(/annulée sans reprise/);
    expect(gaps([...base.migrations, { migration_name: "zzz", finished: true, rolled_back: false }])).toMatch(/absent du checkout/);
    expect(evaluate({ ...base, migrations: [{ migration_name: "a", finished: false, rolled_back: true }, ...base.migrations] }).gaps).toBe(0);
    expect(evaluate({ ...base, stats: { ...base.stats, negativeTotals: 2 } }).gaps).toBe(1);
  });

  it("après : conforme avec le lot terminé et la colonne xpBalance, écart sinon", () => {
    const post = { ...base, args: readPrecheckArgs(["--state=post"]), migrations: [...base.migrations, ...done], stats: { ...base.stats, balance: { negatives: 0, divergent: 3, sum: "10" } } };
    expect(evaluate(post).gaps).toBe(0);
    expect(evaluate({ ...post, stats: { ...post.stats, balance: { negatives: 1, divergent: 0, sum: "1" } } }).gaps).toBe(1);
    expect(evaluate({ ...post, stats: { ...post.stats, balance: null } }).gaps).toBe(1);
    expect(evaluate({ ...post, migrations: base.migrations }).gaps).toBeGreaterThan(0);
  });

  it("--require-split-roles et --require-no-sessions-of", () => {
    const split = { ...base, args: readPrecheckArgs(["--state=pre", "--require-split-roles"]) };
    expect(evaluate(split).gaps).toBeGreaterThanOrEqual(2);
    const attrs = { rolsuper: false, rolcanlogin: true, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false };
    const roles = [...base.roles, { rolname: "gn_runtime", ...attrs }, { rolname: "gn_migrator", ...attrs }];
    expect(evaluate({ ...split, roles }).gaps).toBe(0);
    expect(evaluate({ ...split, roles: roles.map((r) => (r.rolname === "gn_runtime" ? { ...r, rolbypassrls: true } : r)) }).gaps).toBe(1);
    expect(evaluate({ ...split, roles, tableOwners: [["gn_runtime", 1]] }).gaps).toBe(1);
    const barrier = { ...base, args: readPrecheckArgs(["--state=pre", "--require-no-sessions-of=neondb_owner"]) };
    expect(evaluate({ ...barrier, sessions: [["neondb_owner", "app", "idle", 2]] }).gaps).toBe(1);
    expect(evaluate({ ...barrier, sessions: [["gn_migrator", "x", "idle", 1]] }).gaps).toBe(0);
  });
});
