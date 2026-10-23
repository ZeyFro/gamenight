// Répétition COMPLÈTE de la bascule XP (#291) + vocal, en local (Docker 127.0.0.1) uniquement.
//   node scripts/rehearse-xp-full.mjs
// Prérequis : deux conteneurs postgres:16-alpine JETABLES liés à 127.0.0.1 (A : base de répétition,
//   B : cible de restauration), `npm ci` fait, ref `origin/main` présente (git fetch origin main).
//   env : XP_FULL_CONTAINER_A (déf. gn-a2-pg-20261023) XP_FULL_PORT_A (55472)
//         XP_FULL_CONTAINER_B (déf. gn-a2-restore-20261023) XP_FULL_PORT_B (55476)   XP_FULL_HOST (127.0.0.1 seul admis)
// Étapes : baseline = migrations de origin/main seules, données déterministes, sauvegarde + empreinte, barrière
// d'écriture (rôle runtime NOLOGIN + terminate), migrations XP + vocales via scripts/db-migrate.mjs (rôle distinct),
// vérifications, bascule, idempotence, puis échecs injectés (migration interrompue, mauvaises cibles, bascule
// interrompue/reprise) et repli = restauration sur B avec empreinte identique. Les sauvegardes vivent dans un
// dossier temporaire HORS dépôt, supprimé en fin de run. Aucun secret réel : mots de passe jetables de répétition.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocalDockerContext, localDockerArgs } from "./recette-local-docker.mjs";
import {
  assertOutsideRepo, assertRehearsalTarget, assertStepOrder, compareFingerprints, createContainer, HOST,
} from "./xp-backup-restore.mjs";
import { EXPECTED_XP_MIGRATIONS } from "./xp-rollout-migration-gate.mjs";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PW = { runtime: "gn-a2-runtime-pw", migrator: "gn-a2-migrator-pw", admin: "test" };
const stamp = Date.now();
const cfg = {
  host: process.env.XP_FULL_HOST ?? HOST,
  containerA: process.env.XP_FULL_CONTAINER_A ?? "gn-a2-pg-20261023",
  portA: process.env.XP_FULL_PORT_A ?? "55472",
  containerB: process.env.XP_FULL_CONTAINER_B ?? "gn-a2-restore-20261023",
  portB: process.env.XP_FULL_PORT_B ?? "55476",
};
const db = (label) => `gamenight_xp_${label}_${stamp}`;
const NAMES = { main: db("full"), fail: db("fail"), resumeA: db("resume_a"), resumeB: db("resume_b"), restore: db("restore") };
const url = (user, password, port, database) => `${"postgresql:"}//${user}:${password}@${HOST}:${port}/${database}`;
const redact = (text) => Object.values(PW).reduce((t, s) => t.split(s).join("***"), String(text));

const executed = [];
const log = [];
const say = (line) => { console.log(redact(line)); log.push(redact(line)); };
async function step(name, fn) {
  say(`\n=== ${name}`);
  executed.push(name);
  assertStepOrder(executed);
  const result = await fn();
  say(`OK ${name}`);
  return result;
}
const check = (label, condition, detail = "") => { assert.ok(condition, `ÉCHEC : ${label} ${detail}`); say(`  ok  ${label}`); };

function run(command, args, { cwd = REPO, env = {}, input } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true, input, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  return { status: result.status, out: redact(`${result.stdout ?? ""}${result.stderr ?? ""}`.trim()) };
}

/** Répertoire de travail jetable : copie de scripts + prisma (éventuellement altérée) + jonction vers node_modules. */
function makeWorkdir(tmp, name, { scripts, dropMigrations = [], breakMigration } = {}) {
  const dir = join(tmp, name);
  mkdirSync(join(dir, "scripts"), { recursive: true });
  for (const file of scripts) cpSync(join(REPO, "scripts", file), join(dir, "scripts", file));
  cpSync(join(REPO, "prisma"), join(dir, "prisma"), { recursive: true });
  for (const migration of dropMigrations) rmSync(join(dir, "prisma", "migrations", migration), { recursive: true });
  if (breakMigration) appendFileSync(join(dir, "prisma", "migrations", breakMigration, "migration.sql"), '\nALTER TABLE "TableInexistanteRepetition" ADD COLUMN "x" INTEGER;\n');
  symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"), "junction");
  return dir;
}
const dropJunction = (dir) => { if (existsSync(join(dir, "node_modules"))) unlinkSync(join(dir, "node_modules")); };

const MIGRATE_SCRIPTS = ["db-migrate.mjs", "db-migrate-lib.mjs"];
const BASCULE_SCRIPTS = ["xp-balance-bascule.mjs", "xp-rollout-migration-gate.mjs", "recette-local-docker.mjs"];

