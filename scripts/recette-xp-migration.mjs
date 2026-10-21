// Répétition locale uniquement : bases neuves et sauvegarde conservées, jamais Neon.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertLocalDockerContext } from "./recette-local-docker.mjs";

const baseline = resolve(process.argv[2] ?? "");
assert.ok(baseline.endsWith("schema.prisma"), "Donner le schéma du checkout main sans migration XP");
assert.ok(!readFileSync(baseline, "utf8").includes("xpBalance"), "Le baseline doit précéder #291");
const container = "gamenight-test-pg";
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, ...options });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}
assertLocalDockerContext();
assert.equal(run("docker", ["port", container, "5432/tcp"]), "127.0.0.1:55439");
const stamp = Date.now();
const database = `gamenight_xp_rehearsal_${stamp}`;
const restored = `gamenight_xp_restore_${stamp}`;
const failed = `gamenight_xp_failure_${stamp}`;
for (const name of [database, restored, failed]) {
  assert.match(name, /^gamenight_xp_(rehearsal|restore|failure)_\d+$/);
  run("docker", ["exec", container, "createdb", "-U", "postgres", name]);
}
function sql(name, input) {
  assert.ok([database, restored, failed].includes(name));
  return run("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", name, "-v", "ON_ERROR_STOP=1", "-At"], { input });
}
function migrate(schema) {
  const env = { ...process.env, DATABASE_URL: `postgresql://postgres:test@127.0.0.1:55439/${database}` };
  run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", schema], { env });
}
assert.equal(sql(database, "SELECT current_database();"), database);
migrate(baseline);
const values = [0, 49, 50, 799, 800, 4049, 4050, 10_000_000, 2_147_483_647];
for (const [index, xp] of values.entries()) {
  sql(database, `BEGIN;
    INSERT INTO "User" ("id", "discordId", "discordName") VALUES ('xp-${index}', 'rehearsal-${index}', 'Rehearsal ${index}');
    INSERT INTO "CommunityMemberStats" ("communityId", "userId", "xpTotal", "streakCount", "bestStreakCount", "tournamentsParticipatedCount")
      VALUES ('rehearsal-a', 'xp-${index}', ${xp}, 3, 7, 2);
    COMMIT;`);
}
sql(database, `INSERT INTO "CommunityMemberStats" ("communityId", "userId", "xpTotal", "equippedTitleId") VALUES ('rehearsal-b', 'xp-6', 1750, 'title-strategist');
  INSERT INTO "CommunityMemberCosmetic" ("communityId", "userId", "itemId") VALUES ('rehearsal-b', 'xp-6', 'title-strategist');`);
const snapshot = `SELECT jsonb_build_object(
  'stats', (SELECT jsonb_agg(to_jsonb(s) - 'xpBalance' ORDER BY "communityId", "userId") FROM "CommunityMemberStats" s),
  'cosmetics', (SELECT jsonb_agg(to_jsonb(c) ORDER BY "communityId", "userId", "itemId") FROM "CommunityMemberCosmetic" c),
  'users', (SELECT jsonb_agg(jsonb_build_object('id', "id", 'xpTotal', "xpTotal") ORDER BY "id") FROM "User"));`;
const before = sql(database, snapshot);
const archive = `/tmp/${database}.dump`;
run("docker", ["exec", container, "pg_dump", "-U", "postgres", "-Fc", "--file", archive, database]);
mkdirSync("logs", { recursive: true });
const backup = resolve(`logs/${database}.dump`);
run("docker", ["cp", `${container}:${archive}`, backup]);
run("docker", ["exec", container, "pg_restore", "-U", "postgres", "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl", "-d", restored, archive]);
assert.equal(sql(restored, snapshot), before, "La sauvegarde restaurée doit restituer progression, équipement et objets");
migrate(resolve("prisma/schema.prisma"));
assert.equal(sql(database, snapshot), before, "La migration ne doit altérer aucune donnée existante");
assert.equal(sql(database, 'SELECT count(*) FROM "CommunityMemberStats" WHERE "xpBalance" <> "xpTotal" OR "xpBalance" < 0;'), "0");
const runtimeRole = `gamenight_xp_readonly_${stamp}`;
sql(database, `CREATE ROLE ${runtimeRole} NOLOGIN; GRANT USAGE ON SCHEMA public TO ${runtimeRole}; GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${runtimeRole};`);
assert.equal(sql(database, `SET ROLE ${runtimeRole}; SELECT count(*) FROM "CommunityMemberStats";`).split("\n").at(-1), String(values.length + 1));
const denied = spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-At"], {
  encoding: "utf8", windowsHide: true,
  input: `SET ROLE ${runtimeRole}; UPDATE "CommunityMemberStats" SET "xpTotal" = "xpTotal" + 1;`,
});
if (denied.error) throw denied.error;
assert.notEqual(denied.status, 0);
assert.match(denied.stderr, /permission denied/);
assert.equal(sql(database, snapshot), before);
// Une écriture de l'ancienne version suffit à prouver que la coexistence est interdite.
sql(database, 'UPDATE "CommunityMemberStats" SET "xpTotal" = "xpTotal" + 30 WHERE "communityId" = \'rehearsal-a\' AND "userId" = \'xp-6\';');
assert.equal(sql(database, 'SELECT "xpTotal" - "xpBalance" FROM "CommunityMemberStats" WHERE "communityId" = \'rehearsal-a\' AND "userId" = \'xp-6\';'), "30");
assert.equal(sql(restored, snapshot), before, "La base de récupération doit rester au point avant bascule");
assert.equal(sql(restored, "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='CommunityMemberStats' AND column_name='xpBalance';"), "0");
run("docker", ["exec", container, "pg_restore", "-U", "postgres", "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl", "-d", failed, archive]);
sql(failed, 'UPDATE "CommunityMemberStats" SET "xpTotal" = -1 WHERE "userId" = \'xp-0\';');
const failure = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", resolve("prisma/schema.prisma")], {
  encoding: "utf8", windowsHide: true, env: { ...process.env, DATABASE_URL: `postgresql://postgres:test@127.0.0.1:55439/${failed}` },
});
if (failure.error) throw failure.error;
assert.notEqual(failure.status, 0);
assert.match(failure.stderr + failure.stdout, /CommunityMemberStats_xpBalance_nonnegative/);
assert.equal(sql(failed, "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='CommunityMemberStats' AND column_name='xpBalance';"), "0");
assert.equal(sql(failed, "SELECT count(*) FROM pg_constraint WHERE conname='CommunityMemberStats_xpBalance_nonnegative';"), "0");
assert.equal(sql(failed, "SELECT count(*) FROM _prisma_migrations WHERE migration_name='20261019190000_separate_xp_balance' AND finished_at IS NULL AND rolled_back_at IS NULL;"), "1");
const proof = { database, restored, failed, runtimeRole, runtimeWrites: "denied, SELECT allowed (local privilege rehearsal only)", backup, sha256: createHash("sha256").update(readFileSync(backup)).digest("hex"), rows: values.length + 1,
  backupRestore: "identical", migration: "progression/equipment/cosmetics unchanged; balances equal progression", oldWriter: "30 XP drift reproduced", recovery: "baseline schema and data recovered", failure: "negative legacy XP rolls back schema changes with Prisma 6.19.3; failed migration record blocks retry", production: "never accessed" };
writeFileSync(`logs/xp-migration-${stamp}.json`, JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof, null, 2));
