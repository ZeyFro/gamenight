import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou : les migrations Prisma sont appliquées sur la base Neon de production
 * par l'opération `scripts/db-migrate.mjs` (plus par le build Vercel). Une
 * migration destructive (DROP TABLE/COLUMN, TRUNCATE, DELETE FROM, changement
 * de type) y détruirait des données sans retour. Seules les migrations
 * historiques listées ci-dessous (déjà appliquées) sont tolérées ; toute
 * nouvelle migration doit être additive.
 */

const DIR = "prisma/migrations";

// Migrations déjà appliquées contenant une instruction destructive (relues).
const GRANDFATHERED = new Set(["20260821144022_rename_reminder_to_message_template"]);

const DESTRUCTIVE = /\b(DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM|DROP\s+TYPE|ALTER\s+COLUMN\s+"?\w+"?\s+(?:SET\s+DATA\s+)?TYPE)\b/i;

function stripComments(sql: string): string {
  return sql.replace(/--.*$/gm, "");
}

describe("migrations Prisma", () => {
  const names = readdirSync(DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  it("existent", () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it("aucune nouvelle migration n'est destructive (additives uniquement)", () => {
    const offenders = names.filter((name) => {
      if (GRANDFATHERED.has(name)) return false;
      const sql = stripComments(readFileSync(join(DIR, name, "migration.sql"), "utf8"));
      return DESTRUCTIVE.test(sql);
    });
    expect(offenders, `migrations destructives : ${offenders.join(", ")}`).toEqual([]);
  });

  it("la liste des exceptions ne référence que des migrations existantes", () => {
    for (const name of GRANDFATHERED) expect(names).toContain(name);
  });
});
