// Briques LOCALES de la répétition complète XP (scripts/rehearse-xp-full.mjs) : garde-fous de cible,
// empreinte de données, ordonnancement des étapes, sauvegarde/restauration pg_dump via docker exec.
// Jamais Neon, jamais Production : 127.0.0.1 uniquement, bases `gamenight_xp_*` jetables.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { assertLocalDockerContext, localDockerArgs } from "./recette-local-docker.mjs";

export const HOST = "127.0.0.1";
export const DATABASE_PATTERN = /^gamenight_xp_[a-z0-9_]+$/;

/** Refuse toute cible hors machine locale, tout nom évoquant Neon, toute base hors `gamenight_xp_*`. */
export function assertRehearsalTarget({ host, port, container, database }) {
  if (host !== HOST) throw new Error(`Hôte refusé : ${host} (seul ${HOST} est autorisé)`);
  if (!/^[1-9]\d{3,4}$/.test(String(port))) throw new Error(`Port invalide : ${port}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(container)) throw new Error(`Conteneur invalide : ${container}`);
  if (/neon/i.test(`${container}${database}${host}`)) throw new Error("Cible Neon interdite");
  if (!DATABASE_PATTERN.test(database)) throw new Error(`Base refusée : ${database} (attendu ${DATABASE_PATTERN})`);
  return { host, port: String(port), container, database };
}

/** Le dossier des sauvegardes ne doit JAMAIS se trouver dans le dépôt (aucune donnée dans Git). */
export function assertOutsideRepo(dir, repoRoot) {
  const rel = relative(resolve(repoRoot), resolve(dir));
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    throw new Error(`Dossier de sauvegarde dans le dépôt refusé : ${dir}`);
  }
  return resolve(dir);
}

// Ordre canonique de la répétition + prérequis (chaque étape exige que les listées soient déjà passées).
export const STEPS = [
  "preflight", "baseline-main", "seed", "backup", "barrier-close", "migrate", "verify", "bascule",
  "idempotence", "barrier-open", "fail-migration", "fail-wrong-target", "fail-bascule-resume", "fallback-restore",
];
export const REQUIRES = {
  seed: ["baseline-main"],
  backup: ["seed"],
  "barrier-close": ["backup"],
  migrate: ["backup", "barrier-close"],
  verify: ["migrate"],
  bascule: ["verify"],
  idempotence: ["bascule"],
  "barrier-open": ["verify"],
  "fail-migration": ["backup"],
  "fail-bascule-resume": ["backup"],
  "fallback-restore": ["backup", "migrate"],
};

/** Vérifie l'ordre réel d'exécution : connues, sans doublon, dans l'ordre canonique, prérequis satisfaits. */
export function assertStepOrder(executed, steps = STEPS, requires = REQUIRES) {
  let last = -1;
  const seen = new Set();
  for (const name of executed) {
    const index = steps.indexOf(name);
    if (index < 0) throw new Error(`Étape inconnue : ${name}`);
    if (seen.has(name)) throw new Error(`Étape répétée : ${name}`);
    if (index < last) throw new Error(`Étape hors ordre : ${name}`);
    for (const need of requires[name] ?? []) if (!seen.has(need)) throw new Error(`Étape ${name} sans prérequis ${need}`);
    seen.add(name);
    last = index;
  }
  return true;
}

// Empreinte : uniquement des colonnes de la base `main` (stables avant/après migration), jamais d'horodatage.
export const FINGERPRINT_TABLES = ["User", "Community", "Membership", "CommunityMemberStats", "CommunityMemberCosmetic", "XpEvent", "XpBet"];
export const FINGERPRINT_SQL = {
  counts: FINGERPRINT_TABLES.map((t) => `SELECT '${t}', count(*) FROM "${t}"`).join(" UNION ALL ") + " ORDER BY 1;",
  digests: [
    `SELECT 'User', md5(coalesce(string_agg(concat_ws('|',"id","discordId","discordName"), E'\\n' ORDER BY "id"), '')) FROM "User"`,
    `SELECT 'Membership', md5(coalesce(string_agg(concat_ws('|',"communityId","userId","role","status"), E'\\n' ORDER BY "communityId","userId"), '')) FROM "Membership"`,
    `SELECT 'CommunityMemberCosmetic', md5(coalesce(string_agg(concat_ws('|',"communityId","userId","itemId"), E'\\n' ORDER BY "communityId","userId","itemId"), '')) FROM "CommunityMemberCosmetic"`,
    `SELECT 'XpEvent', md5(coalesce(string_agg(concat_ws('|',"communityId","id","userId","reason","sourceId","amount"), E'\\n' ORDER BY "communityId","id"), '')) FROM "XpEvent"`,
    `SELECT 'XpBet', md5(coalesce(string_agg(concat_ws('|',"id","communityId","voterId","targetUserId","amount","won","allIn"), E'\\n' ORDER BY "id"), '')) FROM "XpBet"`,
  ].join(" UNION ALL ") + " ORDER BY 1;",
  balances: `SELECT "communityId", "userId", "xpTotal" FROM "CommunityMemberStats" ORDER BY 1, 2;`,
};

const parseLines = (text) => text.split("\n").filter(Boolean).map((line) => line.split("|"));

/** Calcul PUR de l'empreinte à partir des sorties `psql -At` (comptages, condensats, soldes). */
export function computeFingerprint({ counts, digests, balances }) {
  const countMap = Object.fromEntries(parseLines(counts).map(([name, n]) => [name, Number(n)]));
  const digestMap = Object.fromEntries(parseLines(digests));
  const rows = parseLines(balances);
  let balanceSum = 0n;
  for (const [, , value] of rows) balanceSum += BigInt(value);
  const balanceDigest = createHash("sha256").update(rows.map((row) => row.join("|")).join("\n")).digest("hex");
  const body = { counts: countMap, digests: digestMap, balanceRows: rows.length, balanceSum: balanceSum.toString(), balanceDigest };
  return { ...body, digest: createHash("sha256").update(JSON.stringify(body)).digest("hex") };
}

export function compareFingerprints(a, b) {
  const differences = [];
  for (const key of ["counts", "digests", "balanceRows", "balanceSum", "balanceDigest"]) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) differences.push(key);
  }
  return { identical: differences.length === 0 && a.digest === b.digest, differences };
}

/** Accès docker local (contexte vérifié) à un conteneur lié à 127.0.0.1:<port>. */
export function createContainer({ container, port }) {
  const dockerHost = assertLocalDockerContext();
  const docker = (args, options = {}) => {
    const result = spawnSync("docker", localDockerArgs(dockerHost, args), { encoding: "utf8", windowsHide: true, maxBuffer: 256 * 1024 * 1024, ...options });
    if (result.error) throw result.error;
    return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  };
  const must = (args, options) => {
    const result = docker(args, options);
    assert.equal(result.status, 0, `docker ${args.slice(0, 3).join(" ")} : ${result.stderr || result.stdout}`);
    return result.stdout;
  };
  assert.equal(must(["port", container, "5432/tcp"]), `${HOST}:${port}`, "Le conteneur doit être lié à 127.0.0.1:<port> uniquement");
  const sql = (database, input, user = "postgres") => {
    assert.ok(database === "postgres" || DATABASE_PATTERN.test(database), `Base refusée : ${database}`);
    return must(["exec", "-i", container, "psql", "-X", "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-At"], { input });
  };
  const fingerprint = (database) =>
    computeFingerprint({ counts: sql(database, FINGERPRINT_SQL.counts), digests: sql(database, FINGERPRINT_SQL.digests), balances: sql(database, FINGERPRINT_SQL.balances) });
  const backup = (database, hostFile) => {
    assert.match(database, DATABASE_PATTERN);
    const inside = `/tmp/${database}.dump`;
    must(["exec", container, "pg_dump", "-U", "postgres", "-Fc", "--file", inside, database]);
    must(["cp", `${container}:${inside}`, hostFile]);
    must(["exec", container, "rm", "-f", inside]);
    return createHash("sha256").update(readFileSync(hostFile)).digest("hex");
  };
  const restore = (database, hostFile, { role } = {}) => {
    assert.match(database, DATABASE_PATTERN);
    const inside = `/tmp/restore-${database}.dump`;
    must(["cp", hostFile, `${container}:${inside}`]);
    const owner = role ? ["--role", role] : [];
    must(["exec", container, "pg_restore", "-U", "postgres", "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl", ...owner, "-d", database, inside]);
    must(["exec", container, "rm", "-f", inside]);
  };
  return { docker, must, sql, fingerprint, backup, restore, container, port, dockerHost };
}