function dbMigrate(cwd, { port, database, expect, execute = false, confirm, allowLocal = true, user = "gn_migrator", password = PW.migrator, runtimeUser = "gn_runtime", extraEnv = {} }) {
  const args = ["scripts/db-migrate.mjs", `--expect=${expect.join(",")}`];
  if (allowLocal) args.push("--allow-local");
  if (execute) args.push("--execute");
  if (confirm) args.push(`--confirm-database=${confirm}`);
  const env = {
    MIGRATION_DATABASE_URL: url(user, password, port, database),
    DATABASE_URL: url(runtimeUser, PW.runtime, port, database),
    GAMENIGHT_EXPECTED_TARGET: "", GAMENIGHT_RUNTIME_ROLE: "", ...extraEnv,
  };
  return run(process.execPath, args, { cwd, env });
}

function bascule(cwd, { container, port, database, args = [] }) {
  const result = run(process.execPath, ["scripts/xp-balance-bascule.mjs", ...args], {
    cwd, env: { XP_BASCULE_CONTAINER: container, XP_BASCULE_PORT: port, XP_BASCULE_DATABASE: database },
  });
  let report;
  try { report = JSON.parse(result.out); } catch { report = { raw: result.out }; }
  return { status: result.status, report };
}

const SEED_SQL = `
INSERT INTO "User" ("id","discordId","discordName") SELECT 'u'||g, 'discord-'||g, 'Joueur '||g FROM generate_series(1,300) g;
-- La communauté par défaut existe déjà (id aléatoire posé par une migration) : id déterministe pour l'empreinte.
UPDATE "Community" SET "id" = 'comm-default' WHERE "slug" = 'default';
INSERT INTO "Community" ("id","slug","name","updatedAt") VALUES ('comm-alpha','alpha','Alpha','2026-10-01'),('comm-beta','beta','Beta','2026-10-01');
INSERT INTO "Membership" ("id","communityId","userId")
  SELECT 'm-default-'||g, 'comm-default', 'u'||g FROM generate_series(1,300) g
  UNION ALL SELECT 'm-alpha-'||g, 'comm-alpha', 'u'||g FROM generate_series(1,300) g WHERE g % 2 = 0
  UNION ALL SELECT 'm-beta-'||g, 'comm-beta', 'u'||g FROM generate_series(1,300) g WHERE g % 3 = 0;
-- Progression : bornes de niveaux/grades et maximum Int pour les 9 premiers, sinon formule déterministe.
INSERT INTO "CommunityMemberStats" ("communityId","userId","xpTotal","streakCount","bestStreakCount","tournamentsParticipatedCount")
  SELECT "communityId","userId",
    CASE WHEN substr("userId",2)::int <= 9 AND "communityId" = 'comm-default' THEN (ARRAY[0,49,50,799,800,4049,4050,10000000,2147483647])[substr("userId",2)::int]
         ELSE (substr("userId",2)::int * 37 + length("communityId") * 101) % 6000 END,
    substr("userId",2)::int % 9, substr("userId",2)::int % 14, substr("userId",2)::int % 5
  FROM "Membership";
-- Achats : objets possédés + débit historique au ledger.
INSERT INTO "CommunityMemberCosmetic" ("communityId","userId","itemId")
  SELECT "communityId","userId",'title-strategist' FROM "CommunityMemberStats" WHERE substr("userId",2)::int % 4 = 0
  UNION ALL SELECT "communityId","userId",'frame-gold' FROM "CommunityMemberStats" WHERE substr("userId",2)::int % 8 = 0;
UPDATE "CommunityMemberStats" SET "equippedTitleId" = 'title-strategist' WHERE substr("userId",2)::int % 4 = 0;
INSERT INTO "XpEvent" ("communityId","id","userId","reason","sourceId","amount","createdAt")
  SELECT "communityId", 'ev-att-'||"communityId"||'-'||"userId", "userId", 'SESSION_ATTENDANCE'::"XpReason", 'src-'||"userId", 25, timestamp '2026-10-01' + substr("userId",2)::int * interval '1 minute' FROM "CommunityMemberStats"
  UNION ALL SELECT "communityId", 'ev-shop-'||"communityId"||'-'||"userId", "userId", 'SHOP_PURCHASE', 'shop-title', -50, timestamp '2026-10-02' + substr("userId",2)::int * interval '1 minute' FROM "CommunityMemberStats" WHERE substr("userId",2)::int % 4 = 0;
INSERT INTO "XpBet" ("id","communityId","voterId","targetUserId","amount","won","allIn","createdAt")
  SELECT 'bet'||g, 'comm-default', 'u'||g, 'u'||(g % 300 + 1), 5 + g % 20, CASE g % 3 WHEN 0 THEN true WHEN 1 THEN false ELSE NULL END, g % 7 = 0, timestamp '2026-10-03' + g * interval '1 minute'
  FROM generate_series(1,120) g;`;

