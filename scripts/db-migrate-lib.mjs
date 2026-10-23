// Contrôles purs de scripts/db-migrate.mjs : aucune connexion, aucun affichage de secret.
// Codes de sortie du CLI : 0 ok ou dry-run, 1 erreur inattendue, 2 précontrôle refusé,
// 3 migration en échec, 4 contrôle après migration en échec (ou impossible).
// Le code 2 couvre aussi « rien à faire » (aucune migration en attente) : aucune écriture n'a eu lieu.

export const EXIT = { OK: 0, UNEXPECTED: 1, REFUSED: 2, MIGRATION_FAILED: 3, POSTCHECK_FAILED: 4 };

export class RefusalError extends Error {
  constructor(message) {
    super(message);
    this.name = "RefusalError";
    this.exitCode = EXIT.REFUSED;
  }
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
// Seuls ces paramètres d'URL sont admis : `host`, `schema`, `options`, `service`… pourraient
// rediriger ou altérer la connexion sans que l'hôte vérifié change.
const ALLOWED_QUERY = new Set(["sslmode", "connect_timeout", "connection_limit", "pool_timeout", "application_name", "channel_binding"]);

/** Arguments `--nom=valeur` et drapeaux; toute forme `--nom valeur` inconnue est refusée. */
export function readArgs(argv) {
  const known = new Set(["expect", "execute", "confirm-database", "allow-local"]);
  const args = { expect: [], execute: false, confirm: undefined, allowLocal: false };
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match || !known.has(match[1])) throw new RefusalError(`Argument inconnu : ${arg.split("=")[0]}`);
    const [, name, value] = match;
    if (["execute", "allow-local"].includes(name) && value !== undefined) {
      throw new RefusalError(`--${name} est un drapeau sans valeur (reçu : ${arg}) : écrire ${"--" + name} seul, ou l'omettre`);
    }
    if (name === "execute") args.execute = true;
    else if (name === "allow-local") args.allowLocal = true;
    else if (name === "confirm-database") args.confirm = value;
    else args.expect = (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  }
  return args;
}

/** Décompose une URL PostgreSQL sans jamais exposer le mot de passe. */
export function parseTarget(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new RefusalError("URL de connexion illisible (valeur non affichée)");
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new RefusalError("L'URL de connexion doit être postgresql://");
  }
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_QUERY.has(key.toLowerCase())) throw new RefusalError(`Paramètre d'URL non autorisé : ${key}`);
  }
  const host = url.hostname.toLowerCase();
  let database;
  try {
    database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    throw new RefusalError("Nom de base illisible");
  }
  if (!host || !database) throw new RefusalError("URL de connexion sans hôte ou sans base");
  return {
    host,
    port: url.port || "5432",
    database,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    local: LOCAL_HOSTS.has(host),
    pooled: host.includes("-pooler"),
  };
}

/**
 * Refuse toute cible inattendue; renvoie la cible et d'éventuels avertissements.
 * - la connexion de migration est distincte de la connexion runtime (autre rôle) : comparée à
 *   `runtimeUrl` ou à `runtimeRole`; si aucun des deux n'est fourni, un avertissement le dit;
 * - hors machine locale : `<hôte>[:port]/<base>` exact attendu et hôte non poolé
 *   (pgbouncer en mode transaction casse les verrous consultatifs de Prisma);
 * - hors machine locale avec `execute` : le contrôle « rôle de migration ≠ rôle runtime » est obligatoire
 *   (refus s'il n'a pas pu être fait);
 * - en local : `--allow-local` et base `gamenight_*` uniquement.
 * `skipRuntimeCheck` : pour les outils en lecture seule (scripts/prod-precheck.mjs) qui n'ont pas de rôle runtime à comparer.
 * @param {{ migrationUrl?: string, runtimeUrl?: string, runtimeRole?: string, expectedTarget?: string, allowLocal?: boolean, execute?: boolean, skipRuntimeCheck?: boolean }} options
 */
export function assertTarget({ migrationUrl, runtimeUrl, runtimeRole, expectedTarget, allowLocal, execute, skipRuntimeCheck }) {
  if (!migrationUrl) throw new RefusalError("MIGRATION_DATABASE_URL est obligatoire (jamais DATABASE_URL)");
  const target = parseTarget(migrationUrl);
  const warnings = [];
  const runtimeName = runtimeUrl ? parseTarget(runtimeUrl).username : runtimeRole;
  if (skipRuntimeCheck) {
    // lecture seule : aucun rôle runtime à comparer
  } else if (runtimeName) {
    if (runtimeName === target.username) {
      throw new RefusalError("La connexion de migration doit utiliser un autre rôle que la connexion runtime");
    }
  } else {
    warnings.push("Contrôle « rôle de migration ≠ rôle runtime » NON effectué (ni DATABASE_URL ni GAMENIGHT_RUNTIME_ROLE fournis)");
  }
  if (target.local) {
    if (!allowLocal) throw new RefusalError("Cible locale refusée sans --allow-local");
    if (!/^gamenight_[a-z0-9_]+$/.test(target.database)) {
      throw new RefusalError("Base locale refusée : le nom doit correspondre à ^gamenight_[a-z0-9_]+$");
    }
    return { target, warnings };
  }
  if (execute && !runtimeName && !skipRuntimeCheck) {
    throw new RefusalError("--execute hors machine locale exige DATABASE_URL ou GAMENIGHT_RUNTIME_ROLE (contrôle « rôle de migration ≠ rôle runtime » impossible)");
  }
  if (!expectedTarget) throw new RefusalError("GAMENIGHT_EXPECTED_TARGET (<hôte>[:port]/<base>) est obligatoire hors machine locale");
  if (target.pooled) throw new RefusalError("Hôte poolé refusé : utiliser la connexion directe pour migrer");
  const expected = expectedTarget.toLowerCase().replace(/^\/+|\/+$/g, "");
  const [expectedHostPort, ...rest] = expected.split("/");
  const [expectedHost, expectedPort] = expectedHostPort.split(":");
  const sameHost = expectedHost === target.host && (!expectedPort || expectedPort === target.port);
  if (!sameHost || rest.join("/") !== target.database.toLowerCase()) {
    throw new RefusalError(`Cible inattendue : ${target.host}:${target.port}/${target.database}`);
  }
  return { target, warnings };
}

