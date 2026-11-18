// Bascule xpBalance (#291) sur une base PostgreSQL LOCALE jetable uniquement.
// Dry-run par défaut. Jamais Neon : cible = conteneur Docker local lié à 127.0.0.1.
// Usage : node scripts/xp-balance-bascule.mjs [--execute --confirm-database=<base>]
//   env : XP_BASCULE_CONTAINER (déf. gamenight-xp-bascule-pg), XP_BASCULE_PORT (déf. 55471),
//         XP_BASCULE_DATABASE (obligatoire, ^gamenight_xp_[a-z0-9_]+$), XP_BASCULE_PG_PASSWORD (déf. test)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocalDockerContext, localDockerArgs } from "./recette-local-docker.mjs";
import { assertRolloutMigrationsPending, EXPECTED_ROLLOUT_MIGRATIONS } from "./xp-rollout-migration-gate.mjs";

export const DATABASE_PATTERN = /^gamenight_xp_[a-z0-9_]+$/;

export function assertLocalTarget({ container, port, database }) {
  assert.match(container, /^[A-Za-z0-9][A-Za-z0-9_.-]*$/, "Conteneur invalide");
  assert.match(port, /^[1-9]\d{3,4}$/, "Port invalide");
  assert.match(database, DATABASE_PATTERN, `Base refusée (attendu ${DATABASE_PATTERN})`);
  assert.ok(!/neon/i.test(`${container}${database}`), "Cible Neon interdite");
  return { container, port, database };
}

/** PRE = rien du lot appliqué ; MIGRATED = colonne + contrainte + valeur d'enum + les 6 migrations du lot (XP + vocal) terminées ; sinon PARTIAL (arrêt). */
export function classifyState({ hasColumn, hasConstraint, hasEnumValue, applied }) {
  const done = EXPECTED_ROLLOUT_MIGRATIONS.filter((name) => applied.includes(name));
  if (!hasColumn && !hasConstraint && !hasEnumValue && done.length === 0) return "PRE";
  if (hasColumn && hasConstraint && hasEnumValue && done.length === EXPECTED_ROLLOUT_MIGRATIONS.length) return "MIGRATED";
  return "PARTIAL";
}

// Empreinte de tout ce que la bascule ne doit PAS modifier (xpBalance exclu).
const FINGERPRINT_SQL = `SELECT md5(jsonb_build_object(
  'stats', (SELECT coalesce(jsonb_agg(to_jsonb(s) - 'xpBalance' ORDER BY "communityId", "userId"), '[]') FROM "CommunityMemberStats" s),
  'cosmetics', (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY "communityId", "userId", "itemId"), '[]') FROM "CommunityMemberCosmetic" c),
  'users', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', "id", 'xpTotal', "xpTotal") ORDER BY "id"), '[]') FROM "User"),
  'events', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', "id", 'reason', "reason", 'amount', "amount") ORDER BY "id"), '[]') FROM "XpEvent")
)::text) || ' ' || (SELECT count(*) FROM "CommunityMemberStats") || ' ' || (SELECT count(*) FROM "CommunityMemberCosmetic")
  || ' ' || (SELECT count(*) FROM "XpEvent") || ' ' || (SELECT coalesce(sum("xpTotal"), 0) FROM "CommunityMemberStats");`;

export function createRunner(target, env = process.env) {
  const dockerHost = assertLocalDockerContext();
  const docker = (args, options = {}) => {
    const result = spawnSync("docker", localDockerArgs(dockerHost, args), { encoding: "utf8", windowsHide: true, ...options });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim();
  };
  assert.equal(docker(["port", target.container, "5432/tcp"]), `127.0.0.1:${target.port}`, "Le conteneur doit être lié à 127.0.0.1:<port> uniquement");
  const password = env.XP_BASCULE_PG_PASSWORD ?? "test";
  const sql = (database, input) => {
    assert.match(database, DATABASE_PATTERN);
    return docker(["exec", "-i", target.container, "psql", "-X", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-At"], { input });
  };
  const migrate = (database, schema) => {
    assert.match(database, DATABASE_PATTERN);
    const url = `postgresql://postgres:${password}@127.0.0.1:${target.port}/${database}`;
    const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", schema], {
      encoding: "utf8", windowsHide: true, env: { ...env, DATABASE_URL: url },
    });
    if (result.error) throw result.error;
    return { status: result.status, output: (result.stdout + result.stderr).split(password).join("***") };
  };
  return { docker, sql, migrate };
}

export function inspect(runner, database) {
  const flag = (query) => runner.sql(database, query) === "t";
  const hasColumn = flag(`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='CommunityMemberStats' AND column_name='xpBalance');`);
  const hasConstraint = flag(`SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CommunityMemberStats_xpBalance_nonnegative');`);
  const hasEnumValue = flag(`SELECT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='XpReason' AND e.enumlabel='SHOP_BALANCE_PURCHASE');`);
  const rows = runner.sql(database, `SELECT migration_name || '|' || (finished_at IS NOT NULL AND rolled_back_at IS NULL) FROM _prisma_migrations ORDER BY migration_name;`).split("\n").filter(Boolean).map((line) => line.split("|"));
  const applied = rows.filter(([, ok]) => ok === "true").map(([name]) => name);
  const unfinished = rows.filter(([, ok]) => ok !== "true").map(([name]) => name);
  const negatives = Number(runner.sql(database, `SELECT count(*) FROM "CommunityMemberStats" WHERE "xpTotal" < 0;`));
  return { hasColumn, hasConstraint, hasEnumValue, applied, unfinished, negatives, state: classifyState({ hasColumn, hasConstraint, hasEnumValue, applied }) };
}

