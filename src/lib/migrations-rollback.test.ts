import { describe, expect, it } from "vitest";
import { migrationNames, readRollback, ROLLBACK_HEADER, ROLLBACK_REQUIRED_FROM, rollbackNames, sqlStatements } from "./migrations-rollback-files";

/**
 * Cahier §21.4 : aucune migration de production sans procédure de retour arrière. Toute migration créée à partir
 * du 23/11/2026 a son fichier `prisma/rollbacks/<nom>.sql`, manuel, jamais exécuté automatiquement.
 */
describe("retours arrière des migrations", () => {
  const migrations = migrationNames();
  const rollbacks = rollbackNames();

  it("chaque migration récente a son retour arrière", () => {
    const missing = migrations.filter(name => name >= ROLLBACK_REQUIRED_FROM && !rollbacks.includes(name));
    expect(missing, `retour arrière manquant dans prisma/rollbacks : ${missing.join(", ")}`).toEqual([]);
  });

  it("chaque retour arrière correspond à une migration existante, porte l'en-tête « manuel » et contient au moins une instruction", () => {
    for (const name of rollbacks) {
      expect(migrations, `migration inconnue : ${name}`).toContain(name);
      const sql = readRollback(name);
      expect(sql.startsWith(ROLLBACK_HEADER), `${name} : en-tête « ${ROLLBACK_HEADER} » attendu en première ligne`).toBe(true);
      expect(sqlStatements(sql).length, `${name} : aucune instruction`).toBeGreaterThan(0);
    }
  });

  it("découpe les instructions en ignorant les commentaires", () => {
    expect(sqlStatements("-- a ; b\nALTER TABLE x DROP COLUMN y;\n-- fin\nALTER TABLE x DROP COLUMN z;\n")).toEqual([
      "ALTER TABLE x DROP COLUMN y", "ALTER TABLE x DROP COLUMN z",
    ]);
  });
});
