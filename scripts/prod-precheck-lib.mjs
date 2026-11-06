// Briques PURES de scripts/prod-precheck.mjs : liste blanche d'instructions, arguments, évaluation. Aucune connexion.
// Codes de sortie du CLI : 0 conforme, 1 erreur inattendue (dont connexion impossible), 2 refus de configuration
// (cible, variable, argument, instruction hors liste blanche), 3 écart constaté (la base ne correspond pas à l'état demandé).
import { RefusalError } from "./db-migrate-lib.mjs";

export const PRECHECK_EXIT = { OK: 0, UNEXPECTED: 1, REFUSED: 2, GAP: 3 };

/** Le lot de migrations de la mise en ligne XP + vocal (= scripts/xp-rollout-migration-gate.mjs, vérifié par test). */
export const DEFAULT_LOT = [
  "20261019190000_separate_xp_balance",
  "20261020150000_session_voice_presence",
  "20261022120000_voice_presence_consent_coordination",
  "20261022130000_voice_presence_retention_gap_bounds",
  "20261022140000_voice_presence_gap_history",
  "20261022142500_shop_balance_purchase_reason",
];

// Liste blanche EXACTE : une instruction est envoyée seulement si son texte est l'une de ces constantes (aucun paramètre,
// aucune concaténation). Seules des lectures de catalogues et de `_prisma_migrations`, plus `SET TRANSACTION READ ONLY`
// (garde supplémentaire côté serveur : même une faute ici ne pourrait pas écrire). Aucun texte de requête (pg_stat_activity.query),
// aucun condensat de mot de passe (rolpassword, pg_authid, pg_shadow), aucun contenu de ligne applicative : agrégats seulement.
export const SQL = {
  readOnly: "SET TRANSACTION READ ONLY",
  identity: "SELECT current_user::text AS who, current_database()::text AS db, current_setting('server_version') AS version, current_setting('is_superuser') AS super",
  migrations: "SELECT migration_name::text, (finished_at IS NOT NULL) AS finished, (rolled_back_at IS NOT NULL) AS rolled_back FROM public._prisma_migrations ORDER BY migration_name, started_at",
  roles: "SELECT rolname::text, rolsuper, rolcanlogin, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname !~ '^pg_' ORDER BY rolname",
  members: "SELECT pg_get_userbyid(roleid)::text AS role, pg_get_userbyid(member)::text AS member, admin_option AS admin FROM pg_auth_members WHERE pg_get_userbyid(roleid) !~ '^pg_' ORDER BY 1, 2",
  tableOwners: "SELECT pg_get_userbyid(relowner)::text AS owner, count(*) AS n FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' GROUP BY 1 ORDER BY 1",
  // Sans pg_read_all_stats ni superuser, pg_stat_activity masque les sessions des autres rôles : le relevé de sessions est alors incomplet.
  seesAllSessions: "SELECT (pg_has_role(current_user, 'pg_read_all_stats', 'member') OR current_setting('is_superuser') = 'on') AS sees_all",
  sessions: "SELECT coalesce(usename, '?')::text AS usename, coalesce(application_name, '')::text AS app, coalesce(state, '?')::text AS state, count(*) AS n FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend' GROUP BY 1, 2, 3 ORDER BY 1, 2, 3",
  statsTable: "SELECT count(*) AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'CommunityMemberStats'",
  balanceColumn: "SELECT count(*) AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CommunityMemberStats' AND column_name = 'xpBalance'",
  statsBase: "SELECT count(*) AS n, count(*) FILTER (WHERE \"xpTotal\" < 0) AS negatives, coalesce(sum(\"xpTotal\"), 0) AS sum_total, pg_total_relation_size('public.\"CommunityMemberStats\"') AS relation_bytes, pg_database_size(current_database()) AS database_bytes FROM public.\"CommunityMemberStats\"",
  statsBalance: "SELECT count(*) FILTER (WHERE \"xpBalance\" < 0) AS negatives, count(*) FILTER (WHERE \"xpBalance\" <> \"xpTotal\") AS divergent, coalesce(sum(\"xpBalance\"), 0) AS sum_balance FROM public.\"CommunityMemberStats\"",
};
export const ALLOWED_SQL = new Set(Object.values(SQL));

/** Refuse (code 2) toute instruction qui n'est pas EXACTEMENT une constante de la liste blanche, avant tout envoi. */
export function guard(sql) {
  if (!ALLOWED_SQL.has(sql)) throw new RefusalError("Instruction hors liste blanche refusée avant envoi (le précontrôle n'exécute que ses lectures prévues)");
  return sql;
}