export function run(argv, env = process.env) {
  const execute = argv.includes("--execute");
  const confirm = argv.find((arg) => arg.startsWith("--confirm-database="))?.split("=")[1];
  const target = assertLocalTarget({
    container: env.XP_BASCULE_CONTAINER ?? "gamenight-xp-bascule-pg",
    port: env.XP_BASCULE_PORT ?? "55471",
    database: env.XP_BASCULE_DATABASE ?? "",
  });
  const runner = createRunner(target, env);
  assert.equal(runner.sql(target.database, "SELECT current_database();"), target.database);
  const report = { mode: execute ? "execute" : "dry-run", database: target.database };
  const info = inspect(runner, target.database);
  Object.assign(report, { state: info.state, negatives: info.negatives, unfinishedMigrations: info.unfinished });
  const fail = (reason) => { report.result = "REFUSÉ"; report.reason = reason; return report; };

  if (info.unfinished.length) return fail("migration en échec ou inachevée : revue manuelle, ne pas relancer");
  if (info.state === "PARTIAL") return fail("état partiel (colonne, contrainte, enum ou historique incohérents) : revue manuelle");
  report.fingerprintBefore = runner.sql(target.database, FINGERPRINT_SQL);

  if (info.state === "MIGRATED") {
    // Idempotence : jamais de recopie xpBalance = xpTotal (achats postérieurs légitimes).
    report.divergentBalances = Number(runner.sql(target.database, `SELECT count(*) FROM "CommunityMemberStats" WHERE "xpBalance" <> "xpTotal";`));
    report.negativeBalances = Number(runner.sql(target.database, `SELECT count(*) FROM "CommunityMemberStats" WHERE "xpBalance" < 0;`));
    report.result = report.negativeBalances === 0 ? "DÉJÀ BASCULÉ (aucune écriture)" : "DÉJÀ BASCULÉ mais soldes négatifs";
    return report;
  }

  // PRE
  if (info.negatives > 0) return fail("xpTotal négatif : la migration échouerait (contrainte) ; ne rien corriger automatiquement");
  const available = readdirSync(resolve("prisma/migrations"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  try { report.pending = assertRolloutMigrationsPending(available, info.applied, { unfinished: info.unfinished }); } catch (error) { return fail(String(error.message)); }
  if (!execute) { report.result = "DRY-RUN OK : aucune écriture, bascule possible avec --execute --confirm-database=<base>"; return report; }
  if (confirm !== target.database) return fail("--confirm-database=<base> absent ou différent");

  // 1. sauvegarde + restauration vérifiée dans une base jetable
  const stamp = Date.now();
  const scratch = `${target.database}_verify_${stamp}`.slice(0, 60);
  assert.match(scratch, DATABASE_PATTERN);
  const archive = `/tmp/${target.database}_${stamp}.dump`;
  runner.docker(["exec", target.container, "pg_dump", "-U", "postgres", "-Fc", "--file", archive, target.database]);
  mkdirSync("logs", { recursive: true });
  const backup = resolve(`logs/${target.database}_${stamp}.dump`);
  runner.docker(["cp", `${target.container}:${archive}`, backup]);
  report.backup = backup;
  report.backupSha256 = createHash("sha256").update(readFileSync(backup)).digest("hex");
  runner.docker(["exec", target.container, "createdb", "-U", "postgres", scratch]);
  runner.docker(["exec", target.container, "pg_restore", "-U", "postgres", "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl", "-d", scratch, archive]);
  report.fingerprintRestored = runner.sql(scratch, FINGERPRINT_SQL);
  runner.docker(["exec", target.container, "dropdb", "-U", "postgres", scratch]);
  if (report.fingerprintRestored !== report.fingerprintBefore) return fail("la sauvegarde restaurée diffère de la source : bascule interrompue");

  // 2. migrations
  const migration = runner.migrate(target.database, resolve("prisma/schema.prisma"));
  if (migration.status !== 0) {
    report.migrationOutput = migration.output.slice(-600);
    return fail("prisma migrate deploy a échoué : garder la maintenance, restaurer le dump dans une autre cible");
  }

  // 3. contrôles après bascule
  const after = inspect(runner, target.database);
  report.fingerprintAfter = runner.sql(target.database, FINGERPRINT_SQL);
  report.mismatchedBalances = Number(runner.sql(target.database, `SELECT count(*) FROM "CommunityMemberStats" WHERE "xpBalance" <> "xpTotal" OR "xpBalance" < 0;`));
  if (after.state !== "MIGRATED") return fail("état final inattendu");
  if (report.fingerprintAfter !== report.fingerprintBefore) return fail("progression, équipements, objets ou ledger modifiés");
  if (report.mismatchedBalances !== 0) return fail("soldes différents de la progression initiale");
  report.result = "BASCULE OK";
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = run(process.argv.slice(2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(String(report.result).startsWith("REFUSÉ") ? 1 : 0);
  } catch (error) {
    console.error(`Erreur : ${error.message}`);
    process.exit(2);
  }
}