const ROLES_SQL = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gn_migrator') THEN CREATE ROLE gn_migrator LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB PASSWORD '${PW.migrator}'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='gn_runtime') THEN CREATE ROLE gn_runtime LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB PASSWORD '${PW.runtime}'; END IF;
END $$;
ALTER ROLE gn_runtime LOGIN;`;

function createDatabase(c, name) {
  assertRehearsalTarget({ host: cfg.host, port: c.port, container: c.container, database: name });
  c.sql("postgres", `CREATE DATABASE "${name}" OWNER gn_migrator;`);
}
function createOwnedDatabase(c, name) {
  createDatabase(c, name);
  c.sql(name, `ALTER DEFAULT PRIVILEGES FOR ROLE gn_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gn_runtime;
    ALTER DEFAULT PRIVILEGES FOR ROLE gn_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO gn_runtime;`);
}

const migrationNames = (dir) => readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "migration.sql"))).map((e) => e.name).sort();
const applied = (c, database) => c.sql(database, `SELECT migration_name || '|' || (finished_at IS NOT NULL AND rolled_back_at IS NULL) FROM _prisma_migrations ORDER BY 1;`).split("\n").filter(Boolean).map((l) => l.split("|"));
const hasColumn = (c, database) => c.sql(database, `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='CommunityMemberStats' AND column_name='xpBalance');`) === "t";

async function main() {
  const summary = { startedAt: new Date().toISOString(), steps: executed, outputs: {} };
  const tmp = assertOutsideRepo(mkdtempSync(join(tmpdir(), "gn-a2-xp-full-")), REPO);
  const workdirs = [];
  let c;
  let cb;
  const created = { a: [], b: [] };
  try {
    // ------------------------------------------------------------------ 1. préflight
    await step("preflight", () => {
      for (const [container, port] of [[cfg.containerA, cfg.portA], [cfg.containerB, cfg.portB]]) {
        assertRehearsalTarget({ host: cfg.host, port, container, database: NAMES.main });
      }
      check("conteneurs A et B distincts", cfg.containerA !== cfg.containerB && cfg.portA !== cfg.portB);
      for (const [key, value] of Object.entries(process.env)) {
        if (/DATABASE|POSTGRES|PG|DIRECT|URL/i.test(key) && /neon/i.test(String(value))) throw new Error(`Variable ${key} pointe vers Neon : refus`);
      }
      assertLocalDockerContext();
      c = createContainer({ container: cfg.containerA, port: cfg.portA });
      cb = createContainer({ container: cfg.containerB, port: cfg.portB });
      check("docker local et liaison 127.0.0.1 des deux conteneurs", true);
      const ref = run("git", ["rev-parse", "--verify", "origin/main"]);
      check("ref origin/main présente", ref.status === 0, ref.out);
      summary.originMain = ref.out;
      for (const x of [c, cb]) x.sql("postgres", ROLES_SQL);
      check("rôles de répétition gn_migrator / gn_runtime créés (distincts)", true);
    });

    // ------------------------------------------------------------------ 2. schéma de main uniquement
    let pending;
    await step("baseline-main", () => {
      const mainDir = join(tmp, "main");
      mkdirSync(mainDir);
      const tarFile = join(tmp, "main.tar");
      const archive = run("git", ["archive", "--format=tar", "-o", tarFile, "origin/main", "prisma/schema.prisma", "prisma/migrations"]);
      assert.equal(archive.status, 0, archive.out);
      const untar = run("tar", ["-xf", "../main.tar"], { cwd: mainDir });
      assert.equal(untar.status, 0, untar.out);
      const mainMigrations = migrationNames(join(mainDir, "prisma", "migrations"));
      const allMigrations = migrationNames(join(REPO, "prisma", "migrations"));
      pending = allMigrations.filter((name) => !mainMigrations.includes(name));
      check(`migrations de origin/main : ${mainMigrations.length}, absentes de main : ${pending.length}`, pending.length > 0);
      check("migrations XP attendues absentes de main", EXPECTED_XP_MIGRATIONS.every((name) => pending.includes(name)));
      check("main n'a aucune migration absente du worktree", mainMigrations.every((name) => allMigrations.includes(name)));
      createOwnedDatabase(c, NAMES.main);
      created.a.push(NAMES.main);
      const deploy = run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", join(mainDir, "prisma", "schema.prisma")], {
        env: { DATABASE_URL: url("gn_migrator", PW.migrator, cfg.portA, NAMES.main) },
      });
      assert.equal(deploy.status, 0, deploy.out);
      const rows = applied(c, NAMES.main);
      check("historique = exactement les migrations de main, toutes terminées", JSON.stringify(rows.map(([n]) => n)) === JSON.stringify(mainMigrations) && rows.every(([, ok]) => ok === "true"));
      check("schéma de main : pas de colonne xpBalance", !hasColumn(c, NAMES.main));
      summary.mainMigrations = mainMigrations.length;
      summary.pending = pending;
    });

    // ------------------------------------------------------------------ 3. données déterministes
    let fpBefore;
    await step("seed", () => {
      c.sql(NAMES.main, SEED_SQL);
      fpBefore = c.fingerprint(NAMES.main);
      say(`  comptages : ${JSON.stringify(fpBefore.counts)}`);
      say(`  soldes : ${fpBefore.balanceRows} lignes, somme ${fpBefore.balanceSum}, empreinte ${fpBefore.digest.slice(0, 16)}…`);
      check("jeu de données non vide (utilisateurs, communautés, stats, achats, ledger, paris)", Object.values(fpBefore.counts).every((n) => n > 0));
      const again = c.fingerprint(NAMES.main);
      check("empreinte stable (relecture identique)", compareFingerprints(fpBefore, again).identical);
      summary.fingerprintBefore = fpBefore;
    });

    // ------------------------------------------------------------------ 4. sauvegarde
    const backupFile = join(tmp, "pre-migration.dump");
    await step("backup", () => {
      const sha = c.backup(NAMES.main, backupFile);
      check("dump -Fc écrit hors dépôt", existsSync(backupFile));
      const fpAfterDump = c.fingerprint(NAMES.main);
      check("empreinte inchangée par la sauvegarde", compareFingerprints(fpBefore, fpAfterDump).identical);
      summary.backupSha256 = sha;
      say(`  sha256 du dump : ${sha}`);
    });

    // ------------------------------------------------------------------ 5. barrière d'écriture
    await step("barrier-close", async () => {
      // Écrivain « ancien runtime » : session gn_runtime longue, doit être drainée par la barrière.
      const writer = spawn("docker", localDockerArgs(assertLocalDockerContext(), ["exec", "-e", `PGPASSWORD=${PW.runtime}`, cfg.containerA, "psql", "-h", "127.0.0.1", "-U", "gn_runtime", "-d", NAMES.main, "-c", "SELECT pg_sleep(300)"]), { stdio: "ignore", windowsHide: true });
      const exited = new Promise((r) => writer.on("exit", r));
      let active = 0;
      for (let i = 0; i < 40 && active === 0; i++) {
        active = Number(c.sql("postgres", `SELECT count(*) FROM pg_stat_activity WHERE usename='gn_runtime' AND datname='${NAMES.main}' AND state='active';`));
        if (active === 0) await new Promise((r) => setTimeout(r, 250));
      }
      check("écrivain du rôle runtime visible avant la barrière", active >= 1);
      c.sql("postgres", `ALTER ROLE gn_runtime NOLOGIN;`);
      const killed = c.sql("postgres", `SELECT count(*) FILTER (WHERE pg_terminate_backend(pid)) FROM pg_stat_activity WHERE usename='gn_runtime' AND datname='${NAMES.main}';`);
      check(`session écrivain terminée (${killed})`, Number(killed) >= 1);
      await Promise.race([exited, new Promise((r) => setTimeout(r, 10000))]);
      const left = c.sql("postgres", `SELECT count(*) FROM pg_stat_activity WHERE usename='gn_runtime' AND datname='${NAMES.main}';`);
      check("aucune session runtime restante", left === "0");
      const login = c.docker(["exec", "-e", `PGPASSWORD=${PW.runtime}`, cfg.containerA, "psql", "-h", "127.0.0.1", "-U", "gn_runtime", "-d", NAMES.main, "-Atc", "SELECT 1"]);
      check("reconnexion du rôle runtime refusée", login.status !== 0 && /not permitted to log in/i.test(login.stderr), redact(login.stderr));
      check("empreinte inchangée sous barrière", compareFingerprints(fpBefore, c.fingerprint(NAMES.main)).identical);
      if (!writer.killed && writer.exitCode === null) writer.kill();
    });

    // ------------------------------------------------------------------ 6. migrations XP + vocales via db-migrate
    await step("migrate", () => {
      const dry = dbMigrate(REPO, { port: cfg.portA, database: NAMES.main, expect: pending });
      say(dry.out.split("\n").map((l) => `  | ${l}`).join("\n"));
      check("dry-run db-migrate (code 0, aucune écriture)", dry.status === 0 && /DRY-RUN/.test(dry.out) && !hasColumn(c, NAMES.main), dry.out);
      check("dry-run : rôle de migration ≠ rôle runtime (aucun avertissement de contrôle manquant)", !/NON effectué/.test(dry.out));
      const exec = dbMigrate(REPO, { port: cfg.portA, database: NAMES.main, expect: pending, execute: true, confirm: NAMES.main });
      say(exec.out.split("\n").map((l) => `  | ${l}`).join("\n"));
      check("db-migrate --execute (code 0)", exec.status === 0 && /OK : \d+ migration/.test(exec.out), exec.out);
      summary.outputs.migrate = exec.out.split("\n").slice(-3);
    });

    // ------------------------------------------------------------------ 7. vérifications
    await step("verify", () => {
      const rows = applied(c, NAMES.main);
      const all = migrationNames(join(REPO, "prisma", "migrations"));
      check("historique = checkout complet, toutes terminées, aucune inachevée", JSON.stringify(rows.map(([n]) => n)) === JSON.stringify(all) && rows.every(([, ok]) => ok === "true"));
      check("colonne xpBalance", hasColumn(c, NAMES.main));
      check("contrainte xpBalance >= 0", c.sql(NAMES.main, `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='CommunityMemberStats_xpBalance_nonnegative');`) === "t");
      check("valeur d'enum SHOP_BALANCE_PURCHASE", c.sql(NAMES.main, `SELECT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='XpReason' AND e.enumlabel='SHOP_BALANCE_PURCHASE');`) === "t");
      const tables = pending.flatMap((name) => [...readFileSync(join(REPO, "prisma", "migrations", name, "migration.sql"), "utf8").matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]));
      check(`tables vocales créées : ${tables.join(", ")}`, tables.length >= 3 && tables.every((t) => c.sql(NAMES.main, `SELECT to_regclass('public."${t}"') IS NOT NULL;`) === "t"));
      const fpAfter = c.fingerprint(NAMES.main);
      const cmp = compareFingerprints(fpBefore, fpAfter);
      check("données préservées (comptages, condensats, soldes xpTotal identiques)", cmp.identical, JSON.stringify(cmp.differences));
      check("xpBalance = xpTotal sur toutes les lignes (règle documentée : solde initial = progression)", c.sql(NAMES.main, `SELECT count(*) FROM "CommunityMemberStats" WHERE "xpBalance" <> "xpTotal";`) === "0");
      check("aucun solde négatif", c.sql(NAMES.main, `SELECT count(*) FROM "CommunityMemberStats" WHERE "xpBalance" < 0;`) === "0");
      check("somme des xpBalance = somme des xpTotal de l'empreinte", c.sql(NAMES.main, `SELECT sum("xpBalance")::text FROM "CommunityMemberStats";`) === fpBefore.balanceSum);
      summary.fingerprintAfter = fpAfter;
    });

    // ------------------------------------------------------------------ 8. script de bascule
    let snapshot;
    const takeSnapshot = () => JSON.stringify({
      fp: c.fingerprint(NAMES.main).digest,
      balance: c.sql(NAMES.main, `SELECT sum("xpBalance")::text || '/' || md5(string_agg("userId" || "xpBalance", ',' ORDER BY "communityId","userId")) FROM "CommunityMemberStats";`),
      history: c.sql(NAMES.main, `SELECT md5(string_agg(migration_name || finished_at::text, ',' ORDER BY migration_name)) FROM _prisma_migrations;`),
    });
    await step("bascule", () => {
      snapshot = takeSnapshot();
      const dryRun = bascule(REPO, { container: cfg.containerA, port: cfg.portA, database: NAMES.main });
      say(`  ${JSON.stringify(dryRun.report)}`);
      check("script de bascule exécuté sur la base migrée : état MIGRATED, aucune écriture", dryRun.status === 0 && dryRun.report.state === "MIGRATED" && /^DÉJÀ BASCULÉ \(aucune écriture\)/.test(dryRun.report.result) && dryRun.report.divergentBalances === 0);
      const forced = bascule(REPO, { container: cfg.containerA, port: cfg.portA, database: NAMES.main, args: ["--execute", `--confirm-database=${NAMES.main}`] });
      check("--execute --confirm sur base déjà basculée : aucune écriture", forced.status === 0 && /^DÉJÀ BASCULÉ/.test(forced.report.result));
      check("état identique avant/après les exécutions du script", takeSnapshot() === snapshot);
    });

    // ------------------------------------------------------------------ 9. idempotence
    await step("idempotence", () => {
      const again = dbMigrate(REPO, { port: cfg.portA, database: NAMES.main, expect: pending, execute: true, confirm: NAMES.main });
      say(again.out.split("\n").map((l) => `  | ${l}`).join("\n"));
      check("relance db-migrate : refus propre (code 2, rien en attente)", again.status === 2 && /Manquantes/.test(again.out), again.out);
      const prismaAgain = run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { DATABASE_URL: url("gn_migrator", PW.migrator, cfg.portA, NAMES.main) } });
      check("prisma migrate deploy relancé : « No pending migrations »", prismaAgain.status === 0 && /No pending migrations/.test(prismaAgain.out), prismaAgain.out.slice(-200));
      check("état identique (empreinte, soldes, historique)", takeSnapshot() === snapshot);
    });

    // ------------------------------------------------------------------ 10. réouverture
    await step("barrier-open", () => {
      c.sql("postgres", `ALTER ROLE gn_runtime LOGIN;`);
      const r = c.docker(["exec", "-e", `PGPASSWORD=${PW.runtime}`, cfg.containerA, "psql", "-h", "127.0.0.1", "-U", "gn_runtime", "-d", NAMES.main, "-Atc", `SELECT count(*) FROM "CommunityMemberStats" WHERE "xpBalance" = "xpTotal"`]);
      check("le rôle runtime se reconnecte et lit xpBalance (droits DML hérités)", r.status === 0 && Number(r.stdout) === fpBefore.balanceRows, redact(r.stderr));
    });

    // ------------------------------------------------------------------ 11. échec : migration interrompue
    await step("fail-migration", () => {
      createOwnedDatabase(c, NAMES.fail);
      created.a.push(NAMES.fail);
      c.restore(NAMES.fail, backupFile, { role: "gn_migrator" });
      check("clone restauré depuis la sauvegarde (empreinte identique)", compareFingerprints(fpBefore, c.fingerprint(NAMES.fail)).identical);
      const broken = "20261022130000_voice_presence_retention_gap_bounds";
      check("migration sabotée présente dans le lot", pending.includes(broken));
      const dir = makeWorkdir(tmp, "wd-fail", { scripts: MIGRATE_SCRIPTS, breakMigration: broken });
      workdirs.push(dir);
      const wrong = dbMigrate(dir, { port: cfg.portA, database: NAMES.fail, expect: pending, execute: true, confirm: "gamenight_xp_autre" });
      check("--confirm-database différent : refus (code 2), rien d'écrit", wrong.status === 2 && !hasColumn(c, NAMES.fail), wrong.out);
      const fail = dbMigrate(dir, { port: cfg.portA, database: NAMES.fail, expect: pending, execute: true, confirm: NAMES.fail });
      say(fail.out.split("\n").slice(-6).map((l) => `  | ${l}`).join("\n"));
      check("migration qui échoue en cours de route : db-migrate code 3", fail.status === 3 && /ÉCHEC de prisma migrate deploy/.test(fail.out), fail.out);
      const rows = applied(c, NAMES.fail);
      const done = rows.filter(([, ok]) => ok === "true").length;
      const unfinished = rows.filter(([, ok]) => ok !== "true").map(([n]) => n);
      check(`état intermédiaire constaté : ${done - (migrationNames(join(REPO, "prisma", "migrations")).length - pending.length)} migration(s) du lot appliquée(s) avant l échec, inachevée = ${unfinished.join(",")}`, JSON.stringify(unfinished) === JSON.stringify([broken]));
      check("données de base inchangées malgré l'échec", compareFingerprints(fpBefore, c.fingerprint(NAMES.fail)).identical);
      const retry = dbMigrate(dir, { port: cfg.portA, database: NAMES.fail, expect: pending, execute: true, confirm: NAMES.fail });
      check("relance refusée tant que la migration inachevée n'est pas revue (code 2)", retry.status === 2 && /inachevée/.test(retry.out), retry.out);
      summary.outputs.failMigration = fail.out.split("\n").slice(-2);
    });

    // ------------------------------------------------------------------ 12. échec : mauvaises cibles
    await step("fail-wrong-target", () => {
      const ex = "db.example.invalid";
      const base = { port: "5432", database: "gamenight_xp_cible", expect: ["x"], runtimeUser: "gn_runtime" };
      const refuse = (label, pattern, opts) => {
        const r = dbMigrate(REPO, { ...base, ...opts });
        check(`cible refusée : ${label} (code 2)`, r.status === 2 && pattern.test(r.out), r.out);
      };
      const remote = (extra = {}) => ({ extraEnv: { GAMENIGHT_RUNTIME_ROLE: "gn_runtime", ...extra } });
      // hôtes fictifs : refus AVANT toute connexion
      const remoteUrl = (host, database = "gamenight_xp_cible") => ({ extraEnv: { MIGRATION_DATABASE_URL: url("gn_migrator", PW.migrator, "5432", database).replace(HOST, host), DATABASE_URL: "" } });
      refuse("hôte distant sans GAMENIGHT_EXPECTED_TARGET", /GAMENIGHT_EXPECTED_TARGET/, { ...remoteUrl(ex), allowLocal: false, extraEnv: { ...remoteUrl(ex).extraEnv, GAMENIGHT_RUNTIME_ROLE: "gn_runtime" } });
      refuse("hôte distant ≠ cible attendue", /Cible inattendue/, { allowLocal: false, extraEnv: { ...remoteUrl(ex).extraEnv, GAMENIGHT_RUNTIME_ROLE: "gn_runtime", GAMENIGHT_EXPECTED_TARGET: "autre.example.invalid/gamenight_xp_cible" } });
      refuse("hôte poolé", /poolé/, { allowLocal: false, extraEnv: { ...remoteUrl("db-pooler.example.invalid").extraEnv, GAMENIGHT_RUNTIME_ROLE: "gn_runtime", GAMENIGHT_EXPECTED_TARGET: "db-pooler.example.invalid/gamenight_xp_cible" } });
      refuse("cible locale sans --allow-local", /sans --allow-local/, { allowLocal: false, ...remote() });
      refuse("base locale hors gamenight_*", /Base locale refusée/, { database: "postgres", ...remote() });
      refuse("rôle de migration = rôle runtime", /autre rôle/, { user: "gn_runtime", password: PW.runtime });
      const self = run(process.execPath, ["scripts/rehearse-xp-full.mjs"], { env: { XP_FULL_HOST: ex } });
      check("rehearse-xp-full lui-même refuse un hôte non local (code 2)", self.status === 2 && /Hôte refusé/.test(self.out), self.out);
      const neon = bascule(REPO, { container: cfg.containerA, port: cfg.portA, database: "neondb" });
      check("xp-balance-bascule refuse une base hors gamenight_xp_* (code 2)", neon.status === 2 && /Base refusée/.test(neon.report.raw ?? ""), JSON.stringify(neon));
    });

    // ------------------------------------------------------------------ 13. échec : bascule interrompue puis reprise
    await step("fail-bascule-resume", () => {
      const xpOnly = pending.filter((name) => !EXPECTED_XP_MIGRATIONS.includes(name));
      const shop = EXPECTED_XP_MIGRATIONS[1];
      const prep = (name) => { cb.sql("postgres", `CREATE DATABASE "${name}";`); created.b.push(name); cb.restore(name, backupFile); };
      prep(NAMES.resumeA);
      check("copie A restaurée sur B (état avant migration)", compareFingerprints(fpBefore, cb.fingerprint(NAMES.resumeA)).identical && !hasColumn(cb, NAMES.resumeA));
      const broken = makeWorkdir(tmp, "wd-bascule-broken", { scripts: BASCULE_SCRIPTS, dropMigrations: xpOnly, breakMigration: shop });
      workdirs.push(broken);
      const target = { container: cfg.containerB, port: cfg.portB };
      const first = bascule(broken, { ...target, database: NAMES.resumeA, args: ["--execute", `--confirm-database=${NAMES.resumeA}`] });
      say(`  bascule interrompue : ${first.report.result} — ${first.report.reason}`);
      check("bascule interrompue par une 2e migration en échec : REFUSÉ (code 1)", first.status === 1 && /^REFUSÉ/.test(first.report.result) && /migrate deploy a échoué/.test(first.report.reason));
      check("sauvegarde interne de la bascule restaurée identique avant la migration", first.report.fingerprintRestored === first.report.fingerprintBefore);
      const rows = applied(cb, NAMES.resumeA);
      check("état intermédiaire : 1re migration XP terminée, 2e inachevée", rows.some(([n, ok]) => n === EXPECTED_XP_MIGRATIONS[0] && ok === "true") && rows.some(([n, ok]) => n === shop && ok !== "true"));
      const stuck = bascule(broken, { ...target, database: NAMES.resumeA, args: ["--execute", `--confirm-database=${NAMES.resumeA}`] });
      check("reprise directe refusée tant que l'état est inachevé (aucune écriture)", stuck.status === 1 && /inachevée/.test(stuck.report.reason), JSON.stringify(stuck.report));
      // Reprise documentée : restaurer la sauvegarde dans une AUTRE cible, relancer avec la migration corrigée.
      prep(NAMES.resumeB);
      const fixed = makeWorkdir(tmp, "wd-bascule-fixed", { scripts: BASCULE_SCRIPTS, dropMigrations: xpOnly });
      workdirs.push(fixed);
      const resumed = bascule(fixed, { ...target, database: NAMES.resumeB, args: ["--execute", `--confirm-database=${NAMES.resumeB}`] });
      say(`  reprise : ${resumed.report.result}`);
      check("reprise sur copie restaurée : BASCULE OK", resumed.status === 0 && resumed.report.result === "BASCULE OK" && resumed.report.mismatchedBalances === 0, JSON.stringify(resumed.report));
      check("empreinte avant/restauré/après identiques dans le rapport de bascule", resumed.report.fingerprintBefore === resumed.report.fingerprintRestored && resumed.report.fingerprintAfter === resumed.report.fingerprintBefore);
      check("données de la copie reprise = données d'origine", compareFingerprints(fpBefore, cb.fingerprint(NAMES.resumeB)).identical);
      const again = bascule(fixed, { ...target, database: NAMES.resumeB });
      check("relance du script après reprise : DÉJÀ BASCULÉ", /^DÉJÀ BASCULÉ/.test(again.report.result));
      summary.outputs.bascule = { interrupted: first.report.reason, resumed: resumed.report.result };
    });

    // ------------------------------------------------------------------ 14. repli : restauration sur le 2e conteneur
    await step("fallback-restore", () => {
      cb.sql("postgres", `CREATE DATABASE "${NAMES.restore}";`);
      created.b.push(NAMES.restore);
      cb.restore(NAMES.restore, backupFile);
      const fpRestored = cb.fingerprint(NAMES.restore);
      const cmp = compareFingerprints(fpBefore, fpRestored);
      check(`repli : base restaurée sur B, empreinte identique à celle d'avant (${fpRestored.digest.slice(0, 16)}…)`, cmp.identical, JSON.stringify(cmp.differences));
      const mainSet = applied(cb, NAMES.restore).map(([n]) => n);
      check("repli : historique = migrations de main uniquement, sans xpBalance", mainSet.length === migrationNames(join(REPO, "prisma", "migrations")).length - pending.length && !hasColumn(cb, NAMES.restore));
      check("la base migrée (A) diffère bien de la sauvegarde sur le schéma (xpBalance présent)", hasColumn(c, NAMES.main));
      cb.sql(NAMES.restore, `UPDATE "CommunityMemberStats" SET "xpTotal" = "xpTotal" + 1 WHERE "communityId"='comm-alpha' AND "userId"='u2';`);
      const tampered = compareFingerprints(fpBefore, cb.fingerprint(NAMES.restore));
      check("l'empreinte détecte une altération d'un seul solde (contre-épreuve)", !tampered.identical && tampered.differences.includes("balanceDigest"));
      summary.outputs.restoreDigest = fpRestored.digest;
    });

    summary.result = "OK";
    assertStepOrder(executed);
    say(`\nRÉPÉTITION COMPLÈTE : OK (${executed.length} étapes)`);
  } finally {
    // Nettoyage : bases jetables (les conteneurs sont supprimés par l'opérateur), sauvegardes hors dépôt.
    for (const [x, names] of [[c, created.a], [cb, created.b]]) {
      if (!x) continue;
      for (const name of names) {
        try { x.sql("postgres", `DROP DATABASE IF EXISTS "${name}" WITH (FORCE);`); } catch (error) { console.error(`nettoyage ${name} : ${error.message}`); }
      }
    }
    for (const dir of workdirs) dropJunction(dir);
    rmSync(tmp, { recursive: true, force: true });
    say(`dossier temporaire supprimé : ${!existsSync(tmp)}`);
  }
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assertRehearsalTarget({ host: cfg.host, port: cfg.portA, container: cfg.containerA, database: NAMES.main });
  } catch (error) {
    console.error(`REFUSÉ : ${error.message}`);
    process.exit(2);
  }
  main().then(
    (summary) => { console.log(redact(JSON.stringify({ result: summary.result, steps: summary.steps, originMain: summary.originMain, pending: summary.pending, fingerprintBefore: summary.fingerprintBefore?.digest, fingerprintAfter: summary.fingerprintAfter?.digest, restoreDigest: summary.outputs.restoreDigest }, null, 2))); },
    (error) => { console.error(redact(`ÉCHEC DE LA RÉPÉTITION : ${error.stack ?? error.message}`)); process.exit(1); },
  );
}
