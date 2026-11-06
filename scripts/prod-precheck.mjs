// Précontrôle EN LECTURE SEULE d'une base avant la mise en ligne XP + vocal. À lancer par l'OPÉRATEUR, sur sa machine.
//
//   GAMENIGHT_PRECHECK_DATABASE_URL=<url privée> GAMENIGHT_EXPECTED_TARGET="<hôte>[:port]/<base>" \
//     node scripts/prod-precheck.mjs --state=pre|post [--require-split-roles] [--require-no-sessions-of=<rôle>] [--lot=a,b] [--allow-local]
//
// - L'URL n'est lue que dans la variable d'environnement : jamais en argument, jamais affichée ni journalisée (masquée dans toute sortie).
// - N'envoie que les instructions de la liste blanche exacte de prod-precheck-lib.mjs (lectures de catalogues et de `_prisma_migrations`),
//   dans une transaction `SET TRANSACTION READ ONLY` : le serveur refuserait toute écriture. Aucune écriture, aucun verrou durable.
// - Cible : hôte[:port]/base exacts attendus (GAMENIGHT_EXPECTED_TARGET), hôte non poolé ; local = --allow-local et base gamenight_*.
//   La base réellement jointe (current_database()) doit être celle de l'URL.
// - Codes de sortie : 0 conforme, 1 erreur inattendue (connexion impossible…), 2 refus de configuration, 3 écart constaté.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { RefusalError, assertSingleUrlSource, assertTarget, redact } from "./db-migrate-lib.mjs";
import { PRECHECK_EXIT, SQL, evaluate, guard, readPrecheckArgs } from "./prod-precheck-lib.mjs";

const URL_VARIABLE = "GAMENIGHT_PRECHECK_DATABASE_URL";
const MIGRATIONS_DIR = fileURLToPath(new URL("../prisma/migrations", import.meta.url));
const secrets = [process.env[URL_VARIABLE]];
const say = (text) => console.log(redact(text, secrets));

async function snapshot(url, args, target) {
  const client = new PrismaClient({ datasourceUrl: url });
  try {
    return await client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(guard(SQL.readOnly));
      const rows = (sql) => tx.$queryRawUnsafe(guard(sql));
      const [identity] = await rows(SQL.identity);
      const [who, database, version, isSuper] = Object.values(identity);
      if (database !== target.database) throw new RefusalError(`La base jointe (${database}) n'est pas celle de l'URL (${target.database}) : refus`);
      const migrations = await rows(SQL.migrations);
      const roles = await rows(SQL.roles);
      const members = (await rows(SQL.members)).map((row) => Object.values(row));
      const tableOwners = (await rows(SQL.tableOwners)).map((row) => Object.values(row));
      const seesAllSessions = Object.values((await rows(SQL.seesAllSessions))[0])[0] === true;
      const sessions = (await rows(SQL.sessions)).map((row) => Object.values(row));
      let stats = null;
      if (Number(Object.values((await rows(SQL.statsTable))[0])[0]) > 0) {
        const [rowsN, negativeTotals, sumTotal, relationBytes, databaseBytes] = Object.values((await rows(SQL.statsBase))[0]);
        stats = { rows: rowsN, negativeTotals, sumTotal: String(sumTotal), relationBytes, databaseBytes, balance: null };
        if (Number(Object.values((await rows(SQL.balanceColumn))[0])[0]) > 0) {
          const [negatives, divergent, sum] = Object.values((await rows(SQL.statsBalance))[0]);
          stats.balance = { negatives, divergent, sum: String(sum) };
        }
      }
      return { identity: { who, database, version, isSuper }, migrations, roles, members, tableOwners, sessions, seesAllSessions, stats };
    }, { maxWait: 30_000, timeout: 60_000 });
  } finally {
    await client.$disconnect();
  }
}

async function main() {
  const args = readPrecheckArgs(process.argv.slice(2));
  const url = process.env[URL_VARIABLE];
  if (!url) throw new RefusalError(`${URL_VARIABLE} est obligatoire (variable privée de l'opérateur ; jamais en argument)`);
  assertSingleUrlSource(process.env);
  const { target, warnings } = assertTarget({
    migrationUrl: url, expectedTarget: process.env.GAMENIGHT_EXPECTED_TARGET, allowLocal: args.allowLocal, skipRuntimeCheck: true,
  });
  secrets.push(target.password);
  for (const warning of warnings) say(`AVERTISSEMENT : ${warning}`);
  if (!existsSync(MIGRATIONS_DIR)) throw new RefusalError("Dossier prisma/migrations introuvable : lancer depuis un checkout complet");
  const checkout = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(MIGRATIONS_DIR, entry.name, "migration.sql"))).map((entry) => entry.name).sort();

  say(`Cible : ${target.host}:${target.port}/${target.database} (rôle ${target.username}) ; état demandé : ${args.state} ; LECTURE SEULE`);
  const data = await snapshot(url, args, target);
  say(`Serveur PostgreSQL ${data.identity.version}, session ${data.identity.who}, superuser : ${data.identity.isSuper}`);
  const { lines, gaps } = evaluate({
    args, checkout, ...data,
    runtimeRole: process.env.GAMENIGHT_RUNTIME_ROLE || "gn_runtime", migrationRole: process.env.GAMENIGHT_MIGRATION_ROLE || "gn_migrator",
  });
  for (const line of lines) say(`[${line.level}] ${line.text}`);
  say(gaps ? `NON CONFORME : ${gaps} écart(s).` : "CONFORME : aucun écart.");
  return gaps ? PRECHECK_EXIT.GAP : PRECHECK_EXIT.OK;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    if (error instanceof RefusalError) {
      console.error(redact(`REFUSÉ : ${error.message}`, secrets));
      process.exit(PRECHECK_EXIT.REFUSED);
    }
    console.error(redact(`ERREUR INATTENDUE : ${String(error?.message ?? error).split("\n").filter(Boolean).slice(-2).join(" | ")}`, secrets));
    process.exit(PRECHECK_EXIT.UNEXPECTED);
  },
);
