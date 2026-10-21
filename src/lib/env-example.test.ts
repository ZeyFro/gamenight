import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou de dérive : toute variable `process.env.X` lue par le code de `src`
 * doit apparaître dans `.env.example` (active ou commentée). Sans lui, chaque
 * nouvelle variable creuse un écart entre le code et la documentation de
 * configuration. Limite : ne voit que la forme `process.env.NOM` (pas
 * `process.env["NOM"]`) et ne lit que `src`, pas les scripts.
 */

/** Fournies par Node / Vercel, jamais à saisir dans `.env`. */
const PLATFORM_VARS = new Set([
  "NODE_ENV",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
]);

/**
 * Écarts connus au moment de l'ajout de ce test : lues par le code mais pas
 * encore dans `.env.example`. À documenter puis retirer d'ici (le test vérifie
 * qu'une entrée n'est pas périmée). Ne PAS en ajouter de nouvelles : documenter
 * la variable dans `.env.example`.
 */
const KNOWN_UNDOCUMENTED = new Set<string>();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|mjs)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

const usedVars = new Set<string>();
for (const file of sourceFiles("src")) {
  for (const match of readFileSync(file, "utf8").matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) {
    usedVars.add(match[1]);
  }
}

const documentedVars = new Set(
  [...readFileSync(".env.example", "utf8").matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1])
);

describe(".env.example ↔ process.env", () => {
  it("lit bien des variables des deux côtés (garde contre un scan vide)", () => {
    expect(usedVars.size).toBeGreaterThan(10);
    expect(documentedVars.size).toBeGreaterThan(10);
  });

  it("toute variable lue dans src est documentée dans .env.example", () => {
    const missing = [...usedVars]
      .filter((v) => !PLATFORM_VARS.has(v) && !KNOWN_UNDOCUMENTED.has(v) && !documentedVars.has(v))
      .sort();
    expect(missing, `Variables à ajouter à .env.example : ${missing.join(", ")}`).toEqual([]);
  });

  it("la liste des écarts connus n'est pas périmée", () => {
    const stale = [...KNOWN_UNDOCUMENTED].filter((v) => !usedVars.has(v) || documentedVars.has(v));
    expect(stale, `À retirer de KNOWN_UNDOCUMENTED : ${stale.join(", ")}`).toEqual([]);
  });
});