/** Arguments : `--nom` ou `--nom=valeur`. Aucune URL ni mot de passe en argument ; une forme inconnue est refusée sans l'afficher. */
export function readPrecheckArgs(argv) {
  const known = new Set(["state", "lot", "allow-local", "require-split-roles", "require-no-sessions-of"]);
  const args = { state: undefined, lot: DEFAULT_LOT, allowLocal: false, requireSplitRoles: false, noSessionsOf: undefined };
  for (const arg of argv) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!match || !known.has(match[1]) || /:\/\/|@/.test(arg)) {
      throw new RefusalError("Argument refusé (forme inconnue ; valeur non affichée). Jamais d'URL ni de mot de passe en argument : variable GAMENIGHT_PRECHECK_DATABASE_URL");
    }
    const [, name, value] = match;
    if (["allow-local", "require-split-roles"].includes(name)) {
      if (value !== undefined) throw new RefusalError(`--${name} est un drapeau sans valeur`);
      if (name === "allow-local") args.allowLocal = true; else args.requireSplitRoles = true;
    } else if (name === "state") {
      if (!["pre", "post"].includes(value)) throw new RefusalError("--state doit valoir pre (avant migration) ou post (après migration)");
      args.state = value;
    } else if (name === "lot") {
      args.lot = (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
      if (!args.lot.length || new Set(args.lot).size !== args.lot.length) throw new RefusalError("--lot : liste vide ou avec doublon");
    } else {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value ?? "")) throw new RefusalError("--require-no-sessions-of=<rôle> : nom de rôle invalide");
      args.noSessionsOf = value;
    }
  }
  if (!args.state) throw new RefusalError("--state=pre|post est obligatoire");
  return args;
}

const FLAGS = ["rolsuper", "rolcreatedb", "rolcreaterole", "rolreplication", "rolbypassrls"];
const num = (value) => Number(value);

/**
 * Évalue les relevés. Renvoie `{ lines, gaps }` : chaque ligne `{ level: "OK" | "ÉCART" | "INFO", text }`, `gaps` = nombre d'écarts.
 * @param {{ args: ReturnType<typeof readPrecheckArgs>, checkout: string[], migrations: {migration_name:string, finished:boolean, rolled_back:boolean}[],
 *   roles: {rolname:string, rolsuper:boolean, rolcanlogin:boolean, rolcreatedb:boolean, rolcreaterole:boolean, rolreplication:boolean, rolbypassrls:boolean}[],
 *   members: [string, string, boolean][], tableOwners: [string, number][], sessions: [string, string, string, number][],
 *   stats: null | { rows:number, negativeTotals:number, sumTotal:string, relationBytes:number, databaseBytes:number, balance: null | { negatives:number, divergent:number, sum:string } },
 *   seesAllSessions: boolean, runtimeRole: string, migrationRole: string }} snapshot
 */
