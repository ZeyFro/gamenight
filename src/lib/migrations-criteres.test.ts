import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { migrationNames, ROLLBACK_REQUIRED_FROM, rollbackNames } from "./migrations-rollback-files";

/**
 * C061 (cahier 21.4) : « Migrations : structure vérifiée, sauvegarde, tests, retour arrière, validation de la bascule ».
 * Chaque critère a ici une preuve exécutable ; la correspondance critère → preuve est dans docs/MIGRATIONS.md
 * (§ « Critères du cahier 21.4 et leur preuve »). Les gestes qui exigent un accès à Neon restent humains et sont listés là.
 */
const read = (path: string) => readFileSync(path, "utf8");
const names = migrationNames();
const recent = names.filter((name) => name >= ROLLBACK_REQUIRED_FROM);

describe("1. structure vérifiée", () => {
  it("chaque dossier de migration porte un nom au bon format (horodatage à 14 chiffres, unique pour les récentes) et un migration.sql non vide", () => {
    expect(names.length).toBeGreaterThan(100);
    expect(names.every((name) => /^\d{14}_[a-z0-9_]+$/.test(name)), "nom de migration hors format").toBe(true);
    // Des horodatages historiques sont en double (migrations immuables, jamais renommées) : la règle vaut pour les migrations récentes.
    expect(new Set(names).size, "nom de migration en double").toBe(names.length);
    expect(new Set(recent.map((name) => name.slice(0, 14))).size, "horodatage récent en double").toBe(recent.length);
    for (const name of names) expect(read(`prisma/migrations/${name}/migration.sql`).trim().length, `${name} : migration.sql vide`).toBeGreaterThan(0);
  });

  it("le verrou de migration cible PostgreSQL et le dossier ne contient que des migrations et ce verrou", () => {
    expect(read("prisma/migrations/migration_lock.toml")).toMatch(/provider\s*=\s*"postgresql"/);
    const strangers = readdirSync("prisma/migrations").filter((entry) => entry !== "migration_lock.toml" && !names.includes(entry));
    expect(strangers).toEqual([]);
  });

  it("toute nouvelle migration est ADDITIVE : aucune suppression, renommage, troncature ni changement de type (règle « additives seulement »)", () => {
    expect(recent.length).toBeGreaterThan(0);
    const destructive = /\b(DROP\s+(TABLE|COLUMN|TYPE|SCHEMA|DATABASE|CONSTRAINT)|TRUNCATE|RENAME\s+(TO|COLUMN)|DELETE\s+FROM|ALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE)\b/i;
    const offenders = recent.filter((name) => destructive.test(read(`prisma/migrations/${name}/migration.sql`).replace(/--[^\n]*/g, "")));
    expect(offenders, `migration destructive (créer une migration additive à la place) : ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("2. sauvegarde et exécution : le workflow de production ne fait que `migrate deploy`, depuis main", () => {
  const workflow = read(".github/workflows/migrate-production.yml");
  const runner = read("scripts/db-migrate.mjs");

  it("jamais de reset, de db push, de migrate dev ni de perte de données acceptée", () => {
    for (const forbidden of [/migrate\s+reset/, /db\s+push/, /migrate\s+dev/, /--accept-data-loss/, /--force-reset/]) {
      expect(workflow, String(forbidden)).not.toMatch(forbidden);
      expect(runner, String(forbidden)).not.toMatch(forbidden);
    }
    expect(runner).toMatch(/migrate["',\s]+deploy|migrate deploy/);
  });

  it("une seule exécution à la fois, jamais annulée en cours, uniquement depuis main et dans l'environnement protégé", () => {
    expect(workflow).toMatch(/concurrency:\s*\n\s*group: migrate-production\s*\n\s*cancel-in-progress: false/);
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("environment: production-migrations");
    expect(workflow).toMatch(/\*-pooler\*/); // l'URL poolée est refusée : seule l'URL directe est acceptée
  });

  it("le secret de production n'est lu que par le workflow, jamais écrit dans le dépôt", () => {
    expect(workflow).toContain("secrets.PRODUCTION_MIGRATION_DATABASE_URL");
    expect(read(".env.example")).not.toMatch(/PRODUCTION_MIGRATION_DATABASE_URL\s*=\s*\S/);
  });
});

describe("3. retour arrière : fichiers manuels, jamais exécutés automatiquement", () => {
  it("chaque migration récente a son retour arrière, qui ne détruit ni la base ni le schéma", () => {
    const rollbacks = rollbackNames();
    expect(recent.filter((name) => !rollbacks.includes(name))).toEqual([]);
    for (const name of rollbacks) expect(read(`prisma/rollbacks/${name}.sql`), `${name} : retour arrière trop large`).not.toMatch(/DROP\s+(DATABASE|SCHEMA)|TRUNCATE/i);
  });

  it("aucun script ni workflow n'exécute prisma/rollbacks", () => {
    const executors = [".github/workflows/migrate-production.yml", ".github/workflows/ci.yml", "scripts/db-migrate.mjs", "scripts/build.mjs", "package.json"];
    for (const file of executors.filter((path) => existsSync(path))) expect(read(file), file).not.toContain("prisma/rollbacks");
  });
});

describe("4. validation de la bascule : garde de build et immutabilité", () => {
  it("le build appelle la garde « anti-fenêtre » et n'exécute AUCUNE migration lui-même", () => {
    const build = read("scripts/build.mjs");
    expect(build).toContain("assert-migrations-applied");
    expect(build).not.toMatch(/migrate\s+deploy|db\s+push|migrate\s+dev/);
  });

  it("la garde est en lecture seule (transaction READ ONLY) et échoue fermé quand elle est stricte", () => {
    const gate = read("scripts/assert-migrations-applied.mjs");
    expect(gate).toMatch(/READ ONLY/i);
    expect(gate).toContain("MIGRATION_GATE_ENFORCE");
  });

  it("une migration existante est immuable : le contrôle de CI est branché (check « immutable »)", () => {
    expect(existsSync("scripts/check-migrations-immutable.mjs")).toBe(true);
    expect(read(".github/workflows/ci.yml") + (existsSync(".github/workflows/immutable.yml") ? read(".github/workflows/immutable.yml") : "")).toMatch(/check-migrations-immutable|immutable/);
  });
});
