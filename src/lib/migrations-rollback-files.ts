import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Migrations créées à partir de cette date : retour arrière manuel obligatoire (cahier §21.4). */
export const ROLLBACK_REQUIRED_FROM = "20261123000000";
export const MIGRATIONS_DIR = "prisma/migrations";
export const ROLLBACKS_DIR = "prisma/rollbacks";
export const ROLLBACK_HEADER = "-- Retour arrière MANUEL";

export function migrationNames(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
}

export function rollbackNames(): string[] {
  return existsSync(ROLLBACKS_DIR) ? readdirSync(ROLLBACKS_DIR).filter(name => name.endsWith(".sql")).map(name => name.slice(0, -4)).sort() : [];
}

export function readRollback(name: string): string {
  return readFileSync(join(ROLLBACKS_DIR, `${name}.sql`), "utf8");
}

export function readMigration(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
}

/** Instructions d'un fichier SQL simple (une par point-virgule de fin de ligne), sans les commentaires. */
export function sqlStatements(sql: string): string[] {
  return sql.replace(/--.*$/gm, "").split(/;\s*$/m).map(statement => statement.trim()).filter(Boolean);
}