export function evaluate(snapshot) {
  const { args, checkout, migrations, roles, members, tableOwners, sessions, stats, runtimeRole, migrationRole, seesAllSessions } = snapshot;
  const lines = [];
  const add = (level, text) => lines.push({ level, text });
  const check = (ok, text, detail = "") => add(ok ? "OK" : "ÉCART", `${text}${ok || !detail ? "" : ` : ${detail}`}`);

  // ---- migrations
  const names = [...new Set(migrations.map((row) => row.migration_name))];
  const finished = names.filter((name) => migrations.some((row) => row.migration_name === name && row.finished && !row.rolled_back));
  const inProgress = names.filter((name) => migrations.some((row) => row.migration_name === name && !row.finished && !row.rolled_back));
  const rolledBackOnly = names.filter((name) => !finished.includes(name) && !inProgress.includes(name));
  add("INFO", `migrations : ${finished.length} terminée(s), ${inProgress.length} inachevée(s), ${rolledBackOnly.length} annulée(s) sans reprise (${names.length} nom(s) dans l'historique, ${checkout.length} dans le checkout)`);
  check(inProgress.length === 0, "aucune migration inachevée", inProgress.join(", "));
  check(rolledBackOnly.length === 0, "aucune migration annulée sans reprise", rolledBackOnly.join(", "));
  const absentFromCheckout = names.filter((name) => !checkout.includes(name));
  check(absentFromCheckout.length === 0, "l'historique ne contient rien d'absent du checkout", absentFromCheckout.join(", "));
  const pending = checkout.filter((name) => !finished.includes(name)).sort();
  const lotDone = args.lot.filter((name) => finished.includes(name));
  add("INFO", `lot de ${args.lot.length} migration(s) : ${lotDone.length} terminée(s), ${args.lot.length - lotDone.length} non terminée(s)`);
  if (args.state === "pre") {
    check(lotDone.length === 0, "avant migration : aucune migration du lot n'est terminée", lotDone.join(", "));
    const expected = [...args.lot].sort();
    check(JSON.stringify(pending) === JSON.stringify(expected), "avant migration : les migrations en attente sont exactement le lot",
      `en attente [${pending.join(", ")}] ; lot [${expected.join(", ")}]`);
  } else {
    check(lotDone.length === args.lot.length, "après migration : toutes les migrations du lot sont terminées", args.lot.filter((name) => !finished.includes(name)).join(", "));
    check(pending.length === 0, "après migration : plus aucune migration en attente", pending.join(", "));
  }

  // ---- rôles
  const login = roles.filter((role) => role.rolcanlogin);
  for (const role of roles) {
    const attrs = FLAGS.filter((flag) => role[flag]).map((flag) => flag.replace("rol", "").toUpperCase());
    add("INFO", `rôle ${role.rolname} : ${role.rolcanlogin ? "LOGIN" : "NOLOGIN"}${attrs.length ? ` ${attrs.join(" ")}` : ""}`);
  }
  for (const [roleName, member, admin] of members) add("INFO", `appartenance : ${member} est membre de ${roleName}${admin ? " (admin)" : ""}`);
  for (const [owner, count] of tableOwners) add("INFO", `tables du schéma public possédées par ${owner} : ${num(count)}`);
  const owners = tableOwners.map(([owner]) => owner);
  if (!args.requireSplitRoles) {
    add("INFO", owners.length === 1 && login.filter((role) => role.rolname === owners[0]).length === 1 && !roles.some((role) => [runtimeRole, migrationRole].includes(role.rolname))
      ? `séparation des rôles ABSENTE : ${runtimeRole} et ${migrationRole} n'existent pas, ${owners[0]} possède tout (état attendu avant la mise en place)`
      : "séparation des rôles : voir les rôles ci-dessus (--require-split-roles pour l'exiger)");
  } else {
    const runtime = roles.find((role) => role.rolname === runtimeRole);
    const migrator = roles.find((role) => role.rolname === migrationRole);
    check(Boolean(runtime), `rôle runtime ${runtimeRole} présent`);
    check(Boolean(migrator), `rôle de migration ${migrationRole} présent`);
    check(runtimeRole !== migrationRole, "rôle de migration distinct du rôle runtime");
    for (const role of [runtime, migrator].filter(Boolean)) {
      const bad = FLAGS.filter((flag) => role[flag]);
      check(bad.length === 0, `${role.rolname} sans SUPERUSER/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS`, bad.join(", "));
    }
    check(!owners.includes(runtimeRole), `${runtimeRole} ne possède aucune table`);
  }

  // ---- sessions (sans texte de requête)
  const total = sessions.reduce((sum, row) => sum + num(row[3]), 0);
  add("INFO", `sessions clientes de la base (hors celle du précontrôle) : ${total}`);
  for (const [user, app, state, count] of sessions) add("INFO", `session : rôle ${user}, application « ${app || "(vide)"} », état ${state} : ${num(count)}`);
  if (seesAllSessions !== true) add("INFO", "ATTENTION : le rôle de contrôle n'a ni pg_read_all_stats ni SUPERUSER : les sessions des autres rôles sont masquées, le relevé ci-dessus est INCOMPLET");
  if (args.noSessionsOf) {
    check(seesAllSessions === true, "visibilité de toutes les sessions (pg_read_all_stats ou SUPERUSER) : sans elle, « aucune session » ne prouve rien", "le rôle de contrôle ne voit pas les sessions des autres rôles ; se connecter avec un rôle membre de pg_read_all_stats");
    const n = sessions.filter((row) => row[0] === args.noSessionsOf).reduce((sum, row) => sum + num(row[3]), 0);
    if (seesAllSessions === true) check(n === 0, `aucune session ouverte du rôle ${args.noSessionsOf}`, `${n} session(s)`);
  }

  // ---- CommunityMemberStats (agrégats seulement)
  if (!stats) {
    add("INFO", "table CommunityMemberStats absente");
  } else {
    add("INFO", `CommunityMemberStats : ${num(stats.rows)} ligne(s), somme xpTotal ${stats.sumTotal}, table ${num(stats.relationBytes)} octets, base ${num(stats.databaseBytes)} octets`);
    check(num(stats.negativeTotals) === 0, "aucun xpTotal négatif", `${num(stats.negativeTotals)} ligne(s)`);
    if (stats.balance) {
      add("INFO", `xpBalance : somme ${stats.balance.sum}, ${num(stats.balance.divergent)} ligne(s) avec xpBalance différent de xpTotal (normal après réouverture et achats)`);
      check(num(stats.balance.negatives) === 0, "aucun xpBalance négatif", `${num(stats.balance.negatives)} ligne(s)`);
    }
    if (args.state === "pre") check(!stats.balance, "avant migration : colonne xpBalance absente");
    else check(Boolean(stats.balance), "après migration : colonne xpBalance présente");
  }
  return { lines, gaps: lines.filter((line) => line.level === "ÉCART").length };
}