/** Compare le dossier prisma/migrations à `_prisma_migrations`. */
export function diffMigrations(available, appliedRows) {
  const availableSet = new Set(available);
  const finished = appliedRows.filter((row) => row.finished_at && !row.rolled_back_at).map((row) => row.migration_name);
  const inProgress = appliedRows
    .filter((row) => !row.finished_at && !row.rolled_back_at)
    .map((row) => row.migration_name);
  return {
    finished: finished.sort(),
    absentFromCheckout: [...new Set(appliedRows.map((row) => row.migration_name))].filter((name) => !availableSet.has(name)).sort(),
    inProgress: inProgress.sort(),
    pending: [...availableSet].filter((name) => !finished.includes(name)).sort(),
  };
}

/**
 * La liste `--expect` doit être EXACTEMENT les migrations en attente, dans l'ordre d'application
 * (ordre des noms, celui de `prisma migrate deploy`) : ni manquante, ni en trop, ni doublon, ni inversée.
 */
export function assertExpectedPending({ absentFromCheckout, inProgress, pending, finished = /** @type {string[]} */ ([]) }, expected) {
  if (inProgress.length) throw new RefusalError(`Migration inachevée ou en échec : ${inProgress.join(", ")}`);
  if (absentFromCheckout.length) {
    throw new RefusalError(`L'historique contient des migrations absentes du checkout : ${absentFromCheckout.join(", ")}`);
  }
  if (!expected.length) throw new RefusalError("--expect est obligatoire (liste exacte des migrations à appliquer, dans l'ordre)");
  const duplicates = expected.filter((name, index) => expected.indexOf(name) !== index);
  if (duplicates.length) throw new RefusalError(`--expect contient un doublon : ${[...new Set(duplicates)].join(", ")}`);
  const missing = expected.filter((name) => !pending.includes(name));
  const unexpected = pending.filter((name) => !expected.includes(name));
  if (!pending.length && missing.every((name) => finished.includes(name))) {
    throw new RefusalError(
      `Rien à faire : aucune migration en attente, les ${expected.length} migration(s) de --expect sont déjà appliquées et terminées. Aucune écriture. (Manquantes : [${missing.join(", ")}])`,
    );
  }
  if (missing.length || unexpected.length) {
    const hint = missing.map((name) => `${name} ${finished.includes(name) ? "(déjà appliquée)" : "(absente du dossier prisma/migrations)"}`);
    throw new RefusalError(
      `Migrations en attente différentes de --expect. Manquantes : [${missing.join(", ")}]. Inattendues : [${unexpected.join(", ")}].${hint.length ? ` Détail manquantes : ${hint.join(" ; ")}.` : ""}`,
    );
  }
  if (expected.some((name, index) => name !== pending[index])) {
    throw new RefusalError(`Ordre de --expect différent de l'ordre d'application. Attendu : [${pending.join(", ")}]. Reçu : [${expected.join(", ")}]`);
  }
  return pending;
}

/**
 * Une seule source de cible : `MIGRATION_DATABASE_URL`. Toute autre variable d'URL de base présente dans l'environnement
 * (variables de l'intégration Vercel/Neon, DIRECT_URL…) rend la cible ambiguë : refus. `DATABASE_URL` (rôle runtime) est admise,
 * mais ne doit pas contredire `GAMENIGHT_RUNTIME_ROLE` si les deux sont fournis.
 */
export const COMPETING_URL_VARIABLES = [
  "DIRECT_URL", "DATABASE_URL_UNPOOLED", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING", "POSTGRES_URL_NO_SSL", "POSTGRES_DATABASE_URL",
];
export function assertSingleUrlSource(env) {
  const present = COMPETING_URL_VARIABLES.filter((name) => env[name]);
  if (present.length) throw new RefusalError(`Variables d'URL concurrentes présentes (${present.join(", ")}) : cible ambiguë, les retirer de l'environnement`);
  if (env.DATABASE_URL && env.GAMENIGHT_RUNTIME_ROLE && parseTarget(env.DATABASE_URL).username !== env.GAMENIGHT_RUNTIME_ROLE) {
    throw new RefusalError("DATABASE_URL et GAMENIGHT_RUNTIME_ROLE désignent deux rôles runtime différents : configuration ambiguë");
  }
}

/** Remplace chaque secret (et l'URL complète) par *** dans un texte destiné à l'affichage. */
export function redact(text, secrets) {
  let output = String(text);
  for (const secret of secrets.filter((value) => value && value.length >= 4)) {
    output = output.split(secret).join("***").split(encodeURIComponent(secret)).join("***");
  }
  return output;
}
