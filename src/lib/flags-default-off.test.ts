import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Cahier §27.6 / C092 : « Tous les interrupteurs sont OFF par défaut ».
 *
 * Preuve statique exhaustive, sans base ni réseau :
 * - chaque `*_ENABLED` documenté dans `.env.example` est actif (jamais `true`) ;
 * - chaque lecture directe `process.env.X_ENABLED` / `env.X_ENABLED` compare la
 *   valeur à la chaîne exacte `"true"`. Une variable absente, vide, `TRUE`,
 *   `1` ou `yes` laisse donc la fonctionnalité éteinte ;
 * - aucun interrupteur documenté n'est orphelin dans le code.
 *
 * Le test échoue dès qu'un nouveau drapeau est lu par truthiness (`if (env.X)`)
 * ou qu'une valeur `true` est versionnée dans `.env.example`.
 */

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) =>
    statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]
  );
}

const sourceFiles = walk("src").filter(
  (file) => /\.(ts|tsx)$/.test(file) && !/\.(test|spec)\./.test(file)
);

const envExample = readFileSync(".env.example", "utf8");
const documentedFlags = [
  ...new Set(
    [...envExample.matchAll(/^#?\s*([A-Z][A-Z0-9_]*_ENABLED)=/gm)].map((match) => match[1])
  ),
].sort();

const exactTrue = /===\s*["']true["']|!==\s*["']true["']/;

describe("C092 — tous les interrupteurs sont OFF par défaut", () => {
  it("couvre un nombre réaliste d'interrupteurs documentés", () => {
    expect(documentedFlags.length).toBeGreaterThan(80);
  });

  it("`.env.example` ne contient aucun interrupteur à `true`", () => {
    const enabled = envExample
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
      .filter((line) => /^[A-Z][A-Z0-9_]*_ENABLED=true$/.test(line));
    expect(enabled).toEqual([]);
  });

  it("chaque lecture directe d'un interrupteur exige la chaîne exacte `true`", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          for (const match of line.matchAll(/(?:process\.env|env)\.([A-Z][A-Z0-9_]*_ENABLED)\b/g)) {
            if (!exactTrue.test(line)) offenders.push(`${file}:${index + 1} ${match[1]}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it("aucun interrupteur documenté n'est absent du code", () => {
    const source = sourceFiles.map((file) => readFileSync(file, "utf8")).join("\n");
    const missing = documentedFlags.filter((name) => !source.includes(name));
    expect(missing).toEqual([]);
  });
});
