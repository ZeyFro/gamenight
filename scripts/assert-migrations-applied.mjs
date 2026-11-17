// Garde de build « anti-fenêtre » : en PRODUCTION, un build ne doit pas produire un déploiement
// dont le code attend des migrations que la base n'a pas encore reçues.
//
// Principe : on compare les dossiers de prisma/migrations du commit construit aux lignes TERMINÉES
// de _prisma_migrations. S'il en manque une, le build échoue : Vercel ne crée alors aucun nouveau
// déploiement Production et le précédent reste servi. Après la migration, un nouveau build passe.
//
// Strictement LECTURE SEULE (transaction READ ONLY). N'affiche jamais l'URL, l'hôte ni un secret :
// uniquement des noms de migration et des compteurs.
//
// Déploiement progressif :
//   - VERCEL_ENV différent de "production" : la garde ne fait rien (Preview, local, CI).
//   - MIGRATION_GATE_ENFORCE absent ou différent de exactement "true" : MODE RAPPORT. Le résultat est
//     journalisé mais ne fait jamais échouer le build (permet de valider la lecture sur un vrai build).
//   - MIGRATION_GATE_ENFORCE=true : le build échoue si une migration manque, est inachevée, ou si la
//     base est illisible (échec fermé).
//
// Connexion : MIGRATION_GATE_DATABASE_URL (rôle dédié en SELECT sur _prisma_migrations seulement,
// recommandé) ; à défaut DATABASE_URL du build. Variables à définir dans Vercel Production seulement :
// en Preview la garde sort avant de lire quoi que ce soit.
//
// MIGRATION_GATE_DIR n'existe que pour les tests (dossier de migrations à comparer).
import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

const MIGRATION_DIR = /^\d{14}_/;
const READ_TIMEOUT_MS = 20_000;

/** Noms des dossiers de migration (migration_lock.toml et autres fichiers exclus), triés. */
export function listLocalMigrations(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && MIGRATION_DIR.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/** Décision pure. `applied` : noms terminés et non annulés ; `unfinished` : nombre de lignes inachevées. */
export function evaluateGate({ local, applied, unfinished }) {
  const appliedSet = new Set(applied);
  const pending = local.filter((name) => !appliedSet.has(name));
  return { ok: pending.length === 0 && unfinished === 0, pending, unfinished };
}

/** URL de lecture : l'URL dédiée en priorité, jamais affichée. */
export const gateDatabaseUrl = (env) => env.MIGRATION_GATE_DATABASE_URL || env.DATABASE_URL;

export function describeGate(result, local) {
  const lines = [`${local.length} migration(s) dans le commit, ${local.length - result.pending.length} appliquée(s) en base.`];
  if (result.unfinished > 0) lines.push(`${result.unfinished} migration(s) inachevée(s) dans _prisma_migrations.`);
  for (const name of result.pending) lines.push(`En attente : ${name}`);
  if (result.ok) lines.push("Schéma à jour : le déploiement peut continuer.");
  return lines;
}

async function readDatabaseState(url) {
  const db = new PrismaClient({ datasourceUrl: url });
  let timer;
  try {
    const read = db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const applied = await tx.$queryRawUnsafe(
        `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
      );
      const [{ n }] = await tx.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
      );
      return { applied: applied.map((row) => row.migration_name), unfinished: n };
    });
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("délai dépassé"), { code: "TIMEOUT" })), READ_TIMEOUT_MS);
    });
    return await Promise.race([read, timeout]);
  } finally {
    clearTimeout(timer);
    await db.$disconnect().catch(() => undefined);
  }
}

/**
 * Retourne le code de sortie ; `log`/`fail` injectables pour les tests.
 * @param {Record<string, string | undefined>} [env]
 */
export async function run(env = process.env, { log = console.log, fail = console.error } = {}) {
  if (env.VERCEL_ENV !== "production") {
    log("[migration-gate] ignorée : environnement différent de production.");
    return 0;
  }
  const enforce = env.MIGRATION_GATE_ENFORCE === "true";
  const mode = enforce ? "application stricte" : "mode rapport (jamais bloquant)";
  log(`[migration-gate] ${mode}.`);
  const refuse = (message) => {
    fail(`[migration-gate] ${message}`);
    return enforce ? 1 : 0;
  };

  const databaseUrl = gateDatabaseUrl(env);
  if (!databaseUrl) return refuse("aucune URL de base (MIGRATION_GATE_DATABASE_URL ou DATABASE_URL) : état indéterminable.");
  // Nom de la variable seulement, jamais sa valeur : permet de vérifier que le rôle dédié est bien utilisé.
  log(`[migration-gate] source de connexion : ${env.MIGRATION_GATE_DATABASE_URL ? "MIGRATION_GATE_DATABASE_URL (rôle dédié)" : "DATABASE_URL"}.`);
  let local;
  try {
    local = listLocalMigrations(env.MIGRATION_GATE_DIR || "prisma/migrations");
  } catch (error) {
    return refuse(`dossier de migrations illisible (${error?.code ?? "inconnu"}).`);
  }
  let state;
  try {
    state = await readDatabaseState(databaseUrl);
  } catch (error) {
    // Le message Prisma peut citer l'hôte : on n'affiche que le code.
    return refuse(`base illisible (${error?.code ?? error?.name ?? "inconnu"}) : état des migrations indéterminable.`);
  }
  const result = evaluateGate({ local, applied: state.applied, unfinished: state.unfinished });
  for (const line of describeGate(result, local)) (result.ok ? log : fail)(`[migration-gate] ${line}`);
  if (result.ok) return 0;
  fail(
    enforce
      ? "[migration-gate] Build refusé : le déploiement précédent reste servi. Appliquer la migration (workflow « Migrations Production »), puis relancer le déploiement."
      : "[migration-gate] Mode rapport : en application stricte, ce build aurait été refusé.",
  );
  return enforce ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().then((code) => process.exit(code));
}
