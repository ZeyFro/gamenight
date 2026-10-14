// SessionStart : prépare les tests d'intégration dans une session Claude Code
// cloud UNIQUEMENT (CLAUDE_CODE_REMOTE=true). Sur un poste local : ne fait rien.
// Idempotent : chaque étape vérifie l'état avant d'agir.
//   1. dépendances npm si node_modules absent, puis `prisma generate`
//   2. Postgres 16 local (127.0.0.1:55439), base `gamenight_test`
//   3. `prisma migrate deploy` sur CETTE base uniquement
//   4. TEST_DATABASE_URL exportée pour la session (CLAUDE_ENV_FILE)
// Jamais de vraie base : l'URL est construite ici et doit viser 127.0.0.1,
// DATABASE_URL est écrasée pour la migration. Aucune dépendance.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

if (process.env.CLAUDE_CODE_REMOTE !== "true") process.exit(0);

const PROJECT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const PG_BIN = "/usr/lib/postgresql/16/bin";
const HOST = "127.0.0.1";
const PORT = "55439";
const DB = "gamenight_test";
// Hors du dépôt et des dossiers temporaires de session (droits réinitialisés).
const DATA_DIR = "/var/lib/postgresql/gamenight-test-data";
const LOG_FILE = "/var/lib/postgresql/gamenight-test.log";
const TEST_DATABASE_URL = `postgresql://postgres:test@${HOST}:${PORT}/${DB}`;

const fail = (msg) => {
  console.error(`[session-start] ${msg}`);
  process.exit(1);
};

if (new URL(TEST_DATABASE_URL).hostname !== HOST) fail("URL de test hors 127.0.0.1 : abandon.");
if (!existsSync(`${PG_BIN}/pg_ctl`)) fail(`Postgres 16 introuvable (${PG_BIN}) : tests d'intégration indisponibles.`);

const isRoot = process.getuid?.() === 0;

function run(cmd, args, { asPostgres = false, env } = {}) {
  const [c, a] = asPostgres && isRoot ? ["runuser", ["-u", "postgres", "--", cmd, ...args]] : [cmd, args];
  const r = spawnSync(c, a, { cwd: PROJECT, encoding: "utf8", env: env ?? process.env });
  if (r.error) fail(`${cmd} : ${r.error.message}`);
  return r;
}

function must(cmd, args, opts) {
  const r = run(cmd, args, opts);
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} a échoué (${r.status}) :\n${r.stderr || r.stdout}`);
  return r.stdout;
}

// 1. Dépendances
if (!existsSync(join(PROJECT, "node_modules", ".bin", "prisma"))) {
  must("npm", ["install", "--no-audit", "--no-fund"]);
}
must("npx", ["prisma", "generate"]);

// 2. Postgres local
if (!existsSync(join(DATA_DIR, "PG_VERSION"))) {
  mkdirSync(DATA_DIR, { recursive: true });
  if (isRoot) must("chown", ["postgres:postgres", DATA_DIR]);
  must(`${PG_BIN}/initdb`, ["-D", DATA_DIR, "-A", "trust", "-U", "postgres"], { asPostgres: true });
}
if (run(`${PG_BIN}/pg_isready`, ["-h", HOST, "-p", PORT]).status !== 0) {
  must(
    `${PG_BIN}/pg_ctl`,
    ["-D", DATA_DIR, "-l", LOG_FILE, "-w", "-o", `-p ${PORT} -c listen_addresses=${HOST} -k ${DATA_DIR}`, "start"],
    { asPostgres: true }
  );
}
const psql = (sql) => must("psql", ["-h", HOST, "-p", PORT, "-U", "postgres", "-tAc", sql]).trim();
if (psql(`SELECT 1 FROM pg_database WHERE datname = '${DB}'`) !== "1") psql(`CREATE DATABASE ${DB}`);

// 3. Migrations sur la base locale uniquement
must("npx", ["prisma", "migrate", "deploy"], {
  env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
});

// 4. Variable pour la session
const envFile = process.env.CLAUDE_ENV_FILE;
const line = `export TEST_DATABASE_URL=${TEST_DATABASE_URL}`;
if (envFile && !(existsSync(envFile) && readFileSync(envFile, "utf8").includes(line))) {
  appendFileSync(envFile, `${line}\n`);
}

console.log(`Postgres de test prêt (${HOST}:${PORT}/${DB}), migrations appliquées, TEST_DATABASE_URL exportée.`);
