// Migration de base, séparée du build et du démarrage (opération d'exploitation).
//
//   node scripts/db-migrate.mjs --expect=<migration1,migration2> [--allow-local]
//   node scripts/db-migrate.mjs --expect=<…> --execute --confirm-database=<base> [--allow-local]
//
// Variables : MIGRATION_DATABASE_URL (rôle de migration, connexion directe; jamais DATABASE_URL),
// GAMENIGHT_EXPECTED_TARGET="<hôte>/<base>" hors machine locale. Dry-run par défaut.
// Aucune URL ni mot de passe n'est affiché. Codes de sortie : voir db-migrate-lib.mjs.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { EXIT, RefusalError, assertExpectedPending, assertTarget, diffMigrations, redact } from "./db-migrate-lib.mjs";

const MIGRATIONS_DIR = "prisma/migrations";

function readArgs(argv) {
  const value = (name) => argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  return {
    expect: (value("expect") ?? "").split(",").map((name) => name.trim()).filter(Boolean),
    execute: argv.includes("--execute"),
    confirm: value("confirm-database"),
    allowLocal: argv.includes("--allow-local"),
  };
}

function availableMigrations() {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(MIGRATIONS_DIR, entry.name, "migration.sql")))
    .map((entry) => entry.name);
}

async function appliedRows(url) {
  const client = new PrismaClient({ datasourceUrl: url });
  try {
    return await client.$queryRaw`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations`;
  } catch (error) {
    // Base neuve : la table d'historique n'existe pas encore (jamais le cas en Production).
    const message = String(error?.message);
    if (/_prisma_migrations/.test(message) && /does not exist/.test(message)) return [];
    throw error;
  } finally {
    await client.$disconnect();
  }
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  const target = assertTarget({
    migrationUrl,
    runtimeUrl: process.env.DATABASE_URL,
    expectedTarget: process.env.GAMENIGHT_EXPECTED_TARGET,
    allowLocal: args.allowLocal,
  });
  const secrets = [migrationUrl, target.password];
  const say = (message) => console.log(redact(message, secrets));
  say(`Cible : ${target.host}:${target.port}/${target.database} (rôle ${target.username})`);

  const diff = diffMigrations(availableMigrations(), await appliedRows(migrationUrl));
  const pending = assertExpectedPending(diff, args.expect);
  for (const name of pending) {
    const hash = createHash("sha256").update(readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"))).digest("hex");
    say(`À appliquer : ${name} (sha256 ${hash})`);
  }

  if (!args.execute) {
    say("DRY-RUN : aucune écriture. Relancer avec --execute --confirm-database=<base> pour appliquer.");
    return EXIT.OK;
  }
  if (args.confirm !== target.database) throw new RefusalError("--confirm-database=<base> absent ou différent de la cible");

  const env = { ...process.env, DATABASE_URL: migrationUrl };
  delete env.MIGRATION_DATABASE_URL;
  const run = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env, encoding: "utf8" });
  say(`${run.stdout ?? ""}${run.stderr ?? ""}`.trim());
  if (run.error || run.status !== 0) {
    say("ÉCHEC de prisma migrate deploy : ne pas relancer ni utiliser `migrate resolve` sans revue de l'état exact.");
    return EXIT.MIGRATION_FAILED;
  }

  const after = diffMigrations(availableMigrations(), await appliedRows(migrationUrl));
  if (after.pending.length || after.inProgress.length || after.absentFromCheckout.length) {
    say(`CONTRÔLE APRÈS MIGRATION EN ÉCHEC : en attente [${after.pending}] inachevées [${after.inProgress}]`);
    return EXIT.POSTCHECK_FAILED;
  }
  say(`OK : ${pending.length} migration(s) appliquée(s) et terminée(s), aucune en attente.`);
  return EXIT.OK;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    if (error instanceof RefusalError) {
      console.error(`REFUSÉ : ${error.message}`);
      process.exit(error.exitCode);
    }
    console.error(`ERREUR INATTENDUE : ${redact(error?.message ?? error, [process.env.MIGRATION_DATABASE_URL])}`);
    process.exit(EXIT.UNEXPECTED);
  },
);
