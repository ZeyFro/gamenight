// Contrôles purs de scripts/db-migrate.mjs : aucune connexion, aucun affichage de secret.
// Codes de sortie du CLI : 0 ok ou dry-run, 1 erreur inattendue, 2 précontrôle refusé,
// 3 migration en échec, 4 contrôle après migration en échec (ou impossible).

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
 * - en local : `--allow-local` et base `gamenight_*` uniquement.
 */
export function assertTarget({ migrationUrl, runtimeUrl, runtimeRole, expectedTarget, allowLocal }) {
  if (!migrationUrl) throw new RefusalError("MIGRATION_DATABASE_URL est obligatoire (jamais DATABASE_URL)");
  const target = parseTarget(migrationUrl);
  const warnings = [];
  const runtimeName = runtimeUrl ? parseTarget(runtimeUrl).username : runtimeRole;
  if (runtimeName) {
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
    absentFromCheckout: [...new Set(appliedRows.map((row) => row.migration_name))].filter((name) => !availableSet.has(name)).sort(),
    inProgress: inProgress.sort(),
    pending: [...availableSet].filter((name) => !finished.includes(name)).sort(),
  };
}

/** Seules les migrations attendues, exactement celles-là, peuvent être en attente. */
export function assertExpectedPending({ absentFromCheckout, inProgress, pending }, expected) {
  if (inProgress.length) throw new RefusalError(`Migration inachevée ou en échec : ${inProgress.join(", ")}`);
  if (absentFromCheckout.length) {
    throw new RefusalError(`L'historique contient des migrations absentes du checkout : ${absentFromCheckout.join(", ")}`);
  }
  const wanted = [...new Set(expected)].sort();
  if (!wanted.length) throw new RefusalError("--expect est obligatoire (liste exacte des migrations à appliquer)");
  const missing = wanted.filter((name) => !pending.includes(name));
  const unexpected = pending.filter((name) => !wanted.includes(name));
  if (missing.length || unexpected.length) {
    throw new RefusalError(
      `Migrations en attente différentes de --expect. Manquantes : [${missing.join(", ")}]. Inattendues : [${unexpected.join(", ")}]`,
    );
  }
  return pending;
}

/** Remplace chaque secret (et l'URL complète) par *** dans un texte destiné à l'affichage. */
export function redact(text, secrets) {
  let output = String(text);
  for (const secret of secrets.filter((value) => value && value.length >= 4)) {
    output = output.split(secret).join("***").split(encodeURIComponent(secret)).join("***");
  }
  return output;
}
